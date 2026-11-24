/**
 * Rate limiting + spend budgets for the relayer endpoints.
 *
 * The relayer is a funded hot account: /api/wallet hands out starter XLM and
 * /api/relay pays transaction fees. Without limits, either endpoint can be
 * scripted to drain it. These helpers blunt that.
 *
 * Backing store:
 *  - If UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN are set, limits are
 *    enforced in Redis — shared across all serverless instances (recommended
 *    for production / mainnet).
 *  - Otherwise a best-effort in-memory store is used. It is per-instance and
 *    resets on cold start, so it only slows casual abuse. Configure Upstash
 *    (or Vercel KV) before handling real funds.
 */

const upstashUrl = process.env.UPSTASH_REDIS_REST_URL;
const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN;
const useUpstash = Boolean(upstashUrl && upstashToken);

export type Decision = { ok: boolean; remaining: number };

/** Best-effort client IP from standard proxy headers (Vercel sets these). */
export function clientIp(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

// ---------------------------------------------------------------------------
// Upstash Redis REST helper
// ---------------------------------------------------------------------------
async function redis(cmd: (string | number)[]): Promise<unknown> {
  const res = await fetch(upstashUrl!, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${upstashToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(cmd),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Upstash error ${res.status}`);
  const json = (await res.json()) as { result?: unknown; error?: string };
  if (json.error) throw new Error(json.error);
  return json.result;
}

// ---------------------------------------------------------------------------
// In-memory fallback
// ---------------------------------------------------------------------------
const windows = new Map<string, number[]>(); // key -> request timestamps (ms)
const budgets = new Map<string, { used: number; resetAt: number }>();

function memRateLimit(key: string, limit: number, windowMs: number): Decision {
  const now = Date.now();
  const arr = (windows.get(key) ?? []).filter((t) => now - t < windowMs);
  if (arr.length >= limit) {
    windows.set(key, arr);
    return { ok: false, remaining: 0 };
  }
  arr.push(now);
  windows.set(key, arr);
  return { ok: true, remaining: limit - arr.length };
}

function memBudget(key: string, amount: number, cap: number, windowMs: number): boolean {
  const now = Date.now();
  const b = budgets.get(key);
  if (!b || now >= b.resetAt) {
    if (amount > cap) return false;
    budgets.set(key, { used: amount, resetAt: now + windowMs });
    return true;
  }
  if (b.used + amount > cap) return false;
  b.used += amount;
  return true;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Fixed-window rate limit. Returns ok=false once `limit` is exceeded in `windowMs`. */
export async function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): Promise<Decision> {
  if (!useUpstash) return memRateLimit(key, limit, windowMs);
  try {
    const count = Number(await redis(["INCR", `rl:${key}`]));
    if (count === 1) await redis(["PEXPIRE", `rl:${key}`, windowMs]);
    return { ok: count <= limit, remaining: Math.max(0, limit - count) };
  } catch {
    // Fail closed-ish: if the limiter is unreachable, fall back to in-memory
    // rather than letting unlimited traffic through.
    return memRateLimit(key, limit, windowMs);
  }
}

/**
 * Consume `amount` (integer units, e.g. stroops) from a rolling budget that
 * resets every `windowMs`. Returns false when the cap would be exceeded, so
 * the caller can refuse the spend. Use for daily disbursement / fee caps.
 */
export async function consumeBudget(
  key: string,
  amount: number,
  cap: number,
  windowMs: number,
): Promise<boolean> {
  if (!useUpstash) return memBudget(key, amount, cap, windowMs);
  try {
    const used = Number(await redis(["INCRBY", `bud:${key}`, Math.round(amount)]));
    if (used === Math.round(amount)) await redis(["PEXPIRE", `bud:${key}`, windowMs]);
    if (used > cap) {
      // roll back the overshoot so a rejected spend doesn't permanently poison
      // the window
      await redis(["DECRBY", `bud:${key}`, Math.round(amount)]);
      return false;
    }
    return true;
  } catch {
    return memBudget(key, amount, cap, windowMs);
  }
}
