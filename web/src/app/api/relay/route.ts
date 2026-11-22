/**
 * POST /api/relay {xdr}
 *
 * Fee sponsorship for passkey wallets. The client sends a simulated, assembled
 * transaction whose auth entries are already signed by the user's passkey; the
 * relayer re-wraps the operation in its own transaction, pays the fee and
 * submits it. Only AjoChain / token calls are relayed, and never anything the
 * relayer itself would have to authorise.
 */
import { Address, TransactionBuilder } from "@stellar/stellar-sdk";
import { AJO_CONTRACT_ID, NETWORK_PASSPHRASE, TOKEN_CONTRACT_ID } from "@/lib/config";
import { feeParts, firstOp, relayer, submitAsRelayer } from "@/lib/relayer.server";

const ALLOWED_CONTRACTS = new Set([AJO_CONTRACT_ID, TOKEN_CONTRACT_ID]);
const MAX_FEE = 10n * 10_000_000n; // 10 XLM

function bad(error: string, status = 400) {
  return Response.json({ error }, { status });
}

export async function POST(request: Request) {
  let tx;
  try {
    const body = await request.json();
    const parsed = TransactionBuilder.fromXDR(String(body.xdr ?? ""), NETWORK_PASSPHRASE);
    if ("innerTransaction" in parsed) return bad("Fee-bump transactions are not accepted");
    tx = parsed;
  } catch {
    return bad("Invalid transaction XDR");
  }

  if (tx.operations.length !== 1) return bad("Expected exactly one operation");
  const op = firstOp(tx);
  if (op.sourceAccount) return bad("Operation source account is not allowed");
  if (op.body.type !== "invokeHostFunction") return bad("Only contract calls are relayed");

  const { hostFunction, auth } = op.body.invokeHostFunctionOp;
  if (hostFunction.type !== "hostFunctionTypeInvokeContract") return bad("Only contract calls are relayed");
  const target = Address.fromScAddress(hostFunction.invokeContract.contractAddress).toString();
  if (!ALLOWED_CONTRACTS.has(target)) return bad("Contract not allowed");

  const relayerAddress = relayer().publicKey();
  for (const entry of auth ?? []) {
    const c = entry.credentials;
    // V1 or CAP-71 V2 address credentials only: no source-account auth, no delegates.
    const creds =
      c.type === "sorobanCredentialsAddress" ? c.address : c.type === "sorobanCredentialsAddressV2" ? c.addressV2 : null;
    if (!creds) return bad("Only address authorisation is allowed");
    if (Address.fromScAddress(creds.address).toString() === relayerAddress) {
      return bad("Relayer authorisation is not allowed");
    }
  }

  const { fee, sorobanData } = feeParts(tx);
  const total = BigInt(fee) + (sorobanData ? BigInt(sorobanData.resourceFee) : 0n);
  if (total > MAX_FEE) return bad("Fee too high");

  try {
    const res = await submitAsRelayer(op, fee, sorobanData);
    return Response.json(res);
  } catch (e) {
    console.error("relay failed", e);
    return bad(e instanceof Error ? e.message : "Relay failed", 502);
  }
}
