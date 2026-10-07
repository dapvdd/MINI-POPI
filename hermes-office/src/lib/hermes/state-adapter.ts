import type { AgentState } from "./types";

interface HermesEvent {
  type: string;
  payload?: Record<string, unknown>;
}

function asString(value: unknown) {
  return typeof value === "string" && value.length > 0
    ? value
    : null;
}

function readToolOutput(payload: Record<string, unknown>) {
  const result = payload.result;

  if (result && typeof result === "object") {
    const output = (result as Record<string, unknown>).output;

    if (typeof output === "string") {
      return output;
    }
  }

  for (const key of ["result_text", "output"] as const) {
    const value = payload[key];

    if (typeof value === "string") {
      return value;
    }
  }

  return null;
}

function readErrorMessage(payload: Record<string, unknown>) {
  for (const key of ["message", "error", "detail"] as const) {
    const value = payload[key];

    if (typeof value === "string") {
      return value;
    }
  }

  return null;
}

export function mapEventToState(
  current: AgentState,
  event: HermesEvent,
): AgentState {
  const payload = event.payload ?? {};

  switch (event.type) {
    case "gateway.ready":
      return current.status === "OFFLINE" ||
        current.status === "ERROR"
        ? { ...current, status: "IDLE", lastError: null }
        : current;

    case "message.start":
      return {
        ...current,
        status: "THINKING",
        lastOutput: null,
        lastError: null,
      };

    case "thinking.delta":
    case "reasoning.delta":
      return current.status === "THINKING"
        ? current
        : { ...current, status: "THINKING" };

    case "tool.generating":
      return {
        ...current,
        status: "USING_TOOL",
        tool: asString(payload.name),
      };

    case "tool.start":
      return {
        ...current,
        status: "USING_TOOL",
        tool: asString(payload.name),
        command:
          asString(payload.context) ??
          asString(
            (payload.args as Record<string, unknown> | undefined)
              ?.command,
          ),
        startedAt: Date.now(),
      };

    case "tool.complete":
      return {
        ...current,
        status: "WORKING",
        tool: asString(payload.name) ?? current.tool,
        lastOutput:
          readToolOutput(payload) ?? current.lastOutput,
        lastError:
          asString(
            (payload.result as Record<string, unknown> | undefined)
              ?.error,
          ) ?? current.lastError,
      };

    case "message.complete": {
      const failed = payload.status === "error";

      return {
        ...current,
        status: failed ? "ERROR" : "IDLE",
        tool: null,
        command: null,
        startedAt: null,
        lastError: failed
          ? readErrorMessage(payload) ?? current.lastError
          : null,
      };
    }

    case "error":
      return {
        ...current,
        status: "ERROR",
        lastError:
          readErrorMessage(payload) ?? current.lastError,
      };

    default:
      return current;
  }
}
