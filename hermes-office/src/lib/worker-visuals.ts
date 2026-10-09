/**
 * Presentation mapping for Hermes workers. Kept separate from the state model
 * (`lib/hermes/workers.ts`), which stays a pure data contract, and from the
 * layout model (`office.ts`), which only knows where desks are.
 */

import {
  isTerminalWorkerStatus,
  type WorkerState,
  type WorkerStatus,
} from "./hermes/workers";

/**
 * Animation mode for one worker bot. Kept separate from `active` so the 3D
 * layer can distinguish real lifecycle phases (queued vs thinking vs using a
 * tool) and prove terminal workers never reuse a live-work animation.
 */
export type WorkerMotion =
  | "dormant"
  | "working"
  | "thinking"
  | "tool"
  | "settled"
  | "failed";

export interface WorkerStatusVisual {
  /** Hex color shared by the Activity list and the 3D worker representation. */
  color: string;
  /** True only while the worker is doing live work that should animate. */
  active: boolean;
  /** Coarse animation bucket for the 3D bot. */
  motion: WorkerMotion;
  /** Compact human label for the status. */
  label: string;
}

export const WORKER_STATUS_VISUALS: Record<
  WorkerStatus,
  WorkerStatusVisual
> = {
  queued: {
    color: "#71717a",
    active: false,
    motion: "dormant",
    label: "queued",
  },
  running: {
    color: "#38bdf8",
    active: true,
    motion: "working",
    label: "running",
  },
  thinking: {
    color: "#a78bfa",
    active: true,
    motion: "thinking",
    label: "thinking",
  },
  using_tool: {
    color: "#fb923c",
    active: true,
    motion: "tool",
    label: "using tool",
  },
  completed: {
    color: "#34d399",
    active: false,
    motion: "settled",
    label: "completed",
  },
  failed: {
    color: "#ef4444",
    active: false,
    motion: "failed",
    label: "failed",
  },
  error: {
    color: "#ef4444",
    active: false,
    motion: "failed",
    label: "error",
  },
  timeout: {
    color: "#fbbf24",
    active: false,
    motion: "failed",
    label: "timeout",
  },
  interrupted: {
    color: "#a1a1aa",
    active: false,
    motion: "settled",
    label: "interrupted",
  },
};

export function getWorkerStatusVisual(
  status: WorkerStatus,
): WorkerStatusVisual {
  return WORKER_STATUS_VISUALS[status] ?? WORKER_STATUS_VISUALS.queued;
}

/**
 * Terminal workers are retained on screen briefly so a completion/failure is
 * observable instead of blinking away, then removed from the 3D scene. The
 * underlying worker state is never mutated or pruned, so the Activity list
 * keeps the full lifecycle history.
 */
export const WORKER_TERMINAL_TTL_MS = 30_000;

export function isWorkerVisuallyExpired(
  worker: WorkerState,
  now: number,
  ttlMs: number = WORKER_TERMINAL_TTL_MS,
): boolean {
  if (!isTerminalWorkerStatus(worker.status)) {
    return false;
  }

  const anchor = worker.completedAt ?? worker.updatedAt;

  return now - anchor >= ttlMs;
}

/**
 * Workers that should still appear in the office. Non-terminal workers are
 * always shown; terminal workers fade out after the TTL. Order is preserved
 * from the caller (already stable via `workersToArray`).
 */
export function selectRenderableWorkers(
  workers: readonly WorkerState[],
  now: number,
  ttlMs: number = WORKER_TERMINAL_TTL_MS,
): WorkerState[] {
  return workers.filter(
    (worker) => !isWorkerVisuallyExpired(worker, now, ttlMs),
  );
}

const UNTITLED = "untitled task";

export function formatWorkerGoal(
  goal: string | null | undefined,
  maxLength = 42,
): string {
  const clean = (goal ?? "").trim();

  if (clean.length === 0) {
    return UNTITLED;
  }

  if (clean.length <= maxLength) {
    return clean;
  }

  return `${clean.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}
