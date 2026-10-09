import type { AgentState, TurnResultStatus } from "./types";
import { applyWorkerEvent } from "./workers";

function readTurnResultStatus(value: unknown): TurnResultStatus {
  if (value === "error") {
    return "error";
  }

  if (value === "interrupted") {
    return "interrupted";
  }

  return "complete";
}

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

function readMessageContent(payload: Record<string, unknown>) {
  const content = payload.content;

  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    const parts: string[] = [];

    for (const part of content) {
      if (part && typeof part === "object") {
        const type = (part as Record<string, unknown>).type;

        if (type === "thought" || type === "thinking") {
          continue;
        }

        const text =
          (part as Record<string, unknown>).text ??
          (part as Record<string, unknown>).content;

        if (typeof text === "string") {
          parts.push(text);
        }
      }
    }

    if (parts.length > 0) {
      return parts.join("\n\n");
    }
  }

  for (const key of ["text", "response", "result_text"] as const) {
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

const TERMINAL_TOOL_MARKERS = [
  "shell",
  "terminal",
  "bash",
  "powershell",
  "cmd",
  "exec",
];

function isTerminalTool(name: string | null) {
  if (!name) {
    return false;
  }

  const lower = name.toLowerCase();

  return TERMINAL_TOOL_MARKERS.some((marker) => lower.includes(marker));
}

export function mapEventToState(
  current: AgentState,
  event: HermesEvent,
): AgentState {
  const payload = event.payload ?? {};

  // Delegated subagents are application state, not tool chrome: route every
  // subagent.* frame through the worker adapter without touching agent status.
  if (event.type.startsWith("subagent.")) {
    const workers = applyWorkerEvent(current.workers, {
      type: event.type,
      payload,
    });

    return workers === current.workers
      ? current
      : { ...current, workers };
  }

  switch (event.type) {
    case "gateway.ready": {
      const recovered =
        current.status === "OFFLINE" || current.status === "ERROR"
          ? { ...current, status: "IDLE" as const, lastError: null }
          : current;

      return recovered.connectionError === null
        ? recovered
        : { ...recovered, connectionError: null };
    }

    case "message.start":
      return {
        ...current,
        status: "THINKING",
        lastOutput: null,
        lastError: null,
        lastResponse: null,
      };

    case "thinking.delta":
    case "reasoning.delta":
      return current.status === "THINKING"
        ? current
        : { ...current, status: "THINKING" };

    case "message.delta":
      return current.status === "WORKING"
        ? current
        : { ...current, status: "WORKING" };

    case "tool.generating":
      return {
        ...current,
        status: isTerminalTool(asString(payload.name))
          ? "TERMINAL"
          : "USING_TOOL",
        tool: asString(payload.name),
        command: asString(payload.command) ?? current.command,
      };

    case "tool.start":
      return {
        ...current,
        status: isTerminalTool(asString(payload.name))
          ? "TERMINAL"
          : "USING_TOOL",
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
        command: asString(payload.command) ?? current.command,
        lastOutput:
          readToolOutput(payload) ?? current.lastOutput,
        lastError:
          asString(
            (payload.result as Record<string, unknown> | undefined)
              ?.error,
          ) ?? current.lastError,
      };

    case "message.complete": {
      const resultStatus = readTurnResultStatus(payload.status);
      const failed = resultStatus === "error";
      const response = readMessageContent(payload);

      return {
        ...current,
        status: failed ? "ERROR" : "IDLE",
        tool: null,
        command: null,
        startedAt: null,
        lastError: failed
          ? readErrorMessage(payload) ?? current.lastError
          : null,
        lastResponse: response ?? current.lastResponse,
        turnSeq: current.turnSeq + 1,
        lastResponseStatus: resultStatus,
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
