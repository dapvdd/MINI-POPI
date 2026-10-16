/**
 * Typed runtime lifecycle contract (Phase K.3).
 *
 * This layer sits *on top of* the existing `RuntimeAdapter` health contract.
 * It adds lifecycle state, process/listener evidence, and operator-facing
 * diagnostics/actions without changing any existing adapter or API shape.
 *
 * Design rules:
 * - Never claim a runtime is "stopped" purely because a health check failed.
 *   Listener/process evidence is tracked separately (`process.listening`).
 * - Never surface credentials. All error text passes through `sanitizeError`.
 * - A runtime being offline must not disable the other runtime; callers check
 *   each runtime independently.
 */
import type { RuntimeHealth, RuntimeId } from "./types";

export type RuntimeLifecycleState =
  | "unconfigured" // not configured / not registered at all
  | "healthy" // reachable and healthy
  | "starting" // a start attempt is currently in progress
  | "stopped" // process/listener evidence says nothing is listening
  | "unreachable" // configured, health failed, process state unknown
  | "failed" // process is listening but health still fails
  | "unsupported"; // lifecycle action not available for this runtime

export interface RuntimeProcessEvidence {
  /**
   * - `true`  : the runtime endpoint was observed accepting connections
   * - `false` : the endpoint was confirmed closed (process absent)
   * - `null`  : unknown (no evidence gathered / check inconclusive)
   */
  listening: boolean | null;
  detail?: string | null;
}

export interface RuntimeLifecycleAction {
  id: "start" | "refresh";
  label: string;
  supported: boolean;
  /** Why the action is unavailable (sanitized), when `supported` is false. */
  reason?: string | null;
}

export interface RuntimeDiagnostics {
  runtime: RuntimeId;
  state: RuntimeLifecycleState;
  configured: boolean;
  endpoint: string | null;
  reachable: boolean;
  healthy: boolean;
  /** Human-safe description of the verified lifecycle mechanism. */
  mechanism: string | null;
  process: RuntimeProcessEvidence;
  actions: RuntimeLifecycleAction[];
  lastCheck: number;
  lastHealthyAt: number | null;
  /** Sanitized error (no credentials), or null. */
  error: string | null;
  /** Sanitized remediation hint, or null. */
  remediation: string | null;
  version: string | null;
}

const REDACTED = "[redacted]";
const MAX_ERROR_LEN = 300;

/**
 * Remove credentials/secrets from any string before it leaves the server.
 * Conservative: redacts token/password/authorization payloads and long
 * base64-ish blobs (which is what Basic/Bearer credentials look like).
 */
export function sanitizeError(input: unknown): string | null {
  if (input === null || input === undefined) return null;

  let text: string;
  if (typeof input === "string") text = input;
  else if (input instanceof Error) text = input.message;
  else text = String(input);

  text = text
    // Authorization / Basic / Bearer headers
    .replace(/\b(authorization|bearer|basic)\b\s*[:=]?\s*[^\s,;]+/gi, `$1 ${REDACTED}`)
    // key=value style secrets
    .replace(
      /\b(token|password|passwd|secret|api[_-]?key|access[_-]?token)\b\s*[:=]\s*[^\s,;&]+/gi,
      `$1=${REDACTED}`,
    )
    // query-string token / password params left inline in a URL
    .replace(/([?&](?:token|password|secret|api[_-]?key)=)[^&\s]+/gi, `$1${REDACTED}`)
    // long base64/hex blobs (Basic/Bearer payloads, random secrets)
    .replace(/\b[A-Za-z0-9+/_-]{24,}={0,3}/g, REDACTED)
    .replace(/\s+/g, " ")
    .trim();

  if (!text) return null;
  if (text.length > MAX_ERROR_LEN) text = `${text.slice(0, MAX_ERROR_LEN)}…`;
  return text;
}

export interface ResolveLifecycleStateInput {
  configured: boolean;
  healthy: boolean;
  starting?: boolean;
  listening: boolean | null;
}

/**
 * Pure state machine mapping evidence → lifecycle state.
 * Priority: unconfigured → starting → healthy → stopped (evidence) →
 * failed (listening but unhealthy) → unreachable (unknown process state).
 */
export function resolveLifecycleState(input: ResolveLifecycleStateInput): RuntimeLifecycleState {
  if (!input.configured) return "unconfigured";
  if (input.starting) return "starting";
  if (input.healthy) return "healthy";
  if (input.listening === false) return "stopped";
  if (input.listening === true) return "failed";
  return "unreachable";
}

export interface DescribeActionsInput {
  runtime: RuntimeId;
  state: RuntimeLifecycleState;
  startupSupported: boolean;
  startupReason?: string | null;
}

