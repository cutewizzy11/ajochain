/**
 * Optional Cloudflare Turnstile verification.
 *
 * Enforced only when TURNSTILE_SECRET is set. When it is, the client must send
 * a `captchaToken` (from the Turnstile widget) and it is verified server-side
 * before the relayer spends anything. When the secret is absent, verification
 * is skipped so existing/testnet flows keep working — set the secret (and add
 * the widget to the client) before mainnet to stop scripted abuse.
 */
const secret = process.env.TURNSTILE_SECRET;

export const captchaRequired = Boolean(secret);

export async function verifyCaptcha(token: string | undefined, ip: string): Promise<boolean> {
  if (!secret) return true; // not configured -> no-op
  if (!token) return false;
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret, response: token, remoteip: ip }),
      cache: "no-store",
    });
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    return false;
  }
}
