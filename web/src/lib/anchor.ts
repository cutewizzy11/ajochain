"use client";

import { Asset, BASE_FEE, Horizon, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import { useEffect, useState } from "react";
import { NETWORK_PASSPHRASE, TOKEN_SYMBOL } from "./config";
import type { SignFn } from "./ajo";

/**
 * Naira on- and off-ramp through a Stellar anchor (SEP-10 auth + SEP-24 interactive flows).
 * The anchor only converts at the edges: naira -> tokens in YOUR wallet, tokens -> naira in YOUR bank.
 * It never holds the circle's pot; the pot lives in the Soroban contract.
 */
export const ANCHOR_DOMAIN = process.env.NEXT_PUBLIC_ANCHOR_DOMAIN ?? "testanchor.stellar.org";
export const ANCHOR_ASSET = process.env.NEXT_PUBLIC_ANCHOR_ASSET ?? "USDC";
const HORIZON_URL = process.env.NEXT_PUBLIC_HORIZON_URL ?? "https://horizon-testnet.stellar.org";

type Toml = { WEB_AUTH_ENDPOINT: string; TRANSFER_SERVER_SEP0024: string; issuer?: string };
let tomlCache: Promise<Toml> | null = null;

async function toml(): Promise<Toml> {
  tomlCache ??= fetch(`https://${ANCHOR_DOMAIN}/.well-known/stellar.toml`)
    .then((r) => r.text())
    .then((t) => {
      const get = (k: string) => t.match(new RegExp(`^${k}\\s*=\\s*"([^"]+)"`, "m"))?.[1] ?? "";
      const block = t.split("[[CURRENCIES]]").find((b) => new RegExp(`code\\s*=\\s*"${ANCHOR_ASSET}"`).test(b));
      return {
        WEB_AUTH_ENDPOINT: get("WEB_AUTH_ENDPOINT"),
        TRANSFER_SERVER_SEP0024: get("TRANSFER_SERVER_SEP0024"),
        issuer: block?.match(/issuer\s*=\s*"([^"]+)"/)?.[1],
      };
    });
  return tomlCache;
}

const jwts = new Map<string, string>();

/** SEP-10: prove wallet ownership to the anchor; the wallet signs a no-op challenge. */
async function auth(account: string, sign: SignFn): Promise<string> {
  const cached = jwts.get(account);
  if (cached) return cached;
  const { WEB_AUTH_ENDPOINT } = await toml();
  const ch = await fetch(`${WEB_AUTH_ENDPOINT}?account=${account}`).then((r) => r.json());
  if (!ch.transaction) throw new Error(ch.error ?? "Anchor refused the login challenge");
  const signed = await sign(ch.transaction);
  const res = await fetch(WEB_AUTH_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transaction: signed }),
  }).then((r) => r.json());
  if (!res.token) throw new Error(res.error ?? "Anchor login failed");
  jwts.set(account, res.token);
  return res.token;
}

/** Wallets need a trustline before an anchor can send them a classic asset. */
async function ensureTrustline(account: string, sign: SignFn) {
  const { issuer } = await toml();
  if (!issuer) return;
  const horizon = new Horizon.Server(HORIZON_URL);
  const acct = await horizon.loadAccount(account);
  const has = acct.balances.some(
    (b) => "asset_code" in b && b.asset_code === ANCHOR_ASSET && "asset_issuer" in b && b.asset_issuer === issuer,
  );
  if (has) return;
  const tx = new TransactionBuilder(acct, { fee: BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE })
    .addOperation(Operation.changeTrust({ asset: new Asset(ANCHOR_ASSET, issuer) }))
    .setTimeout(120)
    .build();
  const signed = await sign(tx.toXDR());
  await horizon.submitTransaction(TransactionBuilder.fromXDR(signed, NETWORK_PASSPHRASE));
}

/**
 * SEP-24 interactive deposit (naira in) or withdraw (naira out to bank).
 * Opens the popup synchronously so browsers don't block it, then points it at the anchor's KYC/payment page.
 */
export async function rampFlow(kind: "deposit" | "withdraw", account: string, sign: SignFn, amount?: string) {
  const popup = window.open("about:blank", "anchor", "width=480,height=720");
  try {
    if (kind === "deposit") await ensureTrustline(account, sign);
    const token = await auth(account, sign);
    const { TRANSFER_SERVER_SEP0024 } = await toml();
    const body: Record<string, string> = { asset_code: ANCHOR_ASSET, account, lang: "en" };
    if (amount) body.amount = amount;
    const res = await fetch(`${TRANSFER_SERVER_SEP0024}/transactions/${kind}/interactive`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    }).then((r) => r.json());
    if (!res.url) throw new Error(res.error ?? "Anchor did not return a payment page");
    if (popup) popup.location.href = res.url;
    else window.location.href = res.url;
    return res.id as string;
  } catch (e) {
    popup?.close();
    throw e;
  }
}

/* ---------------- naira pricing ---------------- */

const GECKO_ID: Record<string, string> = { USDC: "usd-coin", XLM: "stellar", EURC: "euro-coin" };
const FALLBACK_NGN: Record<string, number> = { USDC: 1350, XLM: 175, NGNC: 1, EURC: 1460 };

/** Live ₦ price of one unit of `symbol` (falls back to a recent rate if offline). */
export function useNgnRate(symbol: string = TOKEN_SYMBOL) {
  const [rate, setRate] = useState<number>(FALLBACK_NGN[symbol] ?? FALLBACK_NGN.USDC);
  const [live, setLive] = useState(false);
  useEffect(() => {
    const id = GECKO_ID[symbol];
    if (!id) return;
    let off = false;
    fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=ngn`)
      .then((r) => r.json())
      .then((j) => {
        const v = Number(j?.[id]?.ngn);
        if (!off && v > 0) {
          setRate(v);
          setLive(true);
        }
      })
      .catch(() => {});
    return () => {
      off = true;
    };
  }, [symbol]);
  return { rate, live };
}

export const naira = (n: number) =>
  `₦${n.toLocaleString("en-NG", { maximumFractionDigits: n >= 100 ? 0 : 2 })}`;
