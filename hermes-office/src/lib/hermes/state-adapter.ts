import type { AgentState } from "./types";

interface HermesEvent {
  type: string;
  payload?: Record<string, unknown>;
}

export function mapEventToState(
  current: AgentState,
  event: HermesEvent,
): AgentState {
  switch (event.type) {
    case "message.start":
      return {
        ...current,
        status: "THINKING",
        lastOutput: null,
        lastError: null,
      };

    case "thinking.delta":
    case "reasoning.delta":
      return {
        ...current,
        status: "THINKING",
      };

    case "tool.generating":
      return {
        ...current,
        status: "USING_TOOL",
        tool: (event.payload?.name as string) ?? null,
      };

    case "tool.start":
      return {
        ...current,
        status: "USING_TOOL",
        tool: (event.payload?.name as string) ?? null,
        command:
          (event.payload?.context as string) ??
          ((event.payload?.args as Record<string, unknown> | undefined)
            ?.command as string) ??
          null,
        startedAt: Date.now(),
      };

    case "tool.complete":
      return {
        ...current,
        status: "WORKING",
        tool: (event.payload?.name as string) ?? current.tool,
      };

    case "message.complete":
      return {
        ...current,
        status:
          event.payload?.status === "error"
            ? "ERROR"
            : "IDLE",
      };

    case "error":
      return {
        ...current,
        status: "ERROR",
      };

    default:
      return current;
  }
}