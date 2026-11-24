/**
 * POST /api/wallet {credentialId, publicKey, captchaToken?}
 *
 * Deploys the passkey smart wallet for a newly created passkey (the relayer
 * pays), and tops it up with a little XLM so the user can join a circle
 * straight away. Idempotent: an existing wallet is returned as is.
 *
 * Abuse controls (the relayer is a funded hot account):
 *  - per-IP rate limit on wallet creation
 *  - optional Cloudflare Turnstile (enforced when TURNSTILE_SECRET is set)
 *  - a global rolling daily cap on total XLM disbursed
 *  - env-configurable, conservative starter amount
 */
import { Address, Contract, nativeToScVal, Operation, xdr } from "@stellar/stellar-sdk";
import { Buffer } from "buffer";
import { TOKEN_CONTRACT_ID } from "@/lib/config";
import { b64url, PASSKEY_WASM_HASH, walletAddress, walletSalt } from "@/lib/passkey-address";
import { prepareAndSubmit, relayer, server } from "@/lib/relayer.server";
import { clientIp, consumeBudget, rateLimit } from "@/lib/ratelimit";
import { verifyCaptcha } from "@/lib/captcha";

const XLM = 10_000_000n; // stroops per XLM
const STARTER_FUNDS = BigInt(Math.round(Number(process.env.STARTER_FUNDS_XLM ?? "5") * 1e7));

const RL_MAX = Number(process.env.WALLET_RL_MAX ?? "3"); // per IP
const RL_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const DAY_MS = 24 * 60 * 60 * 1000;
const DAILY_FUNDING_CAP = Math.round(Number(process.env.DAILY_FUNDING_CAP_XLM ?? "500") * 1e7); // stroops

async function isDeployed(address: string) {
  try {
    await server.getContractData(address, xdr.ScVal.scvLedgerKeyContractInstance());
    return true;
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  const ip = clientIp(request);

  const rl = await rateLimit(`wallet:${ip}`, RL_MAX, RL_WINDOW_MS);
  if (!rl.ok) return Response.json({ error: "Too many requests" }, { status: 429 });

  let credentialId: string, publicKey: Uint8Array, captchaToken: string | undefined;
  try {
    const body = await request.json();
    credentialId = String(body.credentialId ?? "");
    publicKey = b64url.decode(String(body.publicKey ?? ""));
    captchaToken = body.captchaToken ? String(body.captchaToken) : undefined;
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
  if (!(await verifyCaptcha(captchaToken, ip))) {
    return Response.json({ error: "Captcha verification required" }, { status: 403 });
  }

  const address = walletAddress(credentialId);
  try {
    if (await isDeployed(address)) return Response.json({ address, created: false });

    // Only funds that fit inside today's global budget are disbursed.
    if (!(await consumeBudget("wallet:funding", Number(STARTER_FUNDS), DAILY_FUNDING_CAP, DAY_MS))) {
      return Response.json({ error: "Funding temporarily unavailable, try again later" }, { status: 503 });
    }

    const kp = relayer();
    await prepareAndSubmit(
      Operation.createCustomContract({
        address: Address.fromString(kp.publicKey()),
        wasmHash: Buffer.from(PASSKEY_WASM_HASH, "hex"),
        salt: walletSalt(credentialId),
        constructorArgs: [xdr.ScVal.scvBytes(Buffer.from(publicKey))],
      }),
    );
    if (STARTER_FUNDS > 0n) {
      await prepareAndSubmit(
        new Contract(TOKEN_CONTRACT_ID).call(
          "transfer",
          new Address(kp.publicKey()).toScVal(),
          new Address(address).toScVal(),
          nativeToScVal(STARTER_FUNDS, { type: "i128" }),
        ),
      );
    }
    return Response.json({ address, created: true });
  } catch (e) {
    console.error("wallet deploy failed", e);
    return Response.json({ error: e instanceof Error ? e.message : "Wallet deployment failed" }, { status: 502 });
  }
}
