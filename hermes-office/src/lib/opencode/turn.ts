/**
 * Pure OpenCode turn lifecycle mapping (Phase M follow-up).
 *
 * OpenCode has no server-issued turn counter the way Hermes does, so the UI
 * must decide when a dispatched prompt is still running and when it actually
 * finished. This module encodes that decision from the real runtime signals:
 *
 *  - `POST /session/:id/prompt` returning an assistant payload proves the turn
 *    finished (some builds answer synchronously with the message).
 *  - Otherwise the turn stays pending until an OpenCode event marks it running
 *    and finally completed/failed.
 *
 * Nothing here invents assistant text: a completion with no extractable text
 * yields `null`, and the reducer shows its honest "no text response" fallback.
 */

export type OpenCodeTurnPhase = "running" | "completed" | "failed";

export interface OpenCodeTurnUpdate {
  phase: OpenCodeTurnPhase;
  /** Full text carried by the event, when present. */
  text: string | null;
  /** Streamed increment, when present (e.g. `session.text.delta`). */
  delta: string | null;
  /** Real error message, when the turn failed. */
  error: string | null;
}

const RUNNING_TYPES = new Set([
  "session.execution.started",
  "session.step.started",
  "session.step.streamed",
  "session.step.ended",
  "session.text.started",
  "session.text.delta",
  "session.tool.input.started",
  "session.tool.input.delta",
  "session.tool.input.ended",
  "session.tool.called",
  "session.tool.progress",
  "session.tool.success",
  "session.inbox.enqueued",
  "session.inbox.delivered",
]);

const COMPLETED_TYPES = new Set([
  "session.execution.succeeded",
  "session.text.ended",
  "session.idle",
]);

const FAILED_TYPES = new Set([
  "session.execution.failed",
  "session.step.failed",
  "session.tool.failed",
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function firstString(
  source: Record<string, unknown> | null,
  keys: string[],
): string | null {
  if (!source) return null;
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }
  return null;
}

const FULL_TEXT_KEYS = ["text", "content", "response", "output", "answer", "result"];
const DELTA_KEYS = ["delta", "textDelta", "text_delta"];
const ERROR_KEYS = ["error", "message", "reason"];

/**
 * Classify a raw OpenCode event into a turn update, or `null` when the event is
 * unrelated to turn progress (sessions, permissions, server chatter, …).
 */
export function classifyOpenCodeTurn(
  type: string,
  payload: unknown,
): OpenCodeTurnUpdate | null {
  const data = asRecord(payload);

  if (FAILED_TYPES.has(type)) {
    return {
      phase: "failed",
      text: firstString(data, FULL_TEXT_KEYS),
      delta: null,
      error: firstString(data, ERROR_KEYS) ?? "OpenCode turn failed.",
    };
  }

  if (COMPLETED_TYPES.has(type)) {
    return {
      phase: "completed",
      text: firstString(data, FULL_TEXT_KEYS),
      delta: null,
      error: null,
    };
  }

  if (RUNNING_TYPES.has(type)) {
    const delta =
      firstString(data, DELTA_KEYS) ??
      (type === "session.text.delta" ? firstString(data, ["text", "content"]) : null);

    return { phase: "running", text: null, delta, error: null };
  }

  return null;
}

export interface OpenCodePromptOutcome {
  text: string | null;
  error: string | null;
}

/**
 * Inspect the payload returned by `POST /session/:id/prompt`. Returns an
 * outcome only when the response *provably* carries an assistant reply or an
 * error; an acknowledgement (ids only) returns `null` so the caller keeps the
 * turn pending until the event stream confirms it.
 */
export function extractPromptOutcome(
  result: unknown,
): OpenCodePromptOutcome | null {
  const outer = asRecord(result);
  if (!outer) return null;

  // The route wraps the adapter result as `{ ok, result }`, and some builds
  // nest the message again under `data`. Gather every plausible record.
  const candidates: Array<Record<string, unknown>> = [outer];
  for (const key of ["data", "result", "message"]) {
    const nested = asRecord(outer[key]);
    if (!nested) continue;
    candidates.push(nested);
    const deep = asRecord(nested.data);
    if (deep) candidates.push(deep);
  }

  let error: string | null = null;
  let text: string | null = null;
  for (const candidate of candidates) {
    error = error ?? firstString(candidate, ["error"]);
    text = text ?? firstString(candidate, FULL_TEXT_KEYS);
  }

  if (error) return { text, error };
  if (text) return { text, error: null };
  return null;
}
