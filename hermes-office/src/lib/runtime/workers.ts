import type { RuntimeWorker, CompositeId } from "./types";

export interface RuntimeWorkersState {
  byId: Record<string, RuntimeWorker>;
  order: CompositeId[];
}

/**
 * Reducer that merges normalized workers. Dedupe by composite id; drop
 * no-ops; treat terminal as stable (do not resurrect).
 */
export function applyRuntimeWorkerEvent(
  state: RuntimeWorkersState,
  worker: RuntimeWorker | null,
): RuntimeWorkersState {
  if (!worker) {
    return state;
  }
  const existing = state.byId[worker.id];
  if (existing) {
    // Terminal workers should remain as-is (don't overwrite late events)
    if (existing.status === "completed" || existing.status === "failed" || existing.status === "error" || existing.status === "timeout" || existing.status === "interrupted") {
      return state;
    }
    // Shallow compare on key fields to avoid unnecessary updates
    if (
      existing.status === worker.status &&
      existing.activity === worker.activity &&
      existing.updatedAt === worker.updatedAt &&
      existing.summary === worker.summary
    ) {
      return state;
    }
  }
  const nextById = { ...state.byId, [worker.id]: worker };
  const nextOrder = existing ? state.order : [...state.order, worker.id];
  return { byId: nextById, order: nextOrder };
}
