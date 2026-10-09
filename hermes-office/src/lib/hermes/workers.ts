/**
 * Worker (delegated subagent) state derived from the real Hermes Gateway
 * contracts.
 *
 * Ground truth inspected in the Hermes source:
 *   - emitter: tools/delegate_tool_progress.py::_ChildProgressRelay (relays to
 *     the parent session's tool_progress_callback)
 *   - gateway payload shaper: tui_gateway/tool_progress.py::_progress_subagent
 *   - typed contract: tui_gateway/contracts/events.py::SubagentEventPayload
 *     and tui_gateway/contracts/common.py::SubagentStatus
 *
 * Event names emitted on the parent session (``event_type.startswith("subagent.")``):
 *   subagent.spawn_requested, subagent.start, subagent.progress,
 *   subagent.thinking, subagent.tool, subagent.complete
 *
 * Required payload fields: goal, task_count, task_index.
 * Stable identity: subagent_id (``sa-{task_index}-{uuid8}``); delegation_id and
 * child_session_id are filled into a shared ref once the child exists, so they
 * enrich later events. There is NO worker query RPC — state is event-only.
 */

export type WorkerStatus =
  | "queued"
  | "running"
  | "thinking"
  | "using_tool"
  | "completed"
  | "failed"
  | "error"
  | "timeout"
  | "interrupted";

export interface WorkerOutputTailEntry {
  tool: string;
  preview: string;
  isError: boolean;
}

export interface WorkerTokens {
  input: number;
  output: number;
  reasoning: number;
}

export interface WorkerState {
  /** Stable identity: subagent_id when present, else a deterministic fallback. */
  id: string;
  goal: string;
  taskIndex: number;
  taskCount: number;
  status: WorkerStatus;
  parentId: string | null;
  childSessionId: string | null;
  delegationId: string | null;
  depth: number | null;
  model: string | null;
  /** Current human-readable activity (tool preview, thinking text, summary). */
  activity: string | null;
  toolCount: number | null;
  toolsets: string[];
  tokens: WorkerTokens | null;
  apiCalls: number | null;
  filesRead: string[];
  filesWritten: string[];
  outputTail: WorkerOutputTailEntry[];
  summary: string | null;
  durationSeconds: number | null;
  startedAt: number | null;
  updatedAt: number;
  completedAt: number | null;
}

export type WorkersState = Record<string, WorkerState>;

export interface WorkerEvent {
  type: string;
  payload?: Record<string, unknown>;
}

const WORKER_EVENT_TYPES = new Set([
  "subagent.spawn_requested",
  "subagent.start",
  "subagent.progress",
  "subagent.thinking",
  "subagent.tool",
  "subagent.complete",
]);

const TERMINAL_STATUSES: ReadonlySet<WorkerStatus> = new Set([
  "completed",
  "failed",
  "error",
  "timeout",
  "interrupted",
]);

