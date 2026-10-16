import type { WorkerState as HermesWorkerState } from "../hermes/workers";
import {
  toCompositeId,
  type CompositeId,
  type RuntimeId,
  type RuntimeWorker,
} from "./types";

/**
 * Normalize Hermes worker state into RuntimeWorker. Role is subagent by definition
 * for delegated workers; primary would be the top-level session if represented.
 */
export function normalizeHermesWorker(
  worker: HermesWorkerState,
  options?: { parentSessionCompositeId?: CompositeId | null; now?: number },
): RuntimeWorker {
  const id = toCompositeId("hermes", worker.id);
  const parentId = worker.parentId ? toCompositeId("hermes", worker.parentId) : null;
  const childSessionId = worker.childSessionId
    ? toCompositeId("hermes", worker.childSessionId)
    : null;
  const now = options?.now ?? Date.now();

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
    sessionId: options?.parentSessionCompositeId ?? null,
    name: null,
    kind: "worker",
    stale: false,
    lastSeenAt: now,
    taskIndex: worker.taskIndex ?? null,
    taskCount: worker.taskCount ?? null,
  };
}

/**
 * Normalize a runtime session into a session-level worker. This is used only
 * where a runtime exposes sessions but not subagent events (OpenCode), so the
 * office can honestly show a session-backed worker rather than fabricating a
 * delegated hierarchy.
 */
export function normalizeSessionWorker(input: {
  runtime: RuntimeId;
  sourceId: string;
  title?: string | null;
  status?: RuntimeWorker["status"];
  updatedAt?: number | null;
  now?: number;
}): RuntimeWorker {
  const id = toCompositeId(input.runtime, input.sourceId);
  const now = input.now ?? Date.now();
  return {
    id,
    runtime: input.runtime,
    sourceId: input.sourceId,
    role: "primary",
    status: input.status ?? "running",
    goal: input.title || null,
    activity: null,
    parentId: null,
    childSessionId: null,
    startedAt: null,
    updatedAt: input.updatedAt ?? now,
    completedAt: null,
    model: null,
    tokens: null,
    toolsets: [],
    summary: null,
    sessionId: id,
    name: input.title || null,
    kind: "session",
    stale: false,
    lastSeenAt: now,
  };
}
