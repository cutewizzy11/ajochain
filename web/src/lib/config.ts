import { Networks } from "@stellar/stellar-sdk";

export const RPC_URL =
  process.env.NEXT_PUBLIC_RPC_URL ?? "https://soroban-testnet.stellar.org";
export const NETWORK_PASSPHRASE =
  process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE ?? Networks.TESTNET;
/** Deployed AjoChain contract id (C...). Set after `stellar contract deploy`. */
export const AJO_CONTRACT_ID = process.env.NEXT_PUBLIC_AJO_CONTRACT_ID ?? "";
/** Token used for contributions — testnet USDC SAC by default. */
export const TOKEN_CONTRACT_ID = process.env.NEXT_PUBLIC_TOKEN_CONTRACT_ID ?? "";
export const TOKEN_DECIMALS = 7;
export const TOKEN_SYMBOL = process.env.NEXT_PUBLIC_TOKEN_SYMBOL ?? "USDC";
