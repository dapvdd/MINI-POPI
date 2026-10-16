/**
 * Unified runtime types for coexisting Hermes and OpenCode runtimes.
 *
 * Design constraints from the requirements:
 * - Composite ID format: `${runtime}:${sourceId}` (split on first `:`)
 * - Worker model normalized across runtimes; reuse structural compatibility with
 *   Hermes `WorkerState` (Phase J tests assert WORKER_STATUS_VISUALS has exactly
 *   9 keys). We cannot add new top-level status keys without updating that test.
 * - Do not invent secrets; all discovery/auth uses files/env per-runtime.
 */
import type { WorkerState as HermesWorkerState } from "../hermes/workers";

export type RuntimeId = "hermes" | "opencode";

export type CompositeId = string; // `${runtime}:${sourceId}`

export function toCompositeId(runtime: RuntimeId, sourceId: string): CompositeId {
  return `${runtime}:${sourceId}`;
}

export function splitCompositeId(id: CompositeId): { runtime: RuntimeId | null; sourceId: string } {
  const idx = id.indexOf(":");
  if (idx === -1) {
    return { runtime: null, sourceId: id };
  }
  const rt = id.slice(0, idx);
  const sid = id.slice(idx + 1);
  if (rt !== "hermes" && rt !== "opencode") {
    return { runtime: null, sourceId: id };
  }
  return { runtime: rt, sourceId: sid };
}

/**
 * Health state for a runtime.
 */
export interface RuntimeHealth {
  runtime: RuntimeId;
  connected: boolean;
  reachable: boolean;
  error?: string | null;
  lastCheck?: number;
  version?: string | null;
}

/**
 * Declared capabilities of a runtime (only claim what is verified).
 */
export interface RuntimeCapabilities {
  canListSessions: boolean;
  canCreateSession: boolean;
  canSendPrompt: boolean;
  canInterrupt: boolean;
  canSubscribeEvents: boolean;
  canManagePermissions: boolean;
  supportsWorkers: boolean;
}

/**
 * Normalized session shape consumed by control center.
 */
export interface RuntimeSession {
  id: CompositeId;
  runtime: RuntimeId;
  sourceId: string;
  title?: string | null;
  directory?: string | null;
  createdAt?: number | null;
  updatedAt?: number | null;
  status?: string | null;
  project?: string | null;
  parentId?: CompositeId | null;
}

/**
 * Normalized worker (activity) shape. Structural subset compatible with
 * Hermes `WorkerState` so existing visuals/selectors can be reused.
 */
export interface RuntimeWorker {
  id: CompositeId;
  runtime: RuntimeId;
  sourceId: string;
  role: "primary" | "subagent";
  status: HermesWorkerState["status"]; // reuses Hermes union (9 keys)
  goal?: string | null;
  activity?: string | null;
  parentId?: CompositeId | null;
  childSessionId?: CompositeId | null;
  startedAt?: number | null;
  updatedAt: number;
  completedAt?: number | null;
  model?: string | null;
  tokens?: HermesWorkerState["tokens"] | null;
  toolsets?: string[];
  summary?: string | null;
}

/**
 * Normalized event for cross-runtime stream.
 */
export interface RuntimeEvent {
  id?: string;
  runtime: RuntimeId;
  type: string; // runtime-specific type mapped conceptually
  sourceId: string;
  sessionId?: CompositeId;
  workerId?: CompositeId;
  payload: Record<string, unknown>;
  at: number;
}

/**
 * Unified activity entry (history/timeline).
 */
export interface ActivityEntry {
  id: string;
  runtime: RuntimeId;
  sessionId?: CompositeId;
  message?: string | null;
  kind: "prompt" | "response" | "tool" | "system" | "worker";
  at: number;
  metadata?: Record<string, unknown>;
}
