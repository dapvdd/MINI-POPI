/**
 * OpenCode v2 event types (from live inspection). We keep a whitelist of types
 * we care about; unknown types are passed through but not mutated.
 */
export const OPCODE_EVENT_TYPES = new Set([
  "session.created",
  "session.updated",
  "session.deleted",
  "session.idle",
  "session.execution.started",
  "session.execution.succeeded",
  "session.execution.failed",
  "session.execution.interrupted",
  "session.text.started",
  "session.text.delta",
  "session.text.ended",
  "session.step.started",
  "session.step.streamed",
  "session.step.ended",
  "session.step.failed",
  "session.tool.input.started",
  "session.tool.input.delta",
  "session.tool.input.ended",
  "session.tool.called",
  "session.tool.progress",
  "session.tool.success",
  "session.tool.failed",
  "session.usage.updated",
  "session.inbox.enqueued",
  "session.inbox.delivered",
  "session.inbox.cancelled",
  "permission.asked",
  "permission.replied",
  "permission.rejected",
  "shell.created",
  "shell.exited",
  "server.connected",
  "model.updated",
  "provider.updated",
  "project.updated",
]);

export interface OpenCodeEventEnvelope {
  id?: string;
  type: string;
  data?: unknown;
}

export function parseOpenCodeEvent(line: string): OpenCodeEventEnvelope | null {
  // SSE: data: {...}
  if (!line.startsWith("data:")) return null;
  const json = line.slice(5).trim();
  if (!json) return null;
  try {
    return JSON.parse(json) as OpenCodeEventEnvelope;
  } catch {
    return null;
  }
}
