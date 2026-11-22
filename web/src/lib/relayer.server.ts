import { Keypair, rpc, Transaction, TransactionBuilder, xdr } from "@stellar/stellar-sdk";
import { NETWORK_PASSPHRASE, RPC_URL } from "./config";

export const server = new rpc.Server(RPC_URL);

export function relayer(): Keypair {
  const s = process.env.RELAYER_SECRET;
  if (!s) throw new Error("RELAYER_SECRET is not configured");
  return Keypair.fromSecret(s);
}

// Serialise submissions inside this instance so two requests don't race for
// the same relayer sequence number.
let queue: Promise<unknown> = Promise.resolve();
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
}

/**
 * Rebuild `op` on the relayer's current sequence with the given fee and
 * Soroban resources, sign it as the relayer, submit and wait for the result.
 */
export function submitAsRelayer(
  op: xdr.Operation,
  fee: string,
  sorobanData?: xdr.SorobanTransactionData,
): Promise<{ hash: string; returnValue?: string }> {
  return exclusive(async () => {
    const kp = relayer();
    let lastErr: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      const account = await server.getAccount(kp.publicKey());
      const tx = new TransactionBuilder(account, { fee, networkPassphrase: NETWORK_PASSPHRASE, sorobanData })
        .addOperation(op)
        .setTimeout(60)
        .build();
      tx.sign(kp);
      const sent = await server.sendTransaction(tx);
      if (sent.status === "ERROR") {
        const code = sent.errorResult?.result.type ?? "unknown";
        lastErr = new Error(`Relayer submission rejected (${code})`);
        if (code === "txBadSeq") continue;
        throw lastErr;
      }
      const res = await server.pollTransaction(sent.hash, { attempts: 30 });
      if (res.status !== "SUCCESS") throw new Error(`Transaction failed (${res.status})`);
      return { hash: sent.hash, returnValue: res.returnValue?.toXDR("base64") };
    }
    throw lastErr;
  });
}

/**
 * Split a prepared tx's total fee back into (inclusion fee, resources).
 * `TransactionBuilder.build()` adds `sorobanData.resourceFee` on top of the fee
 * it is given, so callers pass only the inclusion part back in.
 */
function v1(tx: Transaction) {
  const env = tx.toEnvelope();
  if (env.type !== "envelopeTypeTx") throw new Error(`Unexpected envelope type ${env.type}`);
  return env.v1.tx;
}

export function feeParts(tx: Transaction): { fee: string; sorobanData?: xdr.SorobanTransactionData } {
  const ext = v1(tx).ext;
  const sorobanData = ext.type === "sorobanData" ? ext.sorobanData : undefined;
  const resource = sorobanData ? BigInt(sorobanData.resourceFee) : 0n;
  const inclusion = BigInt(tx.fee) - resource;
  return { fee: (inclusion > 0n ? inclusion : 100n).toString(), sorobanData };
}

/** The single operation of a prepared tx, as raw XDR (with assembled auth). */
export function firstOp(tx: Transaction): xdr.Operation {
  return v1(tx).operations[0];
}

/** Simulate `op` with the relayer as source, then submit it with the simulated resources. */
export async function prepareAndSubmit(op: xdr.Operation): Promise<{ hash: string; returnValue?: string }> {
  const kp = relayer();
  const account = await server.getAccount(kp.publicKey());
  const draft = new TransactionBuilder(account, { fee: "100", networkPassphrase: NETWORK_PASSPHRASE })
    .addOperation(op)
    .setTimeout(60)
    .build();
  const sim = await server.simulateTransaction(draft);
  if (rpc.Api.isSimulationError(sim)) throw new Error(sim.error);
  const prepared = rpc.assembleTransaction(draft, sim).build();
  const { fee, sorobanData } = feeParts(prepared);
  return submitAsRelayer(firstOp(prepared), fee, sorobanData);
}