/**
 * Compute the operator actions available for a runtime in a given state.
 * `start` is only offered when startup is verified/implemented *and* the
 * runtime is not already healthy/starting.
 */
export function describeActions(input: DescribeActionsInput): RuntimeLifecycleAction[] {
  const { runtime, state, startupSupported, startupReason } = input;

  const startable =
    state === "stopped" || state === "unreachable" || state === "failed";

  const startSupported = startupSupported && startable;

  let startReason: string | null = null;
  if (!startupSupported) {
    startReason = startupReason ?? "Automatic startup is not available for this runtime.";
  } else if (state === "healthy") {
    startReason = `${label(runtime)} is already healthy.`;
  } else if (state === "starting") {
    startReason = "A start attempt is already in progress.";
  } else if (state === "unconfigured") {
    startReason = "Runtime is not configured; startup is disabled.";
  }

  return [
    { id: "refresh", label: "Refresh", supported: true },
    {
      id: "start",
      label: state === "stopped" ? "Start" : "Retry",
      supported: startSupported,
      reason: startSupported ? null : startReason,
    },
  ];
}

/** Actionable, sanitized remediation hint per runtime/state. */
export function remediationFor(runtime: RuntimeId, state: RuntimeLifecycleState): string | null {
  const name = label(runtime);
  switch (state) {
    case "unconfigured":
      return runtime === "opencode"
        ? "OpenCode service is not registered (service.json missing). Start OpenCode once so it registers its background service."
        : "HERMES_SESSION_TOKEN is not configured. Set it in .env.local.";
    case "stopped":
      return runtime === "opencode"
        ? "OpenCode background service is not listening. Use Start, or run `opencode service start`."
        : "Hermes dashboard is not listening on 127.0.0.1:9119. Use Start, or run `hermes dashboard --no-open --skip-build`.";
    case "failed":
      return `${name} is listening but failed its health check. Check authentication/credentials and the runtime logs.`;
    case "unreachable":
      return `${name} is configured but did not respond, and process state is unknown. Retry the health check.`;
    case "starting":
      return `A ${name} start attempt is in progress; wait for it to complete.`;
    default:
      return null;
  }
}

export interface BuildDiagnosticsInput {
  runtime: RuntimeId;
  health: RuntimeHealth;
  configured: boolean;
  endpoint: string | null;
  listening: boolean | null;
  listeningDetail?: string | null;
  starting?: boolean;
  startupSupported: boolean;
  startupReason?: string | null;
  mechanism?: string | null;
  lastHealthyAt?: number | null;
}

/** Assemble the full diagnostics record from raw evidence. */
export function buildDiagnostics(input: BuildDiagnosticsInput): RuntimeDiagnostics {
  const healthy = Boolean(input.health.connected && input.health.reachable);
  const state = resolveLifecycleState({
    configured: input.configured,
    healthy,
    starting: input.starting,
    listening: input.listening,
  });

  return {
    runtime: input.runtime,
    state,
    configured: input.configured,
    endpoint: input.endpoint,
    reachable: Boolean(input.health.reachable),
    healthy,
    mechanism: input.mechanism ?? null,
    process: {
      listening: input.listening,
      detail: sanitizeError(input.listeningDetail) ?? null,
    },
    actions: describeActions({
      runtime: input.runtime,
      state,
      startupSupported: input.startupSupported,
      startupReason: input.startupReason,
    }),
    lastCheck: input.health.lastCheck ?? Date.now(),
    lastHealthyAt: healthy ? (input.health.lastCheck ?? Date.now()) : (input.lastHealthyAt ?? null),
    error: sanitizeError(input.health.error),
    remediation: remediationFor(input.runtime, state),
    version: input.health.version ?? null,
  };
}

/**
 * Parse a `host:port` from an http(s)/ws(s) endpoint or a bare `host:port`.
 * Returns null when the port cannot be determined. No credentials included.
 */
export function parseEndpointHostPort(endpoint: string): { host: string; port: number } | null {
  if (!endpoint) return null;
  const trimmed = endpoint.trim();
  try {
    if (/^[a-z]+:\/\//i.test(trimmed)) {
      const url = new URL(trimmed);
      const port = url.port
        ? Number(url.port)
        : url.protocol === "https:" || url.protocol === "wss:"
          ? 443
          : 80;
      return { host: url.hostname, port };
    }
    // bare host:port
    const idx = trimmed.lastIndexOf(":");
    if (idx === -1) return null;
    const host = trimmed.slice(0, idx);
    const port = Number(trimmed.slice(idx + 1));
    if (!host || !Number.isInteger(port) || port <= 0) return null;
    return { host, port };
  } catch {
    return null;
  }
}

function label(runtime: RuntimeId): string {
  return runtime === "opencode" ? "OpenCode" : "Hermes";
}
