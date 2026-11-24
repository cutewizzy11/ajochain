/**
 * Thin client for the AjoChain Soroban contract.
 * Reads are free simulations. Writes come in two flavours:
 *  - Stellar wallet: simulated, assembled, signed by the user's wallet and submitted.
 *  - Passkey wallet: the user's passkey signs only the Soroban auth entries;
 *    the relayer (/api/relay) is the transaction source and pays the fees.
 */
import {
  Account,
  Address,
  authorizeEntry,
  BASE_FEE,
  Contract,
  nativeToScVal,
  Operation,
  rpc,
  scValToNative,
  Transaction,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk";
import { RELAYER_ADDRESS } from "./passkey-address";
import { signWithPasskey } from "./passkey";
import {
  AJO_CONTRACT_ID,
  NETWORK_PASSPHRASE,
  RPC_URL,
  TOKEN_CONTRACT_ID,
  TOKEN_DECIMALS,
  TOKEN_SYMBOL,
} from "./config";

export const server = new rpc.Server(RPC_URL);

export type Status = "Open" | "Active" | "Completed" | "Defaulted";

export interface Circle {
  id: number;
  creator: string;
  token: string;
  amount: bigint;
  max_members: number;
  period: bigint;
  members: string[];
  round: number;
  start_time: bigint;
  status: Status;
}

export interface Payout {
  round: number;
  recipient: string;
  amount: bigint;
  timestamp: bigint;
}

export interface Reputation {
  on_time: number;
  late: number;
  circles_completed: number;
  defaulted: number;
}

export type SignFn = (xdr: string) => Promise<string>;

/** How the current user authorises writes. */
export type Signer =
  | { kind: "wallet"; signTx: SignFn }
  | { kind: "passkey"; credentialId: string };

// ----- arg helpers ---------------------------------------------------------

const addr = (a: string) => new Address(a).toScVal();
const u32 = (n: number) => nativeToScVal(n, { type: "u32" });
const u64 = (n: bigint | number) => nativeToScVal(BigInt(n), { type: "u64" });
const i128 = (n: bigint) => nativeToScVal(n, { type: "i128" });

export const toUnits = (amount: string) => {
  const [whole, frac = ""] = amount.split(".");
  return BigInt(whole || "0") * 10n ** BigInt(TOKEN_DECIMALS) +
    BigInt((frac + "0".repeat(TOKEN_DECIMALS)).slice(0, TOKEN_DECIMALS));
};

export const fromUnits = (units: bigint) => {
  const d = 10n ** BigInt(TOKEN_DECIMALS);
  const frac = (units % d).toString().padStart(TOKEN_DECIMALS, "0").replace(/0+$/, "");
  return `${units / d}${frac ? "." + frac : ""}`;
};

/** Soroban enums come back as ["Variant"]; normalise to a string. */
function normaliseCircle(raw: Record<string, unknown>): Circle {
  const status = raw.status as unknown;
  return {
    ...(raw as unknown as Circle),
    status: (Array.isArray(status) ? status[0] : status) as Status,
  };
}

// ----- core ----------------------------------------------------------------

/** Fee-free simulation source: the relayer if configured, else the viewer's own account. */
async function sourceAccount(viewer: string): Promise<Account> {
  if (RELAYER_ADDRESS) return new Account(RELAYER_ADDRESS, "0");
  const a = await server.getAccount(viewer);
  return new Account(a.accountId(), a.sequenceNumber());
}

function buildTx(account: Account, op: xdr.Operation): Transaction {
  return new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE })
    .addOperation(op)
    .setTimeout(30)
    .build();
}

async function read<T>(
  viewer: string,
  method: string,
  args: xdr.ScVal[] = [],
  contractId = AJO_CONTRACT_ID,
): Promise<T> {
  const tx = buildTx(await sourceAccount(viewer), new Contract(contractId).call(method, ...args));
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw new Error(sim.error);
  return scValToNative(sim.result!.retval) as T;
}

async function write<T = unknown>(
  me: string,
  signer: Signer,
  method: string,
  args: xdr.ScVal[],
  contractId = AJO_CONTRACT_ID,
): Promise<T> {
  return (signer.kind === "passkey"
    ? writeWithPasskey(me, signer.credentialId, method, args, contractId)
    : writeWithWallet(me, signer.signTx, method, args, contractId)) as Promise<T>;
}

async function writeWithWallet(me: string, sign: SignFn, method: string, args: xdr.ScVal[], contractId: string) {
  const tx = buildTx(await server.getAccount(me) as Account, new Contract(contractId).call(method, ...args));
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw new Error(friendlyError(sim.error));
  const prepared = rpc.assembleTransaction(tx, sim).build();
  const signed = await sign(prepared.toXDR());
  const sent = await server.sendTransaction(TransactionBuilder.fromXDR(signed, NETWORK_PASSPHRASE));
  if (sent.status === "ERROR") throw new Error("Transaction rejected by network");
  const res = await server.pollTransaction(sent.hash, { attempts: 30 });
  if (res.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
    throw new Error(`Transaction failed (${res.status})`);
  }
  return res.returnValue ? scValToNative(res.returnValue) : undefined;
}

