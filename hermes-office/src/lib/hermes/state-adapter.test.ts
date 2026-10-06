import { describe, expect, it } from "vitest";
import { mapEventToState } from "./state-adapter";
import type { AgentState } from "./types";

const initialState: AgentState = {
  status: "IDLE",
  tool: null,
  command: null,
  lastOutput: null,
  lastError: null,
  startedAt: null,
};

describe("mapEventToState", () => {
  it("maps message.start to THINKING", () => {
    const state = mapEventToState(initialState, {
      type: "message.start",
    });

    expect(state.status).toBe("THINKING");
  });

  it("maps reasoning.delta to THINKING", () => {
    const state = mapEventToState(initialState, {
      type: "reasoning.delta",
    });

    expect(state.status).toBe("THINKING");
  });

  it("maps tool.start to USING_TOOL", () => {
    const state = mapEventToState(initialState, {
      type: "tool.start",
      payload: {
        name: "shell.exec",
        args: {
          command: "printf hello",
        },
      },
    });

    expect(state.status).toBe("USING_TOOL");
    expect(state.tool).toBe("shell.exec");
    expect(state.command).toBe("printf hello");
  });

  it("maps tool.complete to WORKING", () => {
    const state = mapEventToState(initialState, {
      type: "tool.complete",
      payload: {
        name: "shell.exec",
      },
    });

    expect(state.status).toBe("WORKING");
  });

  it("maps successful message.complete to IDLE", () => {
    const state = mapEventToState(initialState, {
      type: "message.complete",
      payload: {
        status: "complete",
      },
    });

    expect(state.status).toBe("IDLE");
  });

  it("maps error to ERROR", () => {
    const state = mapEventToState(initialState, {
      type: "error",
    });

    expect(state.status).toBe("ERROR");
  });

  it("preserves state for unknown events", () => {
    const state = mapEventToState(initialState, {
      type: "something.weird",
    });

    expect(state).toEqual(initialState);
  });
});