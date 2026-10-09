/**
 * Connection-error classification and reconnect policy for the Hermes Gateway
 * bridge.
 *
 * Ground truth from the installed Gateway (0.21.5): in loopback/headless mode
 * the server mints a fresh dashboard session token per process start
 * (`hermes_cli/web_server.py::_resolve_session_token`) and injects it as
 * `window.__HERMES_SESSION_TOKEN__` in the root HTML. A token captured from a
 * previous start makes the `/api/ws` upgrade fail with HTTP 401/403.
 *
 * That failure is permanent for the life of this Next.js process — the token is
 * read from the environment once at boot — so retrying it like a transient
 * network drop just hammers the Gateway with a 403 loop. Auth failures stop the
 * loop and surface a sanitized, actionable message; transient failures retry
 * with capped exponential backoff.
 */

export type GatewayErrorKind = "auth" | "transient" | "unknown";

export interface GatewayConnectionError {
  kind: GatewayErrorKind;
  /** Sanitized, credential-free message safe to log and render. */
  message: string;
}

export interface ReconnectDecision {
  retry: boolean;
  delayMs: number;
}

export const RECONNECT_BASE_DELAY_MS = 1000;
export const RECONNECT_MAX_DELAY_MS = 15000;

/**
 * `ws` reports a rejected upgrade as "Unexpected server response: 403"; the
 * auth gate's HTTP response is 401. Both mean the session token is wrong or
 * stale. Keep this pattern free of anything that could carry a credential.
 */
const AUTH_PATTERN =
  /unexpected server response:\s*(401|403)|\b(401|403)\b|unauthoriz|forbidden|invalid[ _-]?token|session token/i;

const TRANSIENT_PATTERN =
  /econnrefused|econnreset|etimedout|ehostunreach|enetunreach|epipe|eai_again|socket hang up|terminated|network|timeout|closed before the connection/i;

export const AUTH_RECOVERY_HINT =
  "Gateway rejected the session token (HTTP 401/403). Refresh HERMES_SESSION_TOKEN in hermes-office/.env.local from the Gateway root HTML, then restart the Next.js dev server.";

export function classifyGatewayError(raw: string): GatewayConnectionError {
  const message = typeof raw === "string" ? raw : "";

  if (AUTH_PATTERN.test(message)) {
    return { kind: "auth", message: AUTH_RECOVERY_HINT };
  }

  if (TRANSIENT_PATTERN.test(message)) {
    return { kind: "transient", message };
  }

  return { kind: "unknown", message };
}

/** Exponential backoff for the given 1-based attempt, capped at `maxDelayMs`. */
export function reconnectDelayForAttempt(
  attempt: number,
  baseDelayMs: number = RECONNECT_BASE_DELAY_MS,
  maxDelayMs: number = RECONNECT_MAX_DELAY_MS,
): number {
  const safeAttempt = attempt > 1 ? Math.floor(attempt) : 1;

  return Math.min(baseDelayMs * 2 ** (safeAttempt - 1), maxDelayMs);
}

/**
 * Permanent auth failures must not be retried automatically (a fresh
 * in-process token source is the only fix); everything else retries.
 */
export function decideReconnect(
  kind: GatewayErrorKind,
  attempt: number,
): ReconnectDecision {
  if (kind === "auth") {
    return { retry: false, delayMs: 0 };
  }

  return { retry: true, delayMs: reconnectDelayForAttempt(attempt) };
}