async function writeWithPasskey(
  me: string,
  credentialId: string,
  method: string,
  args: xdr.ScVal[],
  contractId: string,
) {
  if (!RELAYER_ADDRESS) throw new Error("Passkey wallets are not configured on this deployment");
  const relayerAcct = new Account(RELAYER_ADDRESS, "0");
  const call = (auth: xdr.SorobanAuthorizationEntry[] = []) =>
    Operation.invokeContractFunction({ contract: contractId, function: method, args, auth });

  // 1. Recording-mode simulation tells us which auth entries are needed.
  const first = await server.simulateTransaction(buildTx(relayerAcct, call()));
  if (rpc.Api.isSimulationError(first)) throw new Error(friendlyError(first.error));

  // 2. The passkey signs each entry that belongs to this wallet.
  const validUntil = first.latestLedger + 120; // ~10 minutes
  const auth = await Promise.all(
    (first.result?.auth ?? []).map((entry) => {
      const creds = addressCredentials(entry.credentials);
      if (!creds || Address.fromScAddress(creds.address).toString() !== me) return entry;
      return authorizeEntry(
        entry,
        async (_preimage, payload) => ({ signatureScVal: await signWithPasskey(credentialId, payload) }),
        validUntil,
        NETWORK_PASSPHRASE,
      );
    }),
  );

  // 3. Re-simulate with the signatures attached so __check_auth's cost is counted.
  const draft = buildTx(relayerAcct, call(auth));
  const second = await server.simulateTransaction(draft);
  if (rpc.Api.isSimulationError(second)) throw new Error(friendlyError(second.error));
  const prepared = rpc.assembleTransaction(draft, second).build();

  // 4. The relayer wraps it in its own transaction and pays the fee.
  const r = await fetch("/api/relay", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ xdr: prepared.toXDR() }),
  });
  const body = (await r.json().catch(() => ({}))) as { returnValue?: string; error?: string };
  if (!r.ok) throw new Error(friendlyError(body.error ?? `Relayer error (${r.status})`));
  return body.returnValue ? scValToNative(xdr.ScVal.fromXDR(body.returnValue, "base64")) : undefined;
}

/** Address credentials of a V1 or V2 (CAP-71, address-bound) auth entry; null otherwise. */
export function addressCredentials(c: xdr.SorobanCredentials) {
  if (c.type === "sorobanCredentialsAddress") return c.address;
  if (c.type === "sorobanCredentialsAddressV2") return c.addressV2;
  return null;
}

const ERRORS: Record<string, string> = {
  "#1": "Circle not found",
  "#2": "Invalid circle settings",
  "#3": "Circle is already full",
  "#4": "You are already a member",
  "#5": "You are not a member of this circle",
  "#6": "Circle has not started yet — waiting for members",
  "#7": "You already paid this round",
  "#8": "Circle is completed",
  // #9 is also the token's AllowanceError (insufficient approval for auto-pay).
  "#9": "Not authorised: the agent isn't set, or the token allowance is too low",
  // #10 comes from the token contract (SAC BalanceError). Note: the Ajo
  // contract also defines #10 (DeadlineNotReached), but the Resolve action is
  // only offered once the deadline has passed, so that case isn't surfaced here.
  "#10": `Not enough ${TOKEN_SYMBOL} in your wallet to pay this round`,
  "#11": "Everyone has paid — there is nothing to resolve",
};

function friendlyError(raw: string) {
  const m = raw.match(/Error\(Contract, (#\d+)\)/);
  return (m && ERRORS[m[1]]) || raw;
}

// ----- public API ----------------------------------------------------------

export const ajo = {
  createCircle: (me: string, signer: Signer, token: string, amount: bigint, maxMembers: number, periodSecs: number) =>
    write<number>(me, signer, "create_circle", [addr(me), addr(token), i128(amount), u32(maxMembers), u64(periodSecs)]),

  join: (me: string, signer: Signer, id: number) =>
    write(me, signer, "join", [u32(id), addr(me)]),

  contribute: (me: string, signer: Signer, id: number) =>
    write(me, signer, "contribute", [u32(id), addr(me)]),

  /**
   * Unwind a stuck round after its deadline: refunds everyone who paid the
   * current round and closes the circle. Permissionless — any member can call.
   */
  resolveRound: (me: string, signer: Signer, id: number) =>
    write(me, signer, "resolve_round", [u32(id)]),

  setAgent: (me: string, signer: Signer, id: number, agent: string) =>
    write(me, signer, "set_agent", [u32(id), addr(me), addr(agent)]),

  /**
   * Let the AjoChain contract pull up to `amount` of the token from `me`
   * (needed for auto-pay agents). Expires after ~`days` days of ledgers.
   */
  approve: async (me: string, signer: Signer, token: string, amount: bigint, days = 30) => {
    const { sequence } = await server.getLatestLedger();
    const expiry = sequence + Math.round((days * 86_400) / 5);
    return write(me, signer, "approve", [addr(me), addr(AJO_CONTRACT_ID), i128(amount), u32(expiry)], token);
  },

  getCircle: async (viewer: string, id: number) =>
    normaliseCircle(await read<Record<string, unknown>>(viewer, "get_circle", [u32(id)])),

  circleCount: (viewer: string) => read<number>(viewer, "circle_count"),

  circlesOf: (viewer: string, who: string) => read<number[]>(viewer, "circles_of", [addr(who)]),

  paidThisRound: (viewer: string, id: number) => read<string[]>(viewer, "paid_this_round", [u32(id)]),

  roundDeadline: (viewer: string, id: number) => read<bigint>(viewer, "round_deadline", [u32(id)]),

  payouts: (viewer: string, id: number) => read<Payout[]>(viewer, "payouts", [u32(id)]),

  reputation: (viewer: string, who: string) => read<Reputation>(viewer, "reputation", [addr(who)]),

  /** Token balance of `who`, in base units. */
  balance: (viewer: string, who: string) =>
    read<bigint>(viewer, "balance", [addr(who)], TOKEN_CONTRACT_ID),
};
