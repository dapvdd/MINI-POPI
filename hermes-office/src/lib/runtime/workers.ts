import type { WorkerStatus } from "../hermes/workers";
import type { CompositeId, RuntimeId, RuntimeWorker } from "./types";

/**
 * Unified runtime worker registry (Phase L).
 *
 * Pure, bounded, runtime-agnostic state for the living office. It merges
 * normalized `RuntimeWorker` records from any runtime and is responsible for:
 *   - collision-safe composite identity (dedupe by `${runtime}:${sourceId}`);
 *   - out-of-order protection (a stale frame never regresses a live worker);
 *   - terminal stability (a completed worker is never resurrected);
 *   - enrichment (late frames that fill in goal/activity don't erase it);
 *   - staleness (a worker with no recent evidence is flagged, not faked);
 *   - reconciliation after reconnect (absent workers become stale);
 *   - runtime isolation (resetting one runtime never touches the other);
 *   - bounded history (order + capacity cap).
 *
 * Nothing here invents workers: an absent or unknown source simply never
 * produces a record.
 */

export interface RuntimeWorkersState {
  byId: Record<string, RuntimeWorker>;
  order: CompositeId[];
}

export const RUNTIME_WORKER_TERMINAL_STATUSES: ReadonlySet<WorkerStatus> = new Set<
  WorkerStatus
>(["completed", "failed", "error", "timeout", "interrupted"]);

export function isTerminalRuntimeStatus(status: WorkerStatus): boolean {
  return RUNTIME_WORKER_TERMINAL_STATUSES.has(status);
}

/** Default bounding for the registry so long sessions cannot grow unbounded. */
export const WORKER_REGISTRY_CAPACITY = 200;
export const WORKER_TERMINAL_RETENTION_MS = 120_000;
/** No evidence for this long marks a non-terminal worker stale (not failed). */
export const WORKER_STALE_AFTER_MS = 45_000;

export function createWorkerRegistryState(): RuntimeWorkersState {
  return { byId: {}, order: [] };
}

function terminalAnchor(worker: RuntimeWorker): number {
  return worker.completedAt ?? worker.updatedAt ?? 0;
}

/**
 * Merge a single normalized worker. Dedupes by composite id, never resurrects a
 * terminal worker, ignores out-of-order frames, and enriches rather than erases
 * late-arriving detail.
 */
export function upsertRuntimeWorker(
  state: RuntimeWorkersState,
  worker: RuntimeWorker | null,
  options?: { now?: number; capacity?: number },
): RuntimeWorkersState {
  if (!worker) {
    return state;
  }

  const now = options?.now ?? Date.now();
  const capacity = options?.capacity ?? WORKER_REGISTRY_CAPACITY;
  const existing = state.byId[worker.id];

  if (existing) {
    // A finished worker is immutable: late/duplicate frames cannot revive it.
    if (isTerminalRuntimeStatus(existing.status)) {
      return state;
    }

    // Out-of-order protection: a frame older than what we already saw is stale.
    if (
      typeof existing.updatedAt === "number" &&
      typeof worker.updatedAt === "number" &&
      worker.updatedAt < existing.updatedAt
    ) {
      return state;
    }

    const enriched: RuntimeWorker = {
      ...existing,
      ...worker,
      // Preserve known detail when a later frame omits it.
      goal: worker.goal ?? existing.goal ?? null,
      activity: worker.activity ?? existing.activity ?? null,
      summary: worker.summary ?? existing.summary ?? null,
      name: worker.name ?? existing.name ?? null,
      model: worker.model ?? existing.model ?? null,
      sessionId: worker.sessionId ?? existing.sessionId ?? null,
      stale: false,
      lastSeenAt: now,
    };

    if (workersEqual(existing, enriched)) {
      // Still bump lastSeen so staleness stays accurate.
      return {
        byId: { ...state.byId, [worker.id]: { ...enriched } },
        order: state.order,
      };
    }

    return {
      byId: { ...state.byId, [worker.id]: enriched },
      order: state.order,
    };
  }

  const next: RuntimeWorker = {
    ...worker,
    stale: false,
    lastSeenAt: worker.lastSeenAt ?? now,
  };

  const order = [...state.order, worker.id];
  const byId = { ...state.byId, [worker.id]: next };

  return boundRegistry({ byId, order }, now, capacity, WORKER_TERMINAL_RETENTION_MS);
}

function workersEqual(a: RuntimeWorker, b: RuntimeWorker): boolean {
  return (
    a.status === b.status &&
    a.activity === b.activity &&
    a.updatedAt === b.updatedAt &&
    a.summary === b.summary &&
    a.goal === b.goal &&
    a.stale === b.stale &&
    a.completedAt === b.completedAt
  );
}

/**
 * Flag non-terminal workers with no recent evidence as stale. Status is never
 * rewritten — the office shows "stale", it does not fabricate failure.
 */
