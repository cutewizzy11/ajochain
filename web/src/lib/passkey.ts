/**
 * Browser side of the passkey smart wallet: create a passkey, sign in with it,
 * and turn a WebAuthn assertion into the `Signature` struct the wallet
 * contract's `__check_auth` expects.
 */
import { xdr } from "@stellar/stellar-sdk";
import { Buffer } from "buffer";
import { b64url, walletAddress } from "./passkey-address";

export type PasskeyWallet = { credentialId: string; address: string };

const STORAGE_KEY = "ajochain:passkey";

export function passkeysSupported(): boolean {
  return typeof window !== "undefined" && !!window.PublicKeyCredential && !!navigator.credentials;
}

export function loadPasskey(): PasskeyWallet | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as PasskeyWallet) : null;
  } catch {
    return null;
  }
}

export function savePasskey(w: PasskeyWallet | null) {
  try {
    if (w) localStorage.setItem(STORAGE_KEY, JSON.stringify(w));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable: session-only login */
  }
}

const random = (n: number) => crypto.getRandomValues(new Uint8Array(n));

/** Create a new passkey and have the relayer deploy + fund its wallet contract. */
export async function registerPasskey(name: string): Promise<PasskeyWallet> {
  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge: random(32),
      rp: { name: "AjoChain" },
      user: { id: random(16), name, displayName: name },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }], // ES256 = P-256
      authenticatorSelection: { residentKey: "required", userVerification: "required" },
      attestation: "none",
      timeout: 120_000,
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error("Passkey creation was cancelled");

  const res = cred.response as AuthenticatorAttestationResponse;
  const spki = res.getPublicKey?.();
  if (!spki) throw new Error("This browser can't export the passkey's public key — try Chrome, Safari or Edge");
  // SPKI for P-256 ends with the 65-byte uncompressed point 0x04 || x || y.
  const publicKey = new Uint8Array(spki).slice(-65);

  const credentialId = b64url.encode(new Uint8Array(cred.rawId));
  const r = await fetch("/api/wallet", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ credentialId, publicKey: b64url.encode(publicKey) }),
  });
  const body = (await r.json().catch(() => ({}))) as { address?: string; error?: string };
  if (!r.ok || !body.address) throw new Error(body.error ?? "Couldn't create your wallet");
  if (body.address !== walletAddress(credentialId)) throw new Error("Wallet address mismatch");

  const wallet = { credentialId, address: body.address };
  savePasskey(wallet);
  return wallet;
}

/** Sign in with any passkey already on this device / synced to this account. */
export async function loginPasskey(): Promise<PasskeyWallet> {
  const cred = (await navigator.credentials.get({
    publicKey: { challenge: random(32), userVerification: "required", timeout: 120_000 },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error("Sign-in was cancelled");
  const credentialId = b64url.encode(new Uint8Array(cred.rawId));
  const wallet = { credentialId, address: walletAddress(credentialId) };
  savePasskey(wallet);
  return wallet;
}

// secp256r1 group order, for low-S normalisation (the host rejects high-S).
const N = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;

const toBig = (b: Uint8Array) => BigInt("0x" + (Buffer.from(b).toString("hex") || "0"));
const to32 = (n: bigint) => Buffer.from(n.toString(16).padStart(64, "0"), "hex");

/** DER `SEQUENCE { INTEGER r, INTEGER s }` -> raw 64-byte r || s with low S. */
export function derToRaw(der: Uint8Array): Buffer {
  let i = 0;
  if (der[i++] !== 0x30) throw new Error("Bad signature encoding");
  if (der[i] & 0x80) i += 1 + (der[i] & 0x7f);
  else i++;
  const int = () => {
    if (der[i++] !== 0x02) throw new Error("Bad signature encoding");
    const len = der[i++];
    const v = der.slice(i, i + len);
    i += len;
    return toBig(v);
  };
  const r = int();
  let s = int();
  if (s > N / 2n) s = N - s;
  return Buffer.concat([to32(r), to32(s)]);
}

/**
 * Ask the passkey to sign a 32-byte Soroban auth payload. The payload is the
 * WebAuthn challenge, which is what `__check_auth` checks for.
 */
export async function signWithPasskey(credentialId: string, payload: Uint8Array): Promise<xdr.ScVal> {
  const cred = (await navigator.credentials.get({
    publicKey: {
      challenge: new Uint8Array(payload),
      allowCredentials: [{ type: "public-key", id: b64url.decode(credentialId) }],
      userVerification: "required",
      timeout: 120_000,
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error("Signing was cancelled");
  const res = cred.response as AuthenticatorAssertionResponse;

  const entry = (key: string, val: Uint8Array) =>
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(key), val: xdr.ScVal.scvBytes(Buffer.from(val)) });
  // Keys must be in sorted order to match the contract's struct encoding.
  return xdr.ScVal.scvMap([
    entry("authenticator_data", new Uint8Array(res.authenticatorData)),
    entry("client_data_json", new Uint8Array(res.clientDataJSON)),
    entry("signature", derToRaw(new Uint8Array(res.signature))),
  ]);
}
