#![no_std]
//! AjoChain — a trustless Ajo/Esusu rotating savings circle on Soroban.
//!
//! * A circle has a fixed contribution (in a token such as USDC), a fixed
//!   number of members and a round length.
//! * The contract — not a collector — holds every contribution.
//! * Each round, once every member has paid, the whole pot is paid to that
//!   round's member automatically, in join order.
//! * A member can register an AI agent that may pay their contribution for
//!   them. The agent can only pay into this circle, only the circle's fixed
//!   amount, and only up to the token allowance the member granted.
//! * On-time contributions build a per-address reputation score.

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, symbol_short, token,
    Address, Env, Vec,
};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    CircleNotFound = 1,
    InvalidParams = 2,
    CircleFull = 3,
    AlreadyMember = 4,
    NotMember = 5,
    NotStarted = 6,
    AlreadyPaid = 7,
    Completed = 8,
    NotAgent = 9,
    /// `resolve_round` called before the current round's deadline.
    DeadlineNotReached = 10,
    /// `resolve_round` called on a round where everyone has already paid.
    NotStuck = 11,
}

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Status {
    Open,
    Active,
    Completed,
    /// A round passed its deadline unpaid; the round was refunded and the
    /// circle was closed via `resolve_round`.
    Defaulted,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Circle {
    pub id: u32,
    pub creator: Address,
    pub token: Address,
    /// Contribution per member per round, in the token's smallest unit.
    pub amount: i128,
    pub max_members: u32,
    /// Round length in seconds.
    pub period: u64,
    pub members: Vec<Address>,
    /// Zero-based index of the current round (also the index of its recipient).
    pub round: u32,
    /// Ledger timestamp when the circle filled up and round 0 began.
    pub start_time: u64,
    pub status: Status,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Payout {
    pub round: u32,
    pub recipient: Address,
    pub amount: i128,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Reputation {
    pub on_time: u32,
    pub late: u32,
    pub circles_completed: u32,
    /// Rounds this address failed to pay before a circle defaulted.
    pub defaulted: u32,
}

#[contracttype]
enum DataKey {
    NextId,
    Circle(u32),
    /// Whether `member` has paid in `round` of circle `id`.
    Paid(u32, u32, Address),
    /// Agent registered by a member for a circle.
    Agent(u32, Address),
    Payouts(u32),
    Reputation(Address),
    /// Circle ids an address belongs to.
    MemberCircles(Address),
}

const DAY_LEDGERS: u32 = 17_280;
const TTL_THRESHOLD: u32 = 30 * DAY_LEDGERS;
const TTL_EXTEND: u32 = 120 * DAY_LEDGERS;

/// Upper bound on a circle's per-round contribution (1e9 tokens at 7 decimals).
/// Guards against an oversized `amount` making `amount * members` trap.
const MAX_AMOUNT: i128 = 1_000_000_000 * 10_000_000;

#[contract]
pub struct AjoContract;

#[contractimpl]
impl AjoContract {
    // ----- writes -------------------------------------------------------

    /// Create a circle. The creator joins automatically as member #1
    /// (first payout).
    pub fn create_circle(
        env: Env,
        creator: Address,
        token: Address,
        amount: i128,
        max_members: u32,
        period: u64,
    ) -> u32 {
        creator.require_auth();
        if amount <= 0 || amount > MAX_AMOUNT || max_members < 2 || max_members > 50 || period == 0 {
            panic_with_error!(&env, Error::InvalidParams);
        }
        let id: u32 = env.storage().instance().get(&DataKey::NextId).unwrap_or(0);
        env.storage().instance().set(&DataKey::NextId, &(id + 1));
        env.storage()
            .instance()
            .extend_ttl(TTL_THRESHOLD, TTL_EXTEND);

        let mut members = Vec::new(&env);
        members.push_back(creator.clone());
        let circle = Circle {
            id,
            creator: creator.clone(),
            token,
            amount,
            max_members,
            period,
            members,
            round: 0,
            start_time: 0,
            status: Status::Open,
        };
        save_circle(&env, &circle);
        add_member_circle(&env, &creator, id);
        env.events()
            .publish((symbol_short!("created"), id), (creator, amount, max_members));
        id
    }

    /// Join an open circle. The circle starts when the last seat is filled.
    pub fn join(env: Env, circle_id: u32, member: Address) {
        member.require_auth();
        let mut c = load_circle(&env, circle_id);
        if c.status != Status::Open {
            panic_with_error!(&env, Error::CircleFull);
        }
        if c.members.contains(&member) {
            panic_with_error!(&env, Error::AlreadyMember);
        }
        c.members.push_back(member.clone());
        if c.members.len() == c.max_members {
            c.status = Status::Active;
            c.start_time = env.ledger().timestamp();
            env.events().publish((symbol_short!("started"), circle_id), c.start_time);
        }
        save_circle(&env, &c);
        add_member_circle(&env, &member, circle_id);
        env.events().publish((symbol_short!("joined"), circle_id), member);
    }

    /// Pay this round's contribution yourself.
    pub fn contribute(env: Env, circle_id: u32, member: Address) {
        member.require_auth();
        let c = load_circle(&env, circle_id);
        let client = token::Client::new(&env, &c.token);
        check_can_pay(&env, &c, &member);
        client.transfer(&member, &env.current_contract_address(), &c.amount);
        record_payment(&env, c, member);
    }

    /// Let an agent (e.g. an AI assistant's account) pay contributions on
    /// your behalf. You must also `approve` this contract on the token for
    /// the total you are willing to let the agent spend — that allowance is
    /// the hard spending cap.
    pub fn set_agent(env: Env, circle_id: u32, member: Address, agent: Address) {
        member.require_auth();
        let c = load_circle(&env, circle_id);
        if !c.members.contains(&member) {
            panic_with_error!(&env, Error::NotMember);
        }
        let key = DataKey::Agent(circle_id, member.clone());
        env.storage().persistent().set(&key, &agent);
        bump(&env, &key);
        env.events()
            .publish((symbol_short!("agent_set"), circle_id), (member, agent));
    }

    pub fn remove_agent(env: Env, circle_id: u32, member: Address) {
        member.require_auth();
        env.storage()
            .persistent()
            .remove(&DataKey::Agent(circle_id, member.clone()));
        env.events().publish((symbol_short!("agent_rm"), circle_id), member);
    }

    /// Called by a member's registered agent. Pulls exactly the circle's
    /// contribution from the member via token allowance.
    pub fn contribute_for(env: Env, circle_id: u32, member: Address, agent: Address) {
        agent.require_auth();
        let registered: Option<Address> = env
            .storage()
            .persistent()
            .get(&DataKey::Agent(circle_id, member.clone()));
        if registered != Some(agent) {
            panic_with_error!(&env, Error::NotAgent);
        }
        let c = load_circle(&env, circle_id);
        check_can_pay(&env, &c, &member);
        let me = env.current_contract_address();
        token::Client::new(&env, &c.token).transfer_from(&me, &member, &me, &c.amount);
        record_payment(&env, c, member);
    }

    /// Unwind a stuck round after its deadline: refund every member who paid
    /// the current round and close the circle as `Defaulted`. This is the
    /// escape hatch that prevents one non-paying member from permanently
    /// locking everyone else's contributions.
    ///
    /// Permissionless by design — money only ever flows back to the members
    /// who paid in (never to the caller), so anyone (a member or a keeper) can
    /// trigger it once the deadline has passed. Earlier rounds already paid
    /// out in full, so after this the contract holds nothing for the circle.
    pub fn resolve_round(env: Env, circle_id: u32) {
        let mut c = load_circle(&env, circle_id);
        if c.status != Status::Active {
            panic_with_error!(&env, Error::NotStarted);
        }
        let deadline = c.start_time + (c.round as u64 + 1) * c.period;
        if env.ledger().timestamp() <= deadline {
            panic_with_error!(&env, Error::DeadlineNotReached);
        }
        let round = c.round;
        let all_paid = c
            .members
            .iter()
            .all(|m| env.storage().persistent().has(&DataKey::Paid(c.id, round, m)));
        if all_paid {
            // Not stuck — the normal contribute() path pays this out.
            panic_with_error!(&env, Error::NotStuck);
        }

        // ---- EFFECTS first (so a malicious token cannot re-enter): close the
        // circle, clear the round's paid flags, and record defaults. ----
        c.status = Status::Defaulted;
        save_circle(&env, &c);

        let mut refund_to = Vec::new(&env);
        for m in c.members.iter() {
            let pk = DataKey::Paid(c.id, round, m.clone());
            if env.storage().persistent().has(&pk) {
                env.storage().persistent().remove(&pk);
                refund_to.push_back(m.clone());
            } else {
                let rk = DataKey::Reputation(m.clone());
                let mut r = AjoContract::reputation(env.clone(), m.clone());
                r.defaulted += 1;
                env.storage().persistent().set(&rk, &r);
                bump(&env, &rk);
            }
        }

        // ---- INTERACTIONS last: refund the contributions of this round. ----
        let client = token::Client::new(&env, &c.token);
        let me = env.current_contract_address();
        for m in refund_to.iter() {
            client.transfer(&me, &m, &c.amount);
        }

        env.events().publish(
            (soroban_sdk::Symbol::new(&env, "defaulted"), c.id, round),
            env.ledger().timestamp(),
        );
    }

    // ----- reads --------------------------------------------------------

    pub fn get_circle(env: Env, circle_id: u32) -> Circle {
        load_circle(&env, circle_id)
    }

    pub fn circle_count(env: Env) -> u32 {
        env.storage().instance().get(&DataKey::NextId).unwrap_or(0)
    }

    pub fn has_paid(env: Env, circle_id: u32, round: u32, member: Address) -> bool {
        env.storage()
            .persistent()
            .has(&DataKey::Paid(circle_id, round, member))
    }

    /// Members who have paid in the current round.
    pub fn paid_this_round(env: Env, circle_id: u32) -> Vec<Address> {
        let c = load_circle(&env, circle_id);
        let mut out = Vec::new(&env);
        for m in c.members.iter() {
            if Self::has_paid(env.clone(), circle_id, c.round, m.clone()) {
                out.push_back(m);
            }
        }
        out
    }

    /// Deadline (ledger timestamp) for the current round.
    pub fn round_deadline(env: Env, circle_id: u32) -> u64 {
        let c = load_circle(&env, circle_id);
        c.start_time + (c.round as u64 + 1) * c.period
    }

    pub fn get_agent(env: Env, circle_id: u32, member: Address) -> Option<Address> {
        env.storage()
            .persistent()
            .get(&DataKey::Agent(circle_id, member))
    }

    pub fn payouts(env: Env, circle_id: u32) -> Vec<Payout> {
        env.storage()
            .persistent()
            .get(&DataKey::Payouts(circle_id))
            .unwrap_or(Vec::new(&env))
    }

    pub fn reputation(env: Env, who: Address) -> Reputation {
        env.storage()
            .persistent()
            .get(&DataKey::Reputation(who))
            .unwrap_or(Reputation {
                on_time: 0,
                late: 0,
                circles_completed: 0,
                defaulted: 0,
            })
    }

    pub fn circles_of(env: Env, who: Address) -> Vec<u32> {
        env.storage()
            .persistent()
            .get(&DataKey::MemberCircles(who))
            .unwrap_or(Vec::new(&env))
    }
}

// ----- helpers ----------------------------------------------------------

fn bump(env: &Env, key: &DataKey) {
    env.storage()
        .persistent()
        .extend_ttl(key, TTL_THRESHOLD, TTL_EXTEND);
}

fn load_circle(env: &Env, id: u32) -> Circle {
    let key = DataKey::Circle(id);
    match env.storage().persistent().get(&key) {
        Some(c) => {
            bump(env, &key);
            c
        }
        None => panic_with_error!(env, Error::CircleNotFound),
    }
}

fn save_circle(env: &Env, c: &Circle) {
    let key = DataKey::Circle(c.id);
    env.storage().persistent().set(&key, c);
    bump(env, &key);
}

fn add_member_circle(env: &Env, who: &Address, id: u32) {
    let key = DataKey::MemberCircles(who.clone());
    let mut ids: Vec<u32> = env
        .storage()
        .persistent()
        .get(&key)
        .unwrap_or(Vec::new(env));
    ids.push_back(id);
    env.storage().persistent().set(&key, &ids);
    bump(env, &key);
}

fn check_can_pay(env: &Env, c: &Circle, member: &Address) {
    match c.status {
        Status::Open => panic_with_error!(env, Error::NotStarted),
        Status::Completed | Status::Defaulted => panic_with_error!(env, Error::Completed),
        Status::Active => {}
    }
    if !c.members.contains(member) {
        panic_with_error!(env, Error::NotMember);
    }
    if env
        .storage()
        .persistent()
        .has(&DataKey::Paid(c.id, c.round, member.clone()))
    {
        panic_with_error!(env, Error::AlreadyPaid);
    }
}

/// Mark a payment, update reputation and pay out the pot if everyone has paid.
fn record_payment(env: &Env, mut c: Circle, member: Address) {
    let now = env.ledger().timestamp();
    let paid_key = DataKey::Paid(c.id, c.round, member.clone());
    env.storage().persistent().set(&paid_key, &true);
    bump(env, &paid_key);

    let deadline = c.start_time + (c.round as u64 + 1) * c.period;
    let mut rep = AjoContract::reputation(env.clone(), member.clone());
    if now <= deadline {
        rep.on_time += 1;
    } else {
        rep.late += 1;
    }
    let rep_key = DataKey::Reputation(member.clone());
    env.storage().persistent().set(&rep_key, &rep);
    bump(env, &rep_key);

    env.events()
        .publish((soroban_sdk::Symbol::new(env, "paid"), c.id, c.round), member);

    // Everyone paid? Pay the pot to this round's recipient.
    let all_paid = c.members.iter().all(|m| {
        env.storage()
            .persistent()
            .has(&DataKey::Paid(c.id, c.round, m))
    });
    if !all_paid {
        return;
    }

    let recipient = c.members.get(c.round).unwrap();
    let pot = c.amount * c.members.len() as i128;
    let paid_round = c.round;

    // ---- EFFECTS: record the payout and advance state BEFORE transferring,
    // so a malicious token cannot re-enter and trigger a second payout. ----
    let pkey = DataKey::Payouts(c.id);
    let mut history: Vec<Payout> = env
        .storage()
        .persistent()
        .get(&pkey)
        .unwrap_or(Vec::new(env));
    history.push_back(Payout {
        round: paid_round,
        recipient: recipient.clone(),
        amount: pot,
        timestamp: now,
    });
    env.storage().persistent().set(&pkey, &history);
    bump(env, &pkey);

    c.round += 1;
    let completed = c.round == c.members.len();
    if completed {
        c.status = Status::Completed;
        for m in c.members.iter() {
            let k = DataKey::Reputation(m.clone());
            let mut r = AjoContract::reputation(env.clone(), m);
            r.circles_completed += 1;
            env.storage().persistent().set(&k, &r);
            bump(env, &k);
        }
    }
    save_circle(env, &c);

    // ---- INTERACTION last ----
    token::Client::new(env, &c.token).transfer(&env.current_contract_address(), &recipient, &pot);

    env.events().publish(
        (soroban_sdk::Symbol::new(env, "payout"), c.id, paid_round),
        (recipient, pot),
    );
    if completed {
        env.events()
            .publish((soroban_sdk::Symbol::new(env, "completed"), c.id), now);
    }
}

#[cfg(test)]
mod test;
