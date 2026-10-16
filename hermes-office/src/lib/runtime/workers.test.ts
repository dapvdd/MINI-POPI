import { describe, expect, it } from "vitest";
import {
  applyRuntimeWorkerEvent,
  boundRegistry,
  createWorkerRegistryState,
  isTerminalRuntimeStatus,
  markStaleWorkers,
  reconcileRuntimeWorkers,
  registryWorkers,
  resetRuntimeWorkers,
  upsertRuntimeWorker,
} from "./workers";
import type { RuntimeWorker } from "./types";

function worker(
  id: string,
  overrides: Partial<RuntimeWorker> = {},
): RuntimeWorker {
  const [runtime, sourceId] = id.split(":") as ["hermes" | "opencode", string];
  return {
    id,
    runtime,
    sourceId,
    role: runtime === "hermes" ? "subagent" : "primary",
    status: "running",
    goal: null,
    activity: null,
    parentId: null,
    childSessionId: null,
    startedAt: null,
    updatedAt: 1000,
    completedAt: null,
    model: null,
    tokens: null,
    toolsets: [],
    summary: null,
    stale: false,
    lastSeenAt: 1000,
    ...overrides,
  };
}

describe("runtime worker registry", () => {
  it("starts empty", () => {
    expect(createWorkerRegistryState()).toEqual({ byId: {}, order: [] });
  });

  it("dedupes by composite id and keeps insertion order", () => {
    let state = createWorkerRegistryState();
    state = upsertRuntimeWorker(state, worker("hermes:a"));
    state = upsertRuntimeWorker(state, worker("hermes:b"));
    state = upsertRuntimeWorker(state, worker("hermes:a", { updatedAt: 2000 }));

    expect(state.order).toEqual(["hermes:a", "hermes:b"]);
    expect(registryWorkers(state)).toHaveLength(2);
  });

  it("ignores out-of-order frames and keeps the newer state", () => {
    let state = createWorkerRegistryState();
    state = upsertRuntimeWorker(
      state,
      worker("hermes:a", { updatedAt: 5000, activity: "newer" }),
      { now: 5000 },
    );
    state = upsertRuntimeWorker(
      state,
      worker("hermes:a", { updatedAt: 1000, activity: "older" }),
      { now: 5000 },
    );

    expect(state.byId["hermes:a"].activity).toBe("newer");
  });

  it("never resurrects a terminal worker with a late frame", () => {
    let state = createWorkerRegistryState();
    state = upsertRuntimeWorker(
      state,
      worker("hermes:a", { status: "completed", updatedAt: 2000, completedAt: 2000 }),
      { now: 2000 },
    );
    state = upsertRuntimeWorker(
      state,
      worker("hermes:a", { status: "running", updatedAt: 3000 }),
      { now: 3000 },
    );

    expect(state.byId["hermes:a"].status).toBe("completed");
  });

  it("enriches without erasing known detail", () => {
    let state = createWorkerRegistryState();
    state = upsertRuntimeWorker(
      state,
      worker("hermes:a", { goal: "research", updatedAt: 1000 }),
      { now: 1000 },
    );
    state = upsertRuntimeWorker(
      state,
      worker("hermes:a", { goal: null, activity: "searching", updatedAt: 2000 }),
      { now: 2000 },
    );

    expect(state.byId["hermes:a"].goal).toBe("research");
    expect(state.byId["hermes:a"].activity).toBe("searching");
  });

  it("marks workers stale after the stale window, never rewriting status", () => {
    let state = createWorkerRegistryState();
    state = upsertRuntimeWorker(state, worker("hermes:a"), { now: 1000 });

    const fresh = markStaleWorkers(state, 1000 + 10_000, 45_000);
    expect(fresh.byId["hermes:a"].stale).toBe(false);

    const stale = markStaleWorkers(state, 1000 + 50_000, 45_000);
    expect(stale.byId["hermes:a"].stale).toBe(true);
    expect(stale.byId["hermes:a"].status).toBe("running");
  });

  it("does not mark terminal workers stale", () => {
    let state = createWorkerRegistryState();
    state = upsertRuntimeWorker(
      state,
      worker("hermes:a", { status: "completed", completedAt: 1000 }),
      { now: 1000 },
    );

    const later = markStaleWorkers(state, 999_999, 45_000);
    expect(later.byId["hermes:a"].stale).toBe(false);
  });

  it("reconciles a runtime, marking absent workers stale but keeping them", () => {
    let state = createWorkerRegistryState();
    state = upsertRuntimeWorker(state, worker("hermes:a"), { now: 1000 });
    state = upsertRuntimeWorker(state, worker("hermes:b"), { now: 1000 });

    state = reconcileRuntimeWorkers(state, "hermes", [worker("hermes:a", { updatedAt: 1500 })], {
      now: 1500,
    });

    expect(state.byId["hermes:b"].stale).toBe(true);
    expect(state.byId["hermes:a"].stale).toBe(false);
    expect(state.order).toEqual(["hermes:a", "hermes:b"]);
  });

  it("keeps runtimes isolated when one is reset", () => {
    let state = createWorkerRegistryState();
    state = upsertRuntimeWorker(state, worker("hermes:a"));
    state = upsertRuntimeWorker(state, worker("opencode:s1"));

    state = resetRuntimeWorkers(state, "hermes");

    expect(state.order).toEqual(["opencode:s1"]);
    expect(state.byId["hermes:a"]).toBeUndefined();
    expect(state.byId["opencode:s1"]).toBeDefined();
  });

  it("bounds the registry by capacity, evicting terminal entries first", () => {
    let state = createWorkerRegistryState();
    for (let i = 0; i < 5; i += 1) {
      state = upsertRuntimeWorker(
        state,
        worker(`hermes:live-${i}`, { updatedAt: 1000 }),
        { now: 1000, capacity: 5 },
      );
    }
    // Make one terminal, then overflow.
    state = upsertRuntimeWorker(
      state,
      worker("hermes:done", {
        status: "completed",
        completedAt: 1000,
        updatedAt: 1000,
      }),
      { now: 1000, capacity: 5 },
    );
    state = upsertRuntimeWorker(state, worker("hermes:extra", { updatedAt: 1000 }), {
      now: 1000,
      capacity: 5,
    });

    expect(registryWorkers(state)).toHaveLength(5);
    expect(state.byId["hermes:done"]).toBeUndefined();
  });

  it("prunes terminal workers past their retention window", () => {
    let state = createWorkerRegistryState();
    state = upsertRuntimeWorker(
      state,
      worker("hermes:done", { status: "failed", completedAt: 1000 }),
      { now: 1000 },
    );

    const pruned = boundRegistry(state, 1000 + 10_000_000, 200, 120_000);
    expect(pruned.order).toEqual([]);
  });

  it("reports terminal statuses correctly", () => {
    expect(isTerminalRuntimeStatus("completed")).toBe(true);
    expect(isTerminalRuntimeStatus("running")).toBe(false);
  });

  it("legacy reducer delegates to upsert", () => {
    const state = applyRuntimeWorkerEvent(
      createWorkerRegistryState(),
      worker("hermes:a"),
    );
    expect(state.order).toEqual(["hermes:a"]);
  });
});
