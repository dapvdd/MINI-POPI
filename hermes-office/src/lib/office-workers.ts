/**
 * Office worker model (Phase L).
 *
 * Bridges the two runtime sources into a single, honest list of "living
 * workers" for the 3D office and the detail panel:
 *   - Hermes delegated subagents (real `WorkerState` from the Gateway SSE);
 *   - OpenCode active sessions (session-level, since OpenCode exposes no
 *     subagent events) — labelled as sessions, never faked as subagents.
 *
 * The merge is runtime-isolated and reuses the bounded registry reducer so
 * duplicate/out-of-order frames, terminal stability and staleness all behave
 * consistently with the server-side registry.
 */
import type { WorkerState } from "./hermes/workers";
import { normalizeHermesWorker } from "./runtime/normalize";
import type { RuntimeId, RuntimeWorker } from "./runtime/types";
import {
  createWorkerRegistryState,
  markStaleWorkers,
  reconcileRuntimeWorkers,
  registryWorkers,
  upsertRuntimeWorker,
  WORKER_STALE_AFTER_MS,
} from "./runtime/workers";
import { selectRenderableWorkers } from "./worker-visuals";

/** Per-runtime accent used by both the 3D badge and the list swatch. */
export const RUNTIME_ACCENT: Record<RuntimeId, string> = {
  hermes: "#22d3ee",
  opencode: "#a78bfa",
};

export const RUNTIME_LABEL: Record<RuntimeId, string> = {
  hermes: "Hermes",
  opencode: "OpenCode",
};

export function runtimeLabel(runtime: RuntimeId): string {
  return RUNTIME_LABEL[runtime] ?? runtime;
}

export function runtimeAccent(runtime: RuntimeId): string {
  return RUNTIME_ACCENT[runtime] ?? "#71717a";
}

/** Convert Hermes SSE worker state into unified workers. */
export function toRuntimeWorkersFromHermes(
  workers: readonly WorkerState[],
  now: number = Date.now(),
): RuntimeWorker[] {
  return workers.map((worker) => normalizeHermesWorker(worker, { now }));
}

export interface MergeOfficeWorkersInput {
  previous: readonly RuntimeWorker[];
  /** Fresh Hermes subagent snapshot (from SSE); omit to leave untouched. */
  hermesWorkers?: readonly WorkerState[];
  /** Fresh runtime workers (OpenCode sessions, reconciled). */
  runtimeWorkers?: readonly RuntimeWorker[];
  /** Runtimes whose live snapshot is authoritative this tick. Absent workers
   *  in these runtimes are marked stale (kept, never fabricated). */
  reconcile?: readonly RuntimeId[];
  now: number;
  staleAfterMs?: number;
}

/**
 * Deterministically merge every source into one bounded, ordered worker list.
 * Pure: the caller owns the previous snapshot and receives a new one.
 */
export function mergeOfficeWorkers(input: MergeOfficeWorkersInput): RuntimeWorker[] {
  const { previous, hermesWorkers, runtimeWorkers, reconcile, now } = input;
  const staleAfterMs = input.staleAfterMs ?? WORKER_STALE_AFTER_MS;

  let state = createWorkerRegistryState();
  // Seed from the previous snapshot WITHOUT re-upserting, so lastSeenAt and any
  // staleness flags are preserved across ticks (time/absence staleness must be
  // able to accumulate).
  {
    const byId: Record<string, RuntimeWorker> = {};
    const order: string[] = [];
    for (const worker of previous) {
      if (!byId[worker.id]) order.push(worker.id);
      byId[worker.id] = worker;
    }
    state = { byId, order };
  }

  const incoming: RuntimeWorker[] = [];
  if (hermesWorkers) {
    incoming.push(...toRuntimeWorkersFromHermes(hermesWorkers, now));
  }
  if (runtimeWorkers) {
    incoming.push(...runtimeWorkers);
  }

  for (const runtime of reconcile ?? []) {
    const live = incoming.filter((worker) => worker.runtime === runtime);
    state = reconcileRuntimeWorkers(state, runtime, live, { now });
  }

  // Upsert anything not already handled by reconcile (e.g. Hermes, which is
  // reconciled through its own live snapshot below when requested).
  const reconciledIds = new Set(
    (reconcile ?? []).flatMap((runtime) =>
      incoming.filter((w) => w.runtime === runtime).map((w) => w.id),
    ),
  );
  for (const worker of incoming) {
    if (reconciledIds.has(worker.id)) continue;
    state = upsertRuntimeWorker(state, worker, { now });
  }

  state = markStaleWorkers(state, now, staleAfterMs);

  return registryWorkers(state);
}

/**
 * Workers that should be represented in the office right now: terminal workers
 * are retained briefly, then drop out. Stale workers are kept (dimmed) so the
 * office never silently loses a worker that merely stopped reporting.
 */
export function selectOfficeRenderable(
  workers: readonly RuntimeWorker[],
  now: number,
): RuntimeWorker[] {
  return selectRenderableWorkers(workers, now);
}

const UNTITLED = "untitled task";

/** Human title for a worker: goal, then name, then a short session id. */
export function officeWorkerTitle(worker: RuntimeWorker): string {
  const goal = (worker.goal ?? "").trim();
  if (goal) return goal;

  const name = (worker.name ?? "").trim();
  if (name) return name;

  if (worker.kind === "session") {
    return `session ${worker.sourceId.slice(0, 8)}`;
  }

  return UNTITLED;
}

/** Which visual family a worker belongs to, for labelling honesty. */
export function officeWorkerKindLabel(worker: RuntimeWorker): string {
  if (worker.kind === "session") return "session";
  if (worker.role === "subagent") return "subagent";
  return "agent";
}

/**
 * Whether a worker can be selected/focused in the office. Every registered
 * worker can — this exists so callers don't re-derive the rule.
 */
export function isOfficeWorkerSelectable(worker: RuntimeWorker): boolean {
  return Boolean(worker.id);
}
