#![cfg(test)]
extern crate std;

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{StellarAssetClient, TokenClient},
    Address, Env,
};

fn err(e: Error) -> soroban_sdk::Error {
    soroban_sdk::Error::from_contract_error(e as u32)
}

const AMT: i128 = 10_0000000; // 10 USDC (7 decimals)
const WEEK: u64 = 7 * 24 * 3600;

struct Setup<'a> {
    env: Env,
    ajo: AjoContractClient<'a>,
    token: TokenClient<'a>,
    users: std::vec::Vec<Address>,
}

fn setup(n: usize) -> Setup<'static> {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(1_000_000);

    let admin = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(admin);
    let token_id = sac.address();
    let minter = StellarAssetClient::new(&env, &token_id);

    let users: std::vec::Vec<Address> = (0..n).map(|_| Address::generate(&env)).collect();
    for u in &users {
        minter.mint(u, &(AMT * 100));
    }

    let id = env.register(AjoContract, ());
    let ajo = AjoContractClient::new(&env, &id);
    let token = TokenClient::new(&env, &token_id);
    Setup { env, ajo, token, users }
}

fn full_circle(s: &Setup) -> u32 {
    let id = s
        .ajo
        .create_circle(&s.users[0], &s.token.address, &AMT, &(s.users.len() as u32), &WEEK);
    for u in s.users.iter().skip(1) {
        s.ajo.join(&id, u);
    }
    id
}

#[test]
fn create_and_join_starts_circle() {
    let s = setup(3);
    let id = s.ajo.create_circle(&s.users[0], &s.token.address, &AMT, &3, &WEEK);
    assert_eq!(id, 0);
    assert_eq!(s.ajo.get_circle(&id).status, Status::Open);
    s.ajo.join(&id, &s.users[1]);
    s.ajo.join(&id, &s.users[2]);
    let c = s.ajo.get_circle(&id);
    assert_eq!(c.status, Status::Active);
    assert_eq!(c.members.len(), 3);
    assert_eq!(c.start_time, 1_000_000);
    assert_eq!(s.ajo.circles_of(&s.users[1]).len(), 1);
}

#[test]
fn full_rotation_pays_everyone_once() {
    let s = setup(3);
    let id = full_circle(&s);
    let start: std::vec::Vec<i128> = s.users.iter().map(|u| s.token.balance(u)).collect();

    for round in 0..3u32 {
        for u in &s.users {
            s.ajo.contribute(&id, u);
        }
        let p = s.ajo.payouts(&id).get(round).unwrap();
        assert_eq!(p.recipient, s.users[round as usize]);
        assert_eq!(p.amount, AMT * 3);
    }

    // Everyone paid 3x and received the pot once -> net zero.
    for (i, u) in s.users.iter().enumerate() {
        assert_eq!(s.token.balance(u), start[i]);
        let r = s.ajo.reputation(u);
        assert_eq!(r.on_time, 3);
        assert_eq!(r.circles_completed, 1);
    }
    assert_eq!(s.ajo.get_circle(&id).status, Status::Completed);
    assert_eq!(s.token.balance(&s.ajo.address), 0);
}

#[test]
fn pot_held_until_everyone_pays() {
    let s = setup(3);
    let id = full_circle(&s);
    s.ajo.contribute(&id, &s.users[0]);
    s.ajo.contribute(&id, &s.users[1]);
    assert_eq!(s.token.balance(&s.ajo.address), AMT * 2);
    assert_eq!(s.ajo.payouts(&id).len(), 0);
    assert_eq!(s.ajo.paid_this_round(&id).len(), 2);
}

#[test]
fn late_payment_hurts_reputation() {
    let s = setup(2);
    let id = full_circle(&s);
    s.ajo.contribute(&id, &s.users[0]);
    s.env.ledger().set_timestamp(1_000_000 + WEEK + 1);
    s.ajo.contribute(&id, &s.users[1]);
    assert_eq!(s.ajo.reputation(&s.users[1]).late, 1);
    assert_eq!(s.ajo.reputation(&s.users[0]).on_time, 1);
}

#[test]
fn agent_pays_within_allowance() {
    let s = setup(2);
    let id = full_circle(&s);
    let agent = Address::generate(&s.env);
    let member = &s.users[1];

    s.ajo.set_agent(&id, member, &agent);
    // Member caps the agent at 2 contributions via token allowance.
    s.token.approve(member, &s.ajo.address, &(AMT * 2), &1000);

    s.ajo.contribute(&id, &s.users[0]);
    s.ajo.contribute_for(&id, member, &agent);
    assert!(s.ajo.has_paid(&id, &0, member));
    assert_eq!(s.token.allowance(member, &s.ajo.address), AMT);
}

#[test]
#[should_panic]
fn agent_cannot_exceed_allowance() {
    let s = setup(2);
    let id = full_circle(&s);
    let agent = Address::generate(&s.env);
    let member = &s.users[1];
    s.ajo.set_agent(&id, member, &agent);
    s.token.approve(member, &s.ajo.address, &(AMT - 1), &1000);
    s.ajo.contribute_for(&id, member, &agent);
}

#[test]
fn unregistered_agent_rejected() {
    let s = setup(2);
    let id = full_circle(&s);
    let rogue = Address::generate(&s.env);
    let r = s.ajo.try_contribute_for(&id, &s.users[1], &rogue);
    assert_eq!(r, Err(Ok(err(Error::NotAgent))));
}

