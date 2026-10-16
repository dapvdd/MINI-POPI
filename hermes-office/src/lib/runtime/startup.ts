/**
 * Safe, bounded runtime startup orchestration (Phase K.3).
 *
 * The real side effects (spawning a process, probing health) are injected so
 * the orchestration is fully unit-testable without ever starting or killing a
 * real service.
 *
 * Verified local startup mechanisms (authoritative CLI evidence):
 * - OpenCode: `opencode service start` — manages the background service that
 *   MINPOP discovers via service.json.
 * - Hermes:   `hermes dashboard --no-open --skip-build` — starts the loopback
 *   (127.0.0.1:9119) dashboard that serves `/api/ws`. The pre-built UI already
 *   exists at `<install>/hermes_cli/web_dist`, so no npm build is triggered.
 *
 * Safety properties:
 * - A healthy instance is reused; a duplicate is never spawned.
 * - A per-runtime in-memory lock prevents concurrent start attempts.
 * - Wait for health is bounded; timeouts are reported truthfully.
 * - Success is only reported after the health probe actually confirms it.
 */
import type { RuntimeId } from "./types";
import { sanitizeError } from "./lifecycle";

export interface RuntimeStartupPlan {
  runtime: RuntimeId;
  supported: boolean;
  command: string | null;
  args: string[];
  /** Human-safe description of the verified mechanism. */
  mechanism: string;
  /** Reason startup is unavailable (sanitized), or null. */
  reason: string | null;
}

export const RUNTIME_STARTUP_PLANS: Record<RuntimeId, RuntimeStartupPlan> = {
  opencode: {
    runtime: "opencode",
    supported: true,
    command: "opencode",
    args: ["service", "start"],
    mechanism: "opencode service start",
    reason: null,
  },
  hermes: {
    runtime: "hermes",
    supported: true,
    command: "hermes",
    args: ["dashboard", "--no-open", "--skip-build"],
    mechanism: "hermes dashboard --no-open --skip-build (loopback 127.0.0.1:9119)",
    reason: null,
  },
};

export interface RuntimeHealthProbe {
  healthy: boolean;
  reachable: boolean;
  error?: string | null;
}

export interface StartupDeps {
  probeHealth: (runtime: RuntimeId) => Promise<RuntimeHealthProbe>;
  spawnProcess: (command: string, args: string[]) => void;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /**
   * Overall bounded wait for the runtime to become healthy. Default 60000ms —
   * large enough for a cold `hermes dashboard` start (observed ~24s) while
   * still bounded.
   */
  timeoutMs?: number;
  /** Poll interval while waiting. Default 1000ms. */
  pollIntervalMs?: number;
}

export type StartupOutcome =
  | "reused" // already healthy; nothing spawned
  | "healthy" // spawn + health confirmed
  | "starting" // another start already in progress
  | "failed" // did not become healthy within the bound
  | "unsupported"; // startup not implemented for this runtime

export interface StartupResult {
  runtime: RuntimeId;
  ok: boolean;
  outcome: StartupOutcome;
  alreadyRunning: boolean;
  started: boolean;
  mechanism: string;
  durationMs: number;
  error: string | null;
  remediation: string | null;
}

const startLocks = new Set<RuntimeId>();

/** Whether a start attempt is currently in flight for a runtime. */
export function isStarting(runtime: RuntimeId): boolean {
  return startLocks.has(runtime);
}

/** Test helper — clears in-flight start locks. */
export function resetStartupLocks(): void {
  startLocks.clear();
}

export async function runStartup(runtime: RuntimeId, deps: StartupDeps): Promise<StartupResult> {
  const plan = RUNTIME_STARTUP_PLANS[runtime];
  const now = deps.now ?? (() => Date.now());
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const timeoutMs = deps.timeoutMs ?? 60000;
  const pollIntervalMs = deps.pollIntervalMs ?? 1000;
  const startedAt = now();

  if (!plan || !plan.supported || !plan.command) {
    return {
      runtime,
      ok: false,
      outcome: "unsupported",
      alreadyRunning: false,
      started: false,
      mechanism: plan?.mechanism ?? "unsupported",
      durationMs: 0,
      error: plan?.reason ?? "Automatic startup is not available for this runtime.",
      remediation: null,
    };
  }

  // 1. Reuse a healthy instance — never spawn a duplicate.
  const before = await safeProbe(deps, runtime);
  if (before.healthy) {
    return {
      runtime,
      ok: true,
      outcome: "reused",
      alreadyRunning: true,
      started: false,
      mechanism: plan.mechanism,
      durationMs: now() - startedAt,
      error: null,
      remediation: null,
    };
  }

  // 2. Prevent concurrent duplicate starts.
  if (startLocks.has(runtime)) {
    return {
      runtime,
      ok: false,
      outcome: "starting",
      alreadyRunning: false,
      started: false,
      mechanism: plan.mechanism,
      durationMs: 0,
      error: "A start attempt is already in progress for this runtime.",
      remediation: "Wait for the current start attempt to finish, then refresh.",
    };
  }

  startLocks.add(runtime);
  try {
    deps.spawnProcess(plan.command, plan.args);

    // 3. Bounded wait for real health confirmation.
    const deadline = now() + timeoutMs;
    let last: RuntimeHealthProbe = before;
    while (now() < deadline) {
      await sleep(pollIntervalMs);
      last = await safeProbe(deps, runtime);
      if (last.healthy) {
        return {
          runtime,
          ok: true,
          outcome: "healthy",
          alreadyRunning: false,
          started: true,
          mechanism: plan.mechanism,
          durationMs: now() - startedAt,
          error: null,
          remediation: null,
        };
      }
    }

    const detail = sanitizeError(last.error);
    return {
      runtime,
      ok: false,
      outcome: "failed",
      alreadyRunning: false,
      started: true,
      mechanism: plan.mechanism,
      durationMs: now() - startedAt,
      error: `Startup did not become healthy within ${timeoutMs}ms${detail ? `: ${detail}` : "."}`,
      remediation: "Check the runtime logs, then refresh diagnostics.",
    };
  } finally {
    startLocks.delete(runtime);
  }
}

async function safeProbe(deps: StartupDeps, runtime: RuntimeId): Promise<RuntimeHealthProbe> {
  try {
    return await deps.probeHealth(runtime);
  } catch (e) {
    return { healthy: false, reachable: false, error: sanitizeError(e) };
  }
}