export function isTerminalWorkerStatus(status: WorkerStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

export function isWorkerEventType(type: string): boolean {
  return WORKER_EVENT_TYPES.has(type);
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readInt(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.trunc(value)
    : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : null;
}

function readStringList(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  return value.filter(
    (entry): entry is string => typeof entry === "string",
  );
}

function readOutputTail(
  value: unknown,
): WorkerOutputTailEntry[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const rows: WorkerOutputTailEntry[] = [];

  for (const value_row of value) {
    if (!value_row || typeof value_row !== "object") {
      continue;
    }

    const row = value_row as Record<string, unknown>;

    rows.push({
      tool: readString(row.tool) ?? "",
      preview: readString(row.preview) ?? "",
      isError: row.is_error === true,
    });
  }

  return rows;
}

function readTokens(payload: Record<string, unknown>): WorkerTokens | null {
  const input = readInt(payload.input_tokens);
  const output = readInt(payload.output_tokens);
  const reasoning = readInt(payload.reasoning_tokens);

  if (input === null && output === null && reasoning === null) {
    return null;
  }

  return {
    input: input ?? 0,
    output: output ?? 0,
    reasoning: reasoning ?? 0,
  };
}

function readWorkerStatus(
  value: unknown,
  fallback: WorkerStatus,
): WorkerStatus {
  switch (value) {
    case "queued":
      return "queued";
    case "running":
      return "running";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "error":
      return "error";
    case "timeout":
      return "timeout";
    case "interrupted":
      return "interrupted";
    default:
      return fallback;
  }
}

/**
 * Stable identity for one delegated child. Prefers the emitter's subagent_id;
 * falls back deterministically so repeated events for the same legacy child
 * still collapse onto one record instead of spawning duplicates.
 */
export function resolveWorkerId(
  payload: Record<string, unknown>,
): string {
  const subagentId = readString(payload.subagent_id);

  if (subagentId) {
    return subagentId;
  }

  const taskIndex = readInt(payload.task_index) ?? 0;
  const delegationId = readString(payload.delegation_id);

  if (delegationId) {
    return `${delegationId}:${taskIndex}`;
  }

  const childSessionId = readString(payload.child_session_id);

  if (childSessionId) {
    return childSessionId;
  }

  const parentId = readString(payload.parent_id) ?? "root";
  const goal = readString(payload.goal) ?? "";

  return `anon:${parentId}:${taskIndex}:${goal.slice(0, 32)}`;
}

function createWorker(
  id: string,
  payload: Record<string, unknown>,
  now: number,
): WorkerState {
  return {
    id,
    goal: readString(payload.goal) ?? "",
    taskIndex: readInt(payload.task_index) ?? 0,
    taskCount: readInt(payload.task_count) ?? 1,
    status: "queued",
    parentId: null,
    childSessionId: null,
    delegationId: null,
    depth: null,
    model: null,
    activity: null,
    toolCount: null,
    toolsets: [],
    tokens: null,
    apiCalls: null,
    filesRead: [],
    filesWritten: [],
    outputTail: [],
    summary: null,
    durationSeconds: null,
    startedAt: null,
    updatedAt: now,
    completedAt: null,
  };
}

function mergeWorker(
  existing: WorkerState,
  payload: Record<string, unknown>,
  now: number,
): WorkerState {
  return {
    ...existing,
    goal: readString(payload.goal) ?? existing.goal,
    taskIndex: readInt(payload.task_index) ?? existing.taskIndex,
    taskCount: readInt(payload.task_count) ?? existing.taskCount,
    parentId: readString(payload.parent_id) ?? existing.parentId,
    childSessionId:
      readString(payload.child_session_id) ?? existing.childSessionId,
    delegationId:
      readString(payload.delegation_id) ?? existing.delegationId,
    depth: readInt(payload.depth) ?? existing.depth,
    model: readString(payload.model) ?? existing.model,
    toolCount: readInt(payload.tool_count) ?? existing.toolCount,
    toolsets: readStringList(payload.toolsets) ?? existing.toolsets,
    tokens: readTokens(payload) ?? existing.tokens,
    apiCalls: readInt(payload.api_calls) ?? existing.apiCalls,
    filesRead: readStringList(payload.files_read) ?? existing.filesRead,
    filesWritten:
      readStringList(payload.files_written) ?? existing.filesWritten,
    outputTail:
      readOutputTail(payload.output_tail) ?? existing.outputTail,
    updatedAt: now,
  };
}

/**
 * Fold one Hermes subagent event into the worker registry. Returns the same
 * object reference when nothing changed so React can skip re-renders and the
 * SSE bridge can preserve referential equality across unrelated frames.
 */
export function applyWorkerEvent(
  current: WorkersState,
  event: WorkerEvent,
  now: number = Date.now(),
): WorkersState {
  const { type } = event;

  if (!isWorkerEventType(type)) {
    return current;
  }

  const payload = event.payload ?? {};
  const id = resolveWorkerId(payload);
  const existing = current[id];

  // A finished worker is not resurrected by a late/duplicate lifecycle frame.
  if (
    existing &&
    isTerminalWorkerStatus(existing.status) &&
    type !== "subagent.complete"
  ) {
    return current;
  }

  const base = existing ?? createWorker(id, payload, now);
  const next = mergeWorker(base, payload, now);

  switch (type) {
    case "subagent.spawn_requested":
      next.status = "queued";
      next.activity = next.activity ?? (next.goal || null);
      break;

    case "subagent.start":
      next.status = "running";
      next.startedAt = base.startedAt ?? now;
      next.activity = readString(payload.text) ?? (next.goal || null);
      break;

    case "subagent.progress":
      next.status = base.status === "thinking" ? "thinking" : "running";
      next.activity = readString(payload.text) ?? base.activity;
      break;

    case "subagent.thinking":
      next.status = "thinking";
      next.activity = readString(payload.text) ?? base.activity;
      break;

    case "subagent.tool":
      next.status = "using_tool";
      next.activity =
        readString(payload.tool_preview) ??
        readString(payload.text) ??
        readString(payload.tool_name) ??
        base.activity;
      break;

    case "subagent.complete":
      next.status = readWorkerStatus(payload.status, "completed");
      next.summary =
        readString(payload.summary) ??
        readString(payload.text) ??
        base.summary;
      next.durationSeconds =
        readNumber(payload.duration_seconds) ?? base.durationSeconds;
      next.activity = next.summary ?? base.activity;
      next.startedAt = base.startedAt ?? now;
      next.completedAt = now;
      break;

    default:
      return current;
  }

  return { ...current, [id]: next };
}

/** Stable ordering for UI/3D consumers (oldest first). */
export function workersToArray(workers: WorkersState): WorkerState[] {
  return Object.values(workers).sort((a, b) => {
    const aStart = a.startedAt ?? a.updatedAt;
    const bStart = b.startedAt ?? b.updatedAt;

    if (aStart !== bStart) {
      return aStart - bStart;
    }

    return a.id.localeCompare(b.id);
  });
}
