/**
 * Local trusted-operator guard for state-changing runtime lifecycle controls.
 *
 * MINPOP is a local control surface. Lifecycle endpoints (start/retry) must
 * only be reachable from a loopback origin to prevent a random website from
 * driving the operator's local runtimes via the browser (CSRF / DNS rebinding).
 *
 * The checks are intentionally strict and fail closed:
 * - `Host` header must resolve to a loopback hostname.
 * - When an `Origin` header is present it must also be loopback.
 */
const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"]);

/** Strip an optional `:port` from a host header value. */
export function hostnameFromHostHeader(hostHeader: string | null): string | null {
  if (!hostHeader) return null;
  let value = hostHeader.trim().toLowerCase();
  if (!value) return null;

  // IPv6 literal: [::1]:3000
  if (value.startsWith("[")) {
    const end = value.indexOf("]");
    if (end === -1) return null;
    return value.slice(0, end + 1);
  }

  const colon = value.lastIndexOf(":");
  if (colon !== -1 && value.indexOf(":") === colon) {
    value = value.slice(0, colon);
  }
  return value || null;
}

export function isLoopbackHostname(hostname: string | null): boolean {
  if (!hostname) return false;
  return LOOPBACK_HOSTNAMES.has(hostname.toLowerCase());
}

export interface TrustDecision {
  ok: boolean;
  reason?: string;
}

/**
 * Decide whether a request originates from the local trusted operator context.
 * `headers` is a standard Fetch `Headers` (or compatible) bag.
 */
export function isTrustedOperatorRequest(headers: Headers): TrustDecision {
  const hostHeader = headers.get("host");
  const hostname = hostnameFromHostHeader(hostHeader);

  // When bound to loopback, Next always sends a Host header. Missing/opaque
  // Host values (e.g. some proxies) are rejected rather than trusted.
  if (!hostname) {
    return { ok: false, reason: "Missing or invalid Host header." };
  }
  if (!isLoopbackHostname(hostname)) {
    return { ok: false, reason: "Lifecycle controls are restricted to loopback clients." };
  }

  const origin = headers.get("origin");
  if (origin) {
    let originHost: string | null = null;
    try {
      originHost = new URL(origin).hostname;
    } catch {
      return { ok: false, reason: "Invalid Origin header." };
    }
    if (!isLoopbackHostname(originHost)) {
      return { ok: false, reason: "Cross-origin lifecycle requests are not allowed." };
    }
  }

  return { ok: true };
}
