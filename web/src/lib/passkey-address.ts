import { Address, hash, StrKey, xdr } from "@stellar/stellar-sdk";
import { Buffer } from "buffer";
import { NETWORK_PASSPHRASE } from "./config";

export const PASSKEY_WASM_HASH = process.env.NEXT_PUBLIC_PASSKEY_WASM_HASH ?? "";
export const RELAYER_ADDRESS = process.env.NEXT_PUBLIC_RELAYER_ADDRESS ?? "";

export const b64url = {
  encode: (b: Uint8Array) =>
    Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""),
  decode: (s: string) => new Uint8Array(Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64")),
};

/** Salt for the wallet's contract id: one wallet per passkey credential. */
export function walletSalt(credentialId: string): Buffer {
  return Buffer.from(hash(b64url.decode(credentialId)));
}

/**
 * The relayer deploys every wallet, so its address is fully determined by
 * (relayer, credential id). That lets a returning user on a fresh browser find
 * their wallet from nothing but the passkey they sign in with.
 */
export function walletAddress(credentialId: string): string {
  const preimage = xdr.HashIdPreimage.envelopeTypeContractId(
    new xdr.HashIdPreimageContractId({
      networkId: hash(Buffer.from(NETWORK_PASSPHRASE)),
      contractIdPreimage: xdr.ContractIdPreimage.contractIdPreimageFromAddress(
        new xdr.ContractIdPreimageFromAddress({
          address: Address.fromString(RELAYER_ADDRESS).toScAddress(),
          salt: walletSalt(credentialId),
        }),
      ),
    }),
  );
  return StrKey.encodeContract(hash(preimage.toXDR()));
}
