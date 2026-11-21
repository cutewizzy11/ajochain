/**
 * AjoChain auto-pay agent.
 *
 * Finds every member in every active circle who has authorised this agent
 * (`set_agent`), and pays their contribution through `contribute_for` before
 * the round deadline. It can only spend what the member approved for the
 * AjoChain contract, so the member's funds stay in the member's control.
 */
import {
  Address, BASE_FEE, Contract, Keypair, nativeToScVal, rpc, scValToNative, TransactionBuilder,
} from "@stellar/stellar-sdk";

const env = (k, d) => process.env[k] ?? d ?? (() => { throw new Error(`Missing ${k}`); })();
const kp = Keypair.fromSecret(env("AGENT_SECRET"));
const CONTRACT = env("AJO_CONTRACT_ID");
const PASSPHRASE = env("NETWORK_PASSPHRASE", "Test SDF Network ; September 2015");
const PAY_AFTER = Number(env("PAY_AFTER", "0.5"));
const INTERVAL = Number(env("INTERVAL", "30")) * 1000;
const server = new rpc.Server(env("RPC_URL", "https://soroban-testnet.stellar.org"));
const me = kp.publicKey();

const u32 = (n) => nativeToScVal(n, { type: "u32" });
const addr = (a) => new Address(a).toScVal();
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function build(method, args) {
  const account = await server.getAccount(me);
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: PASSPHRASE })
    .addOperation(new Contract(CONTRACT).call(method, ...args))
    .setTimeout(30)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw new Error(sim.error);
  return { tx, sim };
}

async function read(method, ...args) {
  const { sim } = await build(method, args);
  return scValToNative(sim.result.retval);
}

async function contributeFor(id, member) {
  const { tx, sim } = await build("contribute_for", [u32(id), addr(member), addr(me)]);
  const prepared = rpc.assembleTransaction(tx, sim).build();
  prepared.sign(kp);
  const sent = await server.sendTransaction(prepared);
  if (sent.status === "ERROR") throw new Error("rejected by network");
  const res = await server.pollTransaction(sent.hash, { attempts: 30 });
  if (res.status !== rpc.Api.GetTransactionStatus.SUCCESS) throw new Error(`tx ${res.status}`);
  return sent.hash;
}

function why(e) {
  const m = String(e.message).match(/Error\(Contract, #(\d+)\)/);
  const codes = { 7: "already paid", 9: "agent no longer authorised" };
  if (m) return codes[m[1]] ?? `contract error #${m[1]}`;
  if (/allowance|#9\b|InsufficientAllowance|balance/i.test(e.message)) return "allowance or balance too low";
  return e.message.split("\n")[0];
}

async function tick() {
  const count = await read("circle_count");
  const now = BigInt(Math.floor(Date.now() / 1000));

  for (let id = 0; id < count; id++) {
    const c = await read("get_circle", u32(id));
    const status = Array.isArray(c.status) ? c.status[0] : c.status;
    if (status !== "Active") continue;

    const deadline = await read("round_deadline", u32(id));
    const opens = deadline - c.period;
    const payFrom = opens + BigInt(Math.floor(Number(c.period) * PAY_AFTER));
    const paid = new Set(await read("paid_this_round", u32(id)));

    for (const member of c.members) {
      if (paid.has(member)) continue;
      if ((await read("get_agent", u32(id), addr(member))) !== me) continue;
      if (now < payFrom) {
        log(`circle #${id} round ${c.round + 1}: ${short(member)} due, paying in ${payFrom - now}s`);
        continue;
      }
      try {
        const hash = await contributeFor(id, member);
        log(`circle #${id} round ${c.round + 1}: paid for ${short(member)}  tx ${hash.slice(0, 12)}…`);
      } catch (e) {
        log(`circle #${id}: could not pay for ${short(member)} (${why(e)})`);
      }
    }
  }
}

const short = (a) => `${a.slice(0, 4)}…${a.slice(-4)}`;

log(`AjoChain agent ${me} watching contract ${short(CONTRACT)}`);
const once = process.argv.includes("--once");
do {
  try { await tick(); } catch (e) { log("tick failed:", why(e)); }
  if (!once) await new Promise((r) => setTimeout(r, INTERVAL));
} while (!once);
