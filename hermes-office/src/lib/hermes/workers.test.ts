import { describe, expect, it } from "vitest";
import {
  applyWorkerEvent,
  isTerminalWorkerStatus,
  isWorkerEventType,
  resolveWorkerId,
  workersToArray,
  type WorkersState,
} from "./workers";

function apply(
  state: WorkersState,
  type: string,
  payload: Record<string, unknown>,
  now: number,
) {
  return applyWorkerEvent(state, { type, payload }, now);
}

const base = {
  subagent_id: "sa-0-abcd1234",
  goal: "research pricing",
  task_index: 0,
  task_count: 2,
};

describe("applyWorkerEvent", () => {
  it("creates a queued worker on spawn_requested", () => {
    const state = apply({}, "subagent.spawn_requested", base, 100);
    const worker = state["sa-0-abcd1234"];

    expect(Object.keys(state)).toHaveLength(1);
    expect(worker.status).toBe("queued");
    expect(worker.goal).toBe("research pricing");
    expect(worker.taskIndex).toBe(0);
    expect(worker.taskCount).toBe(2);
    expect(worker.startedAt).toBeNull();
    expect(worker.updatedAt).toBe(100);
  });

  it("moves to running on start and records startedAt", () => {
    const spawned = apply({}, "subagent.spawn_requested", base, 100);
    const started = apply(spawned, "subagent.start", base, 150);

    expect(started["sa-0-abcd1234"].status).toBe("running");
    expect(started["sa-0-abcd1234"].startedAt).toBe(150);
  });

  it("tracks thinking and tool activity", () => {
    let state = apply({}, "subagent.start", base, 100);
    state = apply(
      state,
      "subagent.thinking",
      { ...base, text: "weighing options" },
      110,
    );

    expect(state["sa-0-abcd1234"].status).toBe("thinking");
    expect(state["sa-0-abcd1234"].activity).toBe("weighing options");

    state = apply(
      state,
      "subagent.tool",
      {
        ...base,
        tool_name: "shell.exec",
        tool_preview: "rg --count price",
        tool_count: 3,
      },
      120,
    );

    expect(state["sa-0-abcd1234"].status).toBe("using_tool");
    expect(state["sa-0-abcd1234"].activity).toBe("rg --count price");
    expect(state["sa-0-abcd1234"].toolCount).toBe(3);
  });

  it("captures the observability rollup on complete", () => {
    let state = apply({}, "subagent.start", base, 100);
    state = apply(
      state,
      "subagent.complete",
      {
        ...base,
        status: "completed",
        summary: "3 competitors mapped",
        duration_seconds: 12.5,
        input_tokens: 1200,
        output_tokens: 340,
        reasoning_tokens: 90,
        api_calls: 4,
        tool_count: 6,
        files_read: ["a.md"],
        files_written: ["report.md"],
        output_tail: [
          { tool: "shell.exec", preview: "done", is_error: false },
        ],
      },
      200,
    );

    const worker = state["sa-0-abcd1234"];

    expect(worker.status).toBe("completed");
    expect(worker.summary).toBe("3 competitors mapped");
    expect(worker.durationSeconds).toBe(12.5);
    expect(worker.tokens).toEqual({
      input: 1200,
      output: 340,
      reasoning: 90,
    });
    expect(worker.apiCalls).toBe(4);
    expect(worker.toolCount).toBe(6);
    expect(worker.filesRead).toEqual(["a.md"]);
    expect(worker.filesWritten).toEqual(["report.md"]);
    expect(worker.outputTail).toEqual([
      { tool: "shell.exec", preview: "done", isError: false },
    ]);
    expect(worker.completedAt).toBe(200);
  });

  it("keeps multiple workers independent", () => {
    let state = apply({}, "subagent.start", base, 100);
    state = apply(
      state,
      "subagent.start",
      {
        ...base,
        subagent_id: "sa-1-ffff0000",
        task_index: 1,
        goal: "research reviews",
      },
      101,
    );
    state = apply(
      state,
      "subagent.complete",
      {
        ...base,
        subagent_id: "sa-1-ffff0000",
        task_index: 1,
        status: "completed",
        summary: "reviews done",
      },
      300,
    );

    expect(Object.keys(state)).toHaveLength(2);
    expect(state["sa-0-abcd1234"].status).toBe("running");
    expect(state["sa-1-ffff0000"].status).toBe("completed");
    expect(workersToArray(state).map((w) => w.id)).toEqual([
      "sa-0-abcd1234",
      "sa-1-ffff0000",
    ]);
  });

  it("does not duplicate a worker across repeated events", () => {
    let state = apply({}, "subagent.start", base, 100);
    state = apply(
      state,
      "subagent.progress",
      { ...base, text: "🔀 tool-a" },
      110,
    );
    state = apply(
      state,
      "subagent.progress",
      { ...base, text: "🔀 tool-a, tool-b" },
      120,
    );

    expect(Object.keys(state)).toHaveLength(1);
    expect(state["sa-0-abcd1234"].activity).toBe("🔀 tool-a, tool-b");
  });

  it("does not resurrect a terminal worker with a late tool event", () => {
    let state = apply({}, "subagent.start", base, 100);
    state = apply(
      state,
      "subagent.complete",
      { ...base, status: "completed", summary: "ok" },
      200,
    );

    const after = apply(
      state,
      "subagent.tool",
      { ...base, tool_name: "late" },
      300,
    );

    expect(after).toBe(state);
    expect(after["sa-0-abcd1234"].status).toBe("completed");
  });

  it("maps every terminal subagent status faithfully", () => {
    for (const status of [
      "completed",
      "failed",
      "error",
      "timeout",
      "interrupted",
    ]) {
      const state = apply(
        {},
        "subagent.complete",
        { ...base, status },
        200,
      );

      expect(state["sa-0-abcd1234"].status).toBe(status);
      expect(isTerminalWorkerStatus(state["sa-0-abcd1234"].status)).toBe(
        true,
      );
    }
  });

  it("ignores unrelated subagent event types", () => {
    const state = apply(
      {},
      "subagent.text",
      { ...base, text: "chatter" },
      100,
    );

    expect(state).toEqual({});
  });

  it("falls back to delegation_id + task_index without a subagent_id", () => {
    const noId = { ...base } as Record<string, unknown>;

    delete noId.subagent_id;

    const payload = {
      ...noId,
      delegation_id: "del-42",
      task_index: 2,
    };

    expect(resolveWorkerId(payload)).toBe("del-42:2");

    const state = apply({}, "subagent.start", payload, 100);
    expect(Object.keys(state)).toEqual(["del-42:2"]);
  });

  it("recognises only the real subagent lifecycle event names", () => {
    expect(isWorkerEventType("subagent.start")).toBe(true);
    expect(isWorkerEventType("subagent.complete")).toBe(true);
    expect(isWorkerEventType("subagent.text")).toBe(false);
    expect(isWorkerEventType("tool.start")).toBe(false);
  });
});
