# AjoChain

**Trustless ajo / esusu / susu rotating savings on Stellar.**

Millions of people in Nigeria and Ghana save through rotating savings circles. Each member pays a
fixed amount every round, and one member takes the whole pot. The weak point is the collector, who
holds everyone's money. AjoChain puts the pot in a Soroban smart contract instead:

- Contributions are paid in **XLM** on testnet, straight into the contract. Any Stellar asset contract (SAC) token works, so a mainnet deployment can use **USDC** to protect savers from naira/cedi volatility.
- When every member has paid for the round, the contract **pays the pot out automatically** to that round's member.
- Every on-time payment is recorded on-chain. This **reputation** goes with the member to future circles.
- An optional **auto-pay agent** (for example an AI agent or a scheduled bot) can pay on a member's behalf. It can only spend what that member has approved for the contract, through a token allowance.

## Live on testnet

**Try it:** https://ajochain-rho.vercel.app (sign in with a passkey, meaning Face ID, fingerprint or phone PIN, with no seed phrase and no fees; or connect a testnet wallet such as Freighter)

| | |
|---|---|
| AjoChain contract | [`CAPOPZZ4Q56WSJPBFTAS7HUP4WU7PSISVZEWABVMG7V45TUC6CFS7GVB`](https://stellar.expert/explorer/testnet/contract/CAPOPZZ4Q56WSJPBFTAS7HUP4WU7PSISVZEWABVMG7V45TUC6CFS7GVB) |
| Token (native XLM, SAC) | `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` |

End-to-end test on testnet: a 3-member circle (10 XLM each) was created, joined and paid. One member's share was paid by the auto-pay agent through `contribute_for`. The contract then paid the 30 XLM pot out automatically and recorded on-time reputation for every member.

## Repo layout

```
contracts/ajo/             Soroban smart contract (Rust) + unit tests
contracts/passkey-wallet/  Passkey (secp256r1 / WebAuthn) smart-wallet contract + unit tests
web/                       Next.js 16 frontend (passkeys + Stellar Wallets Kit, stellar-sdk)
agent/                     Auto-pay agent (Node) that pays contributions for members who opt in
```

## Contract API

| Function | Description |
|---|---|
| `create_circle(creator, token, amount, max_members, period) -> u32` | Creates a circle. The creator becomes member #1. |
| `join(circle_id, member)` | Joins an open circle. When the circle is full, round 1 starts. |
| `contribute(circle_id, member)` | Pays this round's contribution. The last payment triggers the payout. |
| `set_agent(circle_id, member, agent)` / `remove_agent` | Authorises or removes an auto-pay agent. |
| `contribute_for(circle_id, member, agent)` | The agent pays from the member's allowance. |
| `get_circle`, `has_paid`, `paid_this_round`, `round_deadline`, `get_agent`, `payouts`, `reputation`, `circles_of`, `circle_count` | Read-only views. |

## Run the tests

```bash
cargo test
```

## Build and deploy to testnet

You need the Stellar CLI: `cargo install --locked stellar-cli`, plus `rustup target add wasm32v1-none`.
(If the build fails on `wasm-opt-sys`, for example on older macOS, use `cargo install --locked stellar-cli --no-default-features`.)

```bash
# 1. Create and fund a testnet identity
stellar keys generate alice --network testnet --fund

# 2. Build and deploy
stellar contract build
stellar contract deploy \
  --wasm target/wasm32v1-none/release/ajo.wasm \
  --source alice --network testnet
# -> prints the contract id (C...)

# 3. Token: the demo uses native XLM (any SAC token such as USDC also works):
stellar contract id asset --asset native --network testnet
```

Then set up the frontend:

```bash
cd web
cp .env.example .env.local   # fill in NEXT_PUBLIC_AJO_CONTRACT_ID and NEXT_PUBLIC_TOKEN_CONTRACT_ID
                             # for passkeys also: NEXT_PUBLIC_PASSKEY_WASM_HASH, NEXT_PUBLIC_RELAYER_ADDRESS,
                             # and RELAYER_SECRET (server-only, never NEXT_PUBLIC, never commit it)
npm install
npm run dev
```

Open http://localhost:3000. Either create a passkey wallet (see below) or connect Freighter, xBull,
LOBSTR or another wallet set to **testnet**. A classic wallet account must be funded (use Friendbot)
and must hold the contribution token.

## Passkey wallets (no seed phrase, gasless)

New users sign in with Face ID, a fingerprint or a phone PIN. Behind the scenes:

1. The browser creates a P-256 passkey (WebAuthn).
2. `POST /api/wallet` deploys a `passkey-wallet` contract for that public key and funds it. The
   address is deterministic: the relayer as deployer, with salt `sha256(credentialId)`. The same
   passkey therefore always maps to the same wallet, on any device the passkey syncs to.
3. For each action, the app simulates the call and has the passkey sign only the Soroban auth
   entries belonging to the user's wallet. The wallet's `__check_auth` verifies the WebAuthn
   assertion on-chain with `secp256r1`.
4. `POST /api/relay` submits the transaction with the relayer as the source, so the relayer pays the
   fees. It refuses any transaction that would need the relayer's own authorisation.

Setup:

```bash
cd contracts/passkey-wallet && cargo test
stellar contract build
stellar contract upload --wasm target/wasm32v1-none/release/passkey_wallet.wasm \
  --source alice --network testnet          # -> NEXT_PUBLIC_PASSKEY_WASM_HASH
stellar keys generate relayer --network testnet --fund
stellar keys address relayer                 # -> NEXT_PUBLIC_RELAYER_ADDRESS
stellar keys show relayer                    # -> RELAYER_SECRET (server env only)
```

Keep the relayer funded, because it pays every passkey user's fees and wallet deposit.

Note: testnet now returns CAP-71 `sorobanCredentialsAddressV2` auth entries. The client and relayer
handle both V1 and V2.

### End-to-end smoke test

The smoke test runs the whole passkey flow against testnet through a running server. It uses a Node
P-256 key in place of the authenticator, which produces the same assertion format:

1. Create two wallets.
2. Create a circle.
3. Join it.
4. Both wallets contribute, so the circle pays out.
5. Negative check: a forged signature must be rejected.

```bash
cd web
npm run dev                       # in another terminal
BASE=http://localhost:3000 npm run smoke   # ~40s, ends with "ALL OK"; DEBUG=1 for host events
```

Run it before every deploy.

## Auto-pay agent

1. Create an agent account: `stellar keys generate agent --network testnet --fund`. Get its secret with `stellar keys show agent`.
2. A member opens their circle in the app and clicks **Approve**. This lets the contract pull N rounds' worth of the token, and nothing more.
3. The member then pastes the agent's `G...` address and clicks **Authorise**.
4. Run the agent:

```bash
cd agent
cp .env.example .env   # set AGENT_SECRET and AJO_CONTRACT_ID
npm install
npm start              # or `npm run once` for a single pass
```

The agent scans every active circle and finds the members who authorised it. It calls `contribute_for` once `PAY_AFTER` of the round has passed. It never holds member funds. A member can revoke it at any time with `remove_agent`, or by setting their allowance to 0.

## Demo script (2 minutes)

1. Open three browser profiles, each with its own testnet wallet.
2. Wallet A creates a circle: 10 XLM, 3 members, "Every 5 minutes (demo)".
3. Wallets B and C open the invite link and join. The circle becomes **Active**.
4. All three contribute. On the last contribution the pot of 30 XLM lands in wallet A automatically.
5. The dashboard shows each member's reputation increasing.
