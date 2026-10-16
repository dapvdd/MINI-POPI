import type { WorkerState as HermesWorkerState } from "../hermes/workers";
import { toCompositeId, type CompositeId, type RuntimeWorker } from "./types";

/**
 * Normalize Hermes worker state into RuntimeWorker. Role is subagent by definition
 * for delegated workers; primary would be the top-level session if represented.
 */
export function normalizeHermesWorker(
  worker: HermesWorkerState,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  options?: { parentSessionCompositeId?: CompositeId | null },
): RuntimeWorker {
  const id = toCompositeId("hermes", worker.id);
  const parentId = worker.parentId ? toCompositeId("hermes", worker.parentId) : null;
  const childSessionId = worker.childSessionId
    ? toCompositeId("hermes", worker.childSessionId)
    : null;

  return {
    id,
    runtime: "hermes",
    sourceId: worker.id,
    role: "subagent",
    status: worker.status,
    goal: worker.goal || null,
    activity: worker.activity || null,
    parentId,
    childSessionId,
    startedAt: worker.startedAt ?? null,
    updatedAt: worker.updatedAt,
    completedAt: worker.completedAt ?? null,
    model: worker.model || null,
    tokens: worker.tokens || null,
    toolsets: worker.toolsets.slice(),
    summary: worker.summary || null,
  };
}
