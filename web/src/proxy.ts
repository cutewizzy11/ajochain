import { NextResponse, type NextRequest } from "next/server";

/**
 * Per-request Content-Security-Policy with a fresh nonce.
 *
 * Next injects this nonce into its own inline bootstrap scripts, so we can run
 * a strict `script-src` ('strict-dynamic' + nonce) without 'unsafe-inline' —
 * the main defense-in-depth win for a dApp that builds the transactions users
 * sign. The other directives are kept practical so the wallet connectors,
 * Stellar RPC/Horizon and the SEP-24 anchor/on-ramp keep working.
 */
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");

  // Next's dev-only Fast Refresh runtime uses eval(); allow it in development
  // only. Production builds have no react-refresh, so the policy stays strict.
  const devEval = process.env.NODE_ENV !== "production" ? " 'unsafe-eval'" : "";

  const csp = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'wasm-unsafe-eval'${devEval}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob: https:`,
    `font-src 'self' data:`,
    `connect-src 'self' https:`,
    `frame-src 'self' https:`,
    `worker-src 'self' blob:`,
    `base-uri 'none'`,
    `object-src 'none'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    `upgrade-insecure-requests`,
  ].join("; ");

  // Expose the nonce to the request so Next can tag its scripts with it.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("content-security-policy", csp);
  return response;
}

export const config = {
  matcher: [
    // All paths except Next internals and static assets. API routes are
    // included (harmless) so the policy is applied site-wide.
    {
      source: "/((?!_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
