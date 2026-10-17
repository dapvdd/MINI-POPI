import { describe, expect, it } from "vitest";
import { classifyOpenCodeTurn, extractPromptOutcome } from "./turn";

describe("classifyOpenCodeTurn", () => {
  it("treats execution start and stream deltas as running", () => {
    expect(classifyOpenCodeTurn("session.execution.started", { sessionID: "s1" })).toMatchObject({
      phase: "running",
      delta: null,
    });
    expect(
      classifyOpenCodeTurn("session.text.delta", { sessionID: "s1", delta: "Hel" }),
    ).toMatchObject({ phase: "running", delta: "Hel" });
  });

  it("treats a successful execution as completed and surfaces its text", () => {
    expect(
      classifyOpenCodeTurn("session.execution.succeeded", { sessionID: "s1", text: "done" }),
    ).toEqual({ phase: "completed", text: "done", delta: null, error: null });
  });

  it("treats a session going idle as completed", () => {
    expect(classifyOpenCodeTurn("session.idle", { sessionID: "s1" })).toMatchObject({
      phase: "completed",
      text: null,
    });
  });

  it("treats a failed execution as failed and surfaces the real error", () => {
    expect(
      classifyOpenCodeTurn("session.execution.failed", { sessionID: "s1", error: "boom" }),
    ).toEqual({ phase: "failed", text: null, delta: null, error: "boom" });
    expect(
      classifyOpenCodeTurn("session.tool.failed", { message: "tool exploded" }),
    ).toMatchObject({ phase: "failed", error: "tool exploded" });
  });

  it("ignores events unrelated to turn progress", () => {
    expect(classifyOpenCodeTurn("session.created", { sessionID: "s1" })).toBeNull();
    expect(classifyOpenCodeTurn("permission.asked", { sessionID: "s1" })).toBeNull();
  });
});

describe("extractPromptOutcome", () => {
  it("returns null for an acknowledgement so the turn stays pending", () => {
    expect(extractPromptOutcome({ ok: true, result: { id: "msg_1" } })).toBeNull();
    expect(extractPromptOutcome(null)).toBeNull();
  });

  it("extracts a nested assistant response", () => {
    expect(extractPromptOutcome({ ok: true, result: { data: { text: "hi there" } } })).toEqual({
      text: "hi there",
      error: null,
    });
  });

  it("extracts a real error", () => {
    expect(extractPromptOutcome({ ok: true, result: { error: "nope" } })).toEqual({
      text: null,
      error: "nope",
    });
  });
});
