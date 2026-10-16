import { describe, expect, it } from "vitest";
import { formatRuntimeEventSummary, toFormattedOfficeEvent } from "./events";
import type { RuntimeEvent } from "./types";

describe("formatRuntimeEventSummary", () => {
  it("formats Hermes event with tool", () => {
    const ev: RuntimeEvent = {
      runtime: "hermes",
      type: "terminal.run",
      sourceId: "s1",
      payload: { tool: "bash", command: "npm test" },
      at: 1000,
    };
    const summary = formatRuntimeEventSummary(ev);
    expect(summary).toBe("[Hermes] terminal.run · bash");
  });

  it("formats OpenCode event with title", () => {
    const ev: RuntimeEvent = {
      runtime: "opencode",
      type: "session.created",
      sourceId: "oc-1",
      payload: { title: "Fix bug in parser" },
      at: 2000,
    };
    const summary = formatRuntimeEventSummary(ev);
    expect(summary).toBe('[OpenCode] session.created · "Fix bug in parser"');
  });

  it("formats event with status fallback", () => {
    const ev: RuntimeEvent = {
      runtime: "hermes",
      type: "subagent.complete",
      sourceId: "sa-1",
      payload: { status: "completed" },
      at: 3000,
    };
    const summary = formatRuntimeEventSummary(ev);
    expect(summary).toBe("[Hermes] subagent.complete (completed)");
  });
});

describe("toFormattedOfficeEvent", () => {
  it("structures event with defaults", () => {
    const ev: RuntimeEvent = {
      runtime: "opencode",
      type: "session.idle",
      sourceId: "oc-42",
      payload: {},
      at: 5000,
    };
    const formatted = toFormattedOfficeEvent(ev, 1);
    expect(formatted.runtime).toBe("opencode");
    expect(formatted.type).toBe("session.idle");
    expect(formatted.text).toBe("[OpenCode] session.idle");
    expect(formatted.at).toBe(5000);
  });
});
