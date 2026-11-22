/**
 * POST /api/wallet {credentialId, publicKey}
 *
 * Deploys the passkey smart wallet for a newly created passkey (the relayer
 * pays), and tops it up with a little testnet XLM so the user can join a
 * circle straight away. Idempotent: an existing wallet is returned as is.
 */
import { Address, Contract, nativeToScVal, Operation, xdr } from "@stellar/stellar-sdk";
import { Buffer } from "buffer";
import { TOKEN_CONTRACT_ID } from "@/lib/config";
import { b64url, PASSKEY_WASM_HASH, walletAddress, walletSalt } from "@/lib/passkey-address";
import { prepareAndSubmit, relayer, server } from "@/lib/relayer.server";

const STARTER_FUNDS = 50n * 10_000_000n; // 50 XLM

async function isDeployed(address: string) {
  try {
    await server.getContractData(address, xdr.ScVal.scvLedgerKeyContractInstance());
    return true;
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  let credentialId: string, publicKey: Uint8Array;
  try {
    const body = await request.json();
    credentialId = String(body.credentialId ?? "");
    publicKey = b64url.decode(String(body.publicKey ?? ""));
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (!credentialId || credentialId.length > 512 || b64url.decode(credentialId).length < 16) {
    return Response.json({ error: "Invalid credentialId" }, { status: 400 });
  }
  if (publicKey.length !== 65 || publicKey[0] !== 0x04) {
    return Response.json({ error: "publicKey must be an uncompressed P-256 point" }, { status: 400 });
  }
  if (!PASSKEY_WASM_HASH) {
    return Response.json({ error: "Passkey wallets are not configured" }, { status: 500 });
  }

  const address = walletAddress(credentialId);
  try {
    if (await isDeployed(address)) return Response.json({ address, created: false });

    const kp = relayer();
    await prepareAndSubmit(
      Operation.createCustomContract({
        address: Address.fromString(kp.publicKey()),
        wasmHash: Buffer.from(PASSKEY_WASM_HASH, "hex"),
        salt: walletSalt(credentialId),
        constructorArgs: [xdr.ScVal.scvBytes(Buffer.from(publicKey))],
      }),
    );
    await prepareAndSubmit(
      new Contract(TOKEN_CONTRACT_ID).call(
        "transfer",
        new Address(kp.publicKey()).toScVal(),
        new Address(address).toScVal(),
        nativeToScVal(STARTER_FUNDS, { type: "i128" }),
      ),
    );
    return Response.json({ address, created: true });
  } catch (e) {
    console.error("wallet deploy failed", e);
    return Response.json({ error: e instanceof Error ? e.message : "Wallet deployment failed" }, { status: 502 });
  }
}