#[test]
fn double_payment_rejected() {
    let s = setup(3);
    let id = full_circle(&s);
    s.ajo.contribute(&id, &s.users[0]);
    let r = s.ajo.try_contribute(&id, &s.users[0]);
    assert_eq!(r, Err(Ok(err(Error::AlreadyPaid))));
}

#[test]
fn cannot_pay_before_start_or_join_twice() {
    let s = setup(3);
    let id = s.ajo.create_circle(&s.users[0], &s.token.address, &AMT, &3, &WEEK);
    assert_eq!(s.ajo.try_contribute(&id, &s.users[0]), Err(Ok(err(Error::NotStarted))));
    assert_eq!(s.ajo.try_join(&id, &s.users[0]), Err(Ok(err(Error::AlreadyMember))));
}

#[test]
fn outsider_cannot_contribute() {
    let s = setup(2);
    let id = full_circle(&s);
    let outsider = Address::generate(&s.env);
    assert_eq!(s.ajo.try_contribute(&id, &outsider), Err(Ok(err(Error::NotMember))));
}

#[test]
fn invalid_params_rejected() {
    let s = setup(1);
    let r = s.ajo.try_create_circle(&s.users[0], &s.token.address, &0, &3, &WEEK);
    assert_eq!(r, Err(Ok(err(Error::InvalidParams))));
    let r = s.ajo.try_create_circle(&s.users[0], &s.token.address, &AMT, &1, &WEEK);
    assert_eq!(r, Err(Ok(err(Error::InvalidParams))));
}

#[test]
fn resolve_round_refunds_stuck_round_and_closes() {
    let s = setup(3);
    let id = full_circle(&s);
    let start: std::vec::Vec<i128> = s.users.iter().map(|u| s.token.balance(u)).collect();

    // users 0 and 1 pay round 0; user 2 never does.
    s.ajo.contribute(&id, &s.users[0]);
    s.ajo.contribute(&id, &s.users[1]);
    assert_eq!(s.token.balance(&s.ajo.address), AMT * 2);

    // Past the round-0 deadline, anyone can resolve the stuck round.
    s.env.ledger().set_timestamp(1_000_000 + WEEK + 1);
    s.ajo.resolve_round(&id);

    let c = s.ajo.get_circle(&id);
    assert_eq!(c.status, Status::Defaulted);
    // Contract holds nothing; both payers are made whole; no payout happened.
    assert_eq!(s.token.balance(&s.ajo.address), 0);
    assert_eq!(s.token.balance(&s.users[0]), start[0]);
    assert_eq!(s.token.balance(&s.users[1]), start[1]);
    assert_eq!(s.ajo.payouts(&id).len(), 0);
    // The non-payer is marked; payers are not.
    assert_eq!(s.ajo.reputation(&s.users[2]).defaulted, 1);
    assert_eq!(s.ajo.reputation(&s.users[0]).defaulted, 0);
}

#[test]
fn resolve_round_before_deadline_rejected() {
    let s = setup(3);
    let id = full_circle(&s);
    s.ajo.contribute(&id, &s.users[0]);
    let r = s.ajo.try_resolve_round(&id);
    assert_eq!(r, Err(Ok(err(Error::DeadlineNotReached))));
}

#[test]
fn cannot_contribute_after_default() {
    let s = setup(3);
    let id = full_circle(&s);
    s.ajo.contribute(&id, &s.users[0]);
    s.env.ledger().set_timestamp(1_000_000 + WEEK + 1);
    s.ajo.resolve_round(&id);
    let r = s.ajo.try_contribute(&id, &s.users[1]);
    assert_eq!(r, Err(Ok(err(Error::Completed))));
}

#[test]
fn resolve_after_early_payout_refunds_honest_member() {
    let s = setup(2);
    let id = full_circle(&s);
    let start: std::vec::Vec<i128> = s.users.iter().map(|u| s.token.balance(u)).collect();

    // Round 0: both pay -> user0 (slot 0) receives the pot, round advances to 1.
    s.ajo.contribute(&id, &s.users[0]);
    s.ajo.contribute(&id, &s.users[1]);
    assert_eq!(s.ajo.get_circle(&id).round, 1);

    // Round 1: user0 (already paid out) walks away; user1 pays in.
    s.env.ledger().set_timestamp(1_000_000 + WEEK + 1);
    s.ajo.contribute(&id, &s.users[1]);

    // Past the round-1 deadline, resolve: user1 refunded, user0 marked.
    s.env.ledger().set_timestamp(1_000_000 + 2 * WEEK + 1);
    s.ajo.resolve_round(&id);

    assert_eq!(s.ajo.get_circle(&id).status, Status::Defaulted);
    assert_eq!(s.token.balance(&s.ajo.address), 0);
    // user0 kept the round-0 pot (cannot be clawed back); user1's round-1
    // contribution was refunded. The residual -AMT on user1 is the inherent
    // ROSCA credit risk (see C1 design note), not trapped funds.
    assert_eq!(s.token.balance(&s.users[0]), start[0] + AMT);
    assert_eq!(s.token.balance(&s.users[1]), start[1] - AMT);
    assert_eq!(s.ajo.reputation(&s.users[0]).defaulted, 1);
    assert_eq!(s.ajo.reputation(&s.users[1]).defaulted, 0);
}

#[test]
fn amount_above_cap_rejected() {
    let s = setup(1);
    let too_big = 1_000_000_000i128 * 10_000_000 + 1;
    let r = s.ajo.try_create_circle(&s.users[0], &s.token.address, &too_big, &3, &WEEK);
    assert_eq!(r, Err(Ok(err(Error::InvalidParams))));
}
