import { describe, expect, it } from "vitest";
import {
  describeUnifiedInterruptError,
  describeUnifiedInterruptResult,
  resolveUnifiedWorkerInterruptAvailability,
} from "./interrupt";
import type { RuntimeWorker } from "./types";

function mockWorker(overrides?: Partial<RuntimeWorker>): RuntimeWorker {
  return {
    id: "hermes:sub-1",
    runtime: "hermes",
    sourceId: "sub-1",
    role: "subagent",
    status: "running",
    updatedAt: Date.now(),
    toolsets: [],
    ...overrides,
  };
}

describe("resolveUnifiedWorkerInterruptAvailability", () => {
  it("disables when interrupting is in flight", () => {
    const res = resolveUnifiedWorkerInterruptAvailability({
      worker: mockWorker(),
      runtimeOnline: true,
      interrupting: true,
    });
    expect(res.enabled).toBe(false);
    expect(res.reason).toBeNull();
  });

  it("disables when worker is null", () => {
    const res = resolveUnifiedWorkerInterruptAvailability({
      worker: null,
      runtimeOnline: true,
      interrupting: false,
    });
    expect(res.enabled).toBe(false);
    expect(res.reason).toMatch(/no worker/i);
  });

  it("disables when worker is in a terminal state", () => {
    const res = resolveUnifiedWorkerInterruptAvailability({
      worker: mockWorker({ status: "completed" }),
      runtimeOnline: true,
      interrupting: false,
    });
    expect(res.enabled).toBe(false);
    expect(res.reason).toMatch(/already finished/i);
  });

  it("disables when worker is stale", () => {
    const res = resolveUnifiedWorkerInterruptAvailability({
      worker: mockWorker({ stale: true }),
      runtimeOnline: true,
      interrupting: false,
    });
    expect(res.enabled).toBe(false);
    expect(res.reason).toMatch(/stale/i);
  });

  it("disables when runtime is offline", () => {
    const res = resolveUnifiedWorkerInterruptAvailability({
      worker: mockWorker(),
      runtimeOnline: false,
      interrupting: false,
    });
    expect(res.enabled).toBe(false);
    expect(res.reason).toMatch(/offline/i);
  });

  it("enables for live Hermes subagent with session", () => {
    const res = resolveUnifiedWorkerInterruptAvailability({
      worker: mockWorker({ runtime: "hermes", role: "subagent" }),
      runtimeOnline: true,
      interrupting: false,
      hasSession: true,
    });
    expect(res.enabled).toBe(true);
    expect(res.reason).toBeNull();
  });

  it("disables for Hermes subagent when hasSession is false", () => {
    const res = resolveUnifiedWorkerInterruptAvailability({
      worker: mockWorker({ runtime: "hermes", role: "subagent" }),
      runtimeOnline: true,
      interrupting: false,
      hasSession: false,
    });
    expect(res.enabled).toBe(false);
    expect(res.reason).toMatch(/no live hermes session/i);
  });

  it("disables for Hermes session-level worker", () => {
    const res = resolveUnifiedWorkerInterruptAvailability({
      worker: mockWorker({ runtime: "hermes", kind: "session" }),
      runtimeOnline: true,
      interrupting: false,
      hasSession: true,
    });
    expect(res.enabled).toBe(false);
    expect(res.reason).toMatch(/hermes session interrupt is not supported/i);
  });

  it("enables for active OpenCode session when online", () => {
    const res = resolveUnifiedWorkerInterruptAvailability({
      worker: mockWorker({
        id: "opencode:sess-42",
        runtime: "opencode",
        sourceId: "sess-42",
        kind: "session",
        status: "running",
      }),
      runtimeOnline: true,
      interrupting: false,
    });
    expect(res.enabled).toBe(true);
    expect(res.reason).toBeNull();
  });
});

describe("describeUnifiedInterruptResult", () => {
  it("describes success for interrupted worker", () => {
    const msg = describeUnifiedInterruptResult({
      ok: true,
      runtime: "opencode",
      interrupted: true,
      sourceId: "sess-1",
    });
    expect(msg.tone).toBe("success");
    expect(msg.text).toContain("OpenCode (sess-1)");
  });

  it("describes stale for worker not found", () => {
    const msg = describeUnifiedInterruptResult({
      ok: true,
      runtime: "hermes",
      found: false,
      sourceId: "sub-9",
    });
    expect(msg.tone).toBe("stale");
    expect(msg.text).toMatch(/no longer running/i);
  });
});

describe("describeUnifiedInterruptError", () => {
  it("formats error with runtime label", () => {
    const msg = describeUnifiedInterruptError(new Error("connection timeout"), "opencode");
    expect(msg.tone).toBe("error");
    expect(msg.text).toBe("Interrupt failed: OpenCode: connection timeout");
  });
});
