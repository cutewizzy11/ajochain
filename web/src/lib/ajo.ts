/**
 * Thin client for the AjoChain Soroban contract.
 * Reads are free simulations; writes are simulated, assembled, signed by the
 * user's wallet and submitted.
 */
import {
  Address,
  BASE_FEE,
  Contract,
  nativeToScVal,
  rpc,
  scValToNative,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk";
import {
  AJO_CONTRACT_ID,
  NETWORK_PASSPHRASE,
  RPC_URL,
  TOKEN_DECIMALS,
} from "./config";

export const server = new rpc.Server(RPC_URL);

export type Status = "Open" | "Active" | "Completed";

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
}

export type SignFn = (xdr: string) => Promise<string>;

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

async function simulate(source: string, method: string, args: xdr.ScVal[]) {
  const account = await server.getAccount(source);
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(new Contract(AJO_CONTRACT_ID).call(method, ...args))
    .setTimeout(30)
    .build();
  return { tx, sim: await server.simulateTransaction(tx) };
}

async function read<T>(viewer: string, method: string, args: xdr.ScVal[] = []): Promise<T> {
  const { sim } = await simulate(viewer, method, args);
  if (rpc.Api.isSimulationError(sim)) throw new Error(sim.error);
  return scValToNative(sim.result!.retval) as T;
}

async function write<T = unknown>(
  source: string,
  sign: SignFn,
  method: string,
  args: xdr.ScVal[],
): Promise<T> {
  const { tx, sim } = await simulate(source, method, args);
  if (rpc.Api.isSimulationError(sim)) throw new Error(friendlyError(sim.error));
  const prepared = rpc.assembleTransaction(tx, sim).build();
  const signed = await sign(prepared.toXDR());
  const sent = await server.sendTransaction(
    TransactionBuilder.fromXDR(signed, NETWORK_PASSPHRASE),
  );
  if (sent.status === "ERROR") throw new Error("Transaction rejected by network");
  const res = await server.pollTransaction(sent.hash, { attempts: 30 });
  if (res.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
    throw new Error(`Transaction failed (${res.status})`);
  }
  return (res.returnValue ? scValToNative(res.returnValue) : undefined) as T;
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
  "#9": "That agent is not authorised for this member",
};

function friendlyError(raw: string) {
  const m = raw.match(/Error\(Contract, (#\d+)\)/);
  return (m && ERRORS[m[1]]) || raw;
}

// ----- public API ----------------------------------------------------------

export const ajo = {
  createCircle: (me: string, sign: SignFn, token: string, amount: bigint, maxMembers: number, periodSecs: number) =>
    write<number>(me, sign, "create_circle", [addr(me), addr(token), i128(amount), u32(maxMembers), u64(periodSecs)]),

  join: (me: string, sign: SignFn, id: number) =>
    write(me, sign, "join", [u32(id), addr(me)]),

  contribute: (me: string, sign: SignFn, id: number) =>
    write(me, sign, "contribute", [u32(id), addr(me)]),

  setAgent: (me: string, sign: SignFn, id: number, agent: string) =>
    write(me, sign, "set_agent", [u32(id), addr(me), addr(agent)]),

  getCircle: async (viewer: string, id: number) =>
    normaliseCircle(await read<Record<string, unknown>>(viewer, "get_circle", [u32(id)])),

  circleCount: (viewer: string) => read<number>(viewer, "circle_count"),

  circlesOf: (viewer: string, who: string) => read<number[]>(viewer, "circles_of", [addr(who)]),

  paidThisRound: (viewer: string, id: number) => read<string[]>(viewer, "paid_this_round", [u32(id)]),

  roundDeadline: (viewer: string, id: number) => read<bigint>(viewer, "round_deadline", [u32(id)]),

  payouts: (viewer: string, id: number) => read<Payout[]>(viewer, "payouts", [u32(id)]),

  reputation: (viewer: string, who: string) => read<Reputation>(viewer, "reputation", [addr(who)]),
};