export function markStaleWorkers(
  state: RuntimeWorkersState,
  now: number,
  staleAfterMs: number = WORKER_STALE_AFTER_MS,
): RuntimeWorkersState {
  let changed = false;
  const byId: Record<string, RuntimeWorker> = {};

  for (const id of state.order) {
    const worker = state.byId[id];
    if (!worker) continue;

    const lastSeen = worker.lastSeenAt ?? worker.updatedAt ?? now;
    const shouldBeStale =
      !isTerminalRuntimeStatus(worker.status) &&
      // Staleness is sticky: once flagged (by time or by reconciliation) it
      // only clears when fresh evidence arrives via `upsertRuntimeWorker`.
      (worker.stale === true || now - lastSeen >= staleAfterMs);

    if (worker.stale !== shouldBeStale) {
      changed = true;
      byId[id] = { ...worker, stale: shouldBeStale };
    } else {
      byId[id] = worker;
    }
  }

  return changed ? { byId, order: state.order } : state;
}

/**
 * Reconcile a runtime against the authoritative live set after a reconnect.
 * Workers of that runtime no longer reported are marked stale (kept, not
 * deleted) so the UI can distinguish "gone" from "actively working".
 */
export function reconcileRuntimeWorkers(
  state: RuntimeWorkersState,
  runtime: RuntimeId,
  live: readonly RuntimeWorker[],
  options?: { now?: number; capacity?: number },
): RuntimeWorkersState {
  const now = options?.now ?? Date.now();
  let next = state;

  for (const worker of live) {
    if (worker.runtime !== runtime) continue;
    next = upsertRuntimeWorker(next, worker, { now, capacity: options?.capacity });
  }

  const liveIds = new Set(
    live.filter((w) => w.runtime === runtime).map((w) => w.id),
  );

  let changed = false;
  const byId: Record<string, RuntimeWorker> = {};

  for (const id of next.order) {
    const worker = next.byId[id];
    if (!worker) continue;

    if (
      worker.runtime === runtime &&
      !liveIds.has(id) &&
      !isTerminalRuntimeStatus(worker.status) &&
      !worker.stale
    ) {
      changed = true;
      byId[id] = { ...worker, stale: true };
    } else {
      byId[id] = worker;
    }
  }

  return changed ? { byId, order: next.order } : next;
}

/**
 * Drop every record owned by one runtime. Runtime isolation: a Hermes reset
 * must never disturb OpenCode state and vice versa.
 */
export function resetRuntimeWorkers(
  state: RuntimeWorkersState,
  runtime: RuntimeId,
): RuntimeWorkersState {
  const order = state.order.filter((id) => state.byId[id]?.runtime !== runtime);
  if (order.length === state.order.length) {
    return state;
  }
  const byId: Record<string, RuntimeWorker> = {};
  for (const id of order) {
    byId[id] = state.byId[id];
  }
  return { byId, order };
}

/**
 * Bound the registry: prune long-expired terminal workers, then cap total size
 * by evicting the oldest terminal entries first, then the oldest overall.
 */
export function boundRegistry(
  state: RuntimeWorkersState,
  now: number,
  capacity: number = WORKER_REGISTRY_CAPACITY,
  terminalTtlMs: number = WORKER_TERMINAL_RETENTION_MS,
): RuntimeWorkersState {
  const order = state.order.filter((id) => {
    const worker = state.byId[id];
    if (!worker) return false;
    if (isTerminalRuntimeStatus(worker.status)) {
      return now - terminalAnchor(worker) < terminalTtlMs;
    }
    return true;
  });

  let kept = order;
  if (kept.length > capacity) {
    const terminalFirst = [...kept].sort((a, b) => {
      const wa = state.byId[a];
      const wb = state.byId[b];
      const ta = wa && isTerminalRuntimeStatus(wa.status) ? 0 : 1;
      const tb = wb && isTerminalRuntimeStatus(wb.status) ? 0 : 1;
      if (ta !== tb) return ta - tb;
      return terminalAnchor(wa) - terminalAnchor(wb);
    });
    const drop = new Set(terminalFirst.slice(0, kept.length - capacity));
    kept = kept.filter((id) => !drop.has(id));
  }

  if (kept.length === state.order.length) {
    return state;
  }

  const byId: Record<string, RuntimeWorker> = {};
  for (const id of kept) {
    byId[id] = state.byId[id];
  }
  return { byId, order: kept };
}

/** Snapshot the registry as an ordered array (stable render order). */
export function registryWorkers(state: RuntimeWorkersState): RuntimeWorker[] {
  const result: RuntimeWorker[] = [];
  for (const id of state.order) {
    const worker = state.byId[id];
    if (worker) result.push(worker);
  }
  return result;
}

/**
 * Legacy single-worker reducer kept for compatibility. Delegates to the richer
 * upsert so behaviour stays consistent.
 */
export function applyRuntimeWorkerEvent(
  state: RuntimeWorkersState,
  worker: RuntimeWorker | null,
): RuntimeWorkersState {
  return upsertRuntimeWorker(state, worker);
}
