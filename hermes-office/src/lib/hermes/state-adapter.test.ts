import { describe, expect, it } from "vitest";
import { mapEventToState } from "./state-adapter";
import type { AgentState } from "./types";

const initialState: AgentState = {
  status: "IDLE",
  tool: null,
  command: null,
  lastOutput: null,
  lastError: null,
  lastResponse: null,
  startedAt: null,
  turnSeq: 0,
  lastResponseStatus: null,
  gatewayConnected: true,
  workers: {},
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

  it("maps terminal tool.start to TERMINAL", () => {
    const state = mapEventToState(initialState, {
      type: "tool.start",
      payload: {
        name: "shell.exec",
        args: {
          command: "printf hello",
        },
      },
    });

    expect(state.status).toBe("TERMINAL");
    expect(state.tool).toBe("shell.exec");
    expect(state.command).toBe("printf hello");
  });

  it("maps non-terminal tool.start to USING_TOOL", () => {
    const state = mapEventToState(initialState, {
      type: "tool.start",
      payload: {
        name: "file.read",
        args: {
          command: "cat notes.md",
        },
      },
    });

    expect(state.status).toBe("USING_TOOL");
    expect(state.tool).toBe("file.read");
  });

  it("maps message.delta to WORKING", () => {
    const state = mapEventToState(initialState, {
      type: "message.delta",
    });

    expect(state.status).toBe("WORKING");

    const repeated = mapEventToState(state, {
      type: "message.delta",
    });

    expect(repeated).toBe(state);
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

  it("does not create a new state for repeated thinking deltas", () => {
    const thinking = mapEventToState(initialState, {
      type: "reasoning.delta",
    });

    expect(thinking.status).toBe("THINKING");

    const repeated = mapEventToState(thinking, {
      type: "reasoning.delta",
    });

    expect(repeated).toBe(thinking);

    const repeatedText = mapEventToState(thinking, {
      type: "thinking.delta",
    });

    expect(repeatedText).toBe(thinking);
  });

  it("clears tool and command when the message completes", () => {
    const busy = mapEventToState(initialState, {
      type: "tool.start",
      payload: {
        name: "shell.exec",
        args: { command: "printf hello" },
      },
    });

    expect(busy.tool).toBe("shell.exec");
    expect(busy.command).toBe("printf hello");
    expect(busy.startedAt).not.toBeNull();

    const done = mapEventToState(busy, {
      type: "message.complete",
      payload: { status: "complete" },
    });

    expect(done.status).toBe("IDLE");
    expect(done.tool).toBeNull();
    expect(done.command).toBeNull();
    expect(done.startedAt).toBeNull();
  });

  it("keeps tool details on a failed message.complete", () => {
    const state = mapEventToState(initialState, {
      type: "message.complete",
      payload: { status: "error", message: "model exploded" },
    });

    expect(state.status).toBe("ERROR");
    expect(state.lastError).toBe("model exploded");
  });

  it("captures tool output on tool.complete", () => {
    const state = mapEventToState(initialState, {
      type: "tool.complete",
      payload: {
        name: "shell.exec",
        result: { output: "HERMES OFFICE TEST", exit_code: 0 },
      },
    });

    expect(state.status).toBe("WORKING");
    expect(state.lastOutput).toBe("HERMES OFFICE TEST");
  });

  it("captures the message on error events", () => {
    const state = mapEventToState(initialState, {
      type: "error",
      payload: { message: "gateway unavailable" },
    });

    expect(state.status).toBe("ERROR");
    expect(state.lastError).toBe("gateway unavailable");
  });

  it("moves from OFFLINE to IDLE on gateway.ready", () => {
    const offline = { ...initialState, status: "OFFLINE" as const };

    expect(mapEventToState(offline, { type: "gateway.ready" }).status).toBe(
      "IDLE",
    );

    const busy = mapEventToState(offline, { type: "reasoning.delta" });

    expect(mapEventToState(busy, { type: "gateway.ready" })).toBe(busy);
  });

  it("increments turnSeq once per completed turn", () => {
    const first = mapEventToState(initialState, {
      type: "message.complete",
      payload: { status: "complete", text: "answer A" },
    });

    expect(first.turnSeq).toBe(1);
    expect(first.lastResponse).toBe("answer A");
    expect(first.lastResponseStatus).toBe("complete");

    const second = mapEventToState(first, {
      type: "message.complete",
      payload: { status: "complete", text: "answer B" },
    });

    expect(second.turnSeq).toBe(2);
    expect(second.lastResponse).toBe("answer B");
  });

  it("records the turn result status for complete/error/interrupted", () => {
    expect(
      mapEventToState(initialState, {
        type: "message.complete",
        payload: { status: "interrupted" },
      }).lastResponseStatus,
    ).toBe("interrupted");

    const failed = mapEventToState(initialState, {
      type: "message.complete",
      payload: { status: "error", message: "boom" },
    });

    expect(failed.status).toBe("ERROR");
    expect(failed.lastResponseStatus).toBe("error");
  });

  it("does not advance turnSeq for non-terminal events", () => {
    const thinking = mapEventToState(initialState, {
      type: "reasoning.delta",
    });

    expect(thinking.turnSeq).toBe(0);

    const working = mapEventToState(thinking, {
      type: "message.delta",
    });

    expect(working.turnSeq).toBe(0);
  });
});

describe("mapEventToState subagent routing", () => {
  it("creates and advances a worker without changing agent status", () => {
    const started = mapEventToState(initialState, {
      type: "subagent.start",
      payload: {
        subagent_id: "sa-0-abcd1234",
        goal: "research pricing",
        task_index: 0,
        task_count: 2,
        depth: 1,
        model: "sonnet",
      },
    });

    expect(started.status).toBe(initialState.status);
    expect(Object.keys(started.workers)).toHaveLength(1);

    const worker = started.workers["sa-0-abcd1234"];

    expect(worker.status).toBe("running");
    expect(worker.goal).toBe("research pricing");
    expect(worker.taskCount).toBe(2);
    expect(worker.startedAt).not.toBeNull();

    const completed = mapEventToState(started, {
      type: "subagent.complete",
      payload: {
        subagent_id: "sa-0-abcd1234",
        goal: "research pricing",
        task_index: 0,
        task_count: 2,
        status: "completed",
        summary: "3 competitors mapped",
        duration_seconds: 12.5,
      },
    });

    expect(completed.status).toBe(initialState.status);
    expect(completed.workers["sa-0-abcd1234"].status).toBe("completed");
    expect(completed.workers["sa-0-abcd1234"].summary).toBe(
      "3 competitors mapped",
    );
  });

  it("returns the same state for an unmatched subagent event", () => {
    const state = mapEventToState(initialState, {
      type: "subagent.progress",
      payload: {
        subagent_id: "sa-0-aaaa1111",
        goal: "g",
        task_index: 0,
        task_count: 1,
        text: "🔀 tool-a",
      },
    });

    const repeated = mapEventToState(state, {
      type: "subagent.text",
      payload: {
        subagent_id: "sa-0-aaaa1111",
        goal: "g",
        task_index: 0,
        task_count: 1,
        text: "ignored",
      },
    });

    expect(repeated).toBe(state);
  });
});