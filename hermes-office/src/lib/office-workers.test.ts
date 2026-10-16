import { describe, expect, it } from "vitest";
import type { WorkerState } from "./hermes/workers";
import {
  mergeOfficeWorkers,
  officeWorkerKindLabel,
  officeWorkerTitle,
  runtimeAccent,
  selectOfficeRenderable,
  toRuntimeWorkersFromHermes,
} from "./office-workers";
import type { RuntimeWorker } from "./runtime/types";

function hermesWorker(id: string, overrides: Partial<WorkerState> = {}): WorkerState {
  return {
    id,
    goal: "task",
    taskIndex: 0,
    taskCount: 1,
    status: "running",
    parentId: null,
    childSessionId: null,
    delegationId: null,
    depth: null,
    model: null,
    activity: null,
    toolCount: null,
    toolsets: [],
    tokens: null,
    apiCalls: null,
    filesRead: [],
    filesWritten: [],
    outputTail: [],
    summary: null,
    durationSeconds: null,
    startedAt: null,
    updatedAt: 1000,
    completedAt: null,
    ...overrides,
  };
}

function sessionWorker(
  sourceId: string,
  overrides: Partial<RuntimeWorker> = {},
): RuntimeWorker {
  return {
    id: `opencode:${sourceId}`,
    runtime: "opencode",
    sourceId,
    role: "primary",
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
    sessionId: `opencode:${sourceId}`,
    name: null,
    kind: "session",
    stale: false,
    lastSeenAt: 1000,
    ...overrides,
  };
}

describe("office worker model", () => {
  it("maps Hermes workers to composite ids without losing identity", () => {
    const mapped = toRuntimeWorkersFromHermes(
      [hermesWorker("sa-0-abcd1234", { goal: "research" })],
      5000,
    );

    expect(mapped).toHaveLength(1);
    expect(mapped[0].id).toBe("hermes:sa-0-abcd1234");
    expect(mapped[0].runtime).toBe("hermes");
    expect(mapped[0].goal).toBe("research");
    expect(mapped[0].kind).toBe("worker");
  });

  it("merges Hermes and OpenCode without crossing runtimes", () => {
    const merged = mergeOfficeWorkers({
      previous: [],
      hermesWorkers: [hermesWorker("sa-0")],
      runtimeWorkers: [sessionWorker("s1")],
      now: 5000,
    });

    const ids = merged.map((w) => w.id).sort();
    expect(ids).toEqual(["hermes:sa-0", "opencode:s1"]);
  });

  it("dedupes replayed frames and never regresses a live worker", () => {
    const first = mergeOfficeWorkers({
      previous: [],
      hermesWorkers: [hermesWorker("sa-0", { updatedAt: 5000, activity: "new" })],
      now: 5000,
    });

    const second = mergeOfficeWorkers({
      previous: first,
      hermesWorkers: [hermesWorker("sa-0", { updatedAt: 1000, activity: "old" })],
      now: 5000,
    });

    expect(second).toHaveLength(1);
    expect(second[0].activity).toBe("new");
  });

  it("marks workers of a reconciled runtime stale but keeps the other runtime live", () => {
    const base = mergeOfficeWorkers({
      previous: [],
      hermesWorkers: [hermesWorker("sa-0")],
      runtimeWorkers: [sessionWorker("s1")],
      now: 1000,
    });

    // OpenCode goes offline: reconcile with an empty live set.
    const offline = mergeOfficeWorkers({
      previous: base,
      reconcile: ["opencode"],
      now: 2000,
    });

    const byId = Object.fromEntries(offline.map((w) => [w.id, w]));
    expect(byId["opencode:s1"].stale).toBe(true);
    expect(byId["hermes:sa-0"].stale).toBe(false);
  });

  it("drops expired terminal workers from the render set but keeps live ones", () => {
    const workers: RuntimeWorker[] = [
      sessionWorker("done", {
        status: "completed",
        completedAt: 1000,
        updatedAt: 1000,
      }),
      sessionWorker("live"),
    ];

    const soon = selectOfficeRenderable(workers, 2000);
    expect(soon.map((w) => w.id)).toContain("opencode:done");

    const later = selectOfficeRenderable(workers, 1000 + 60_000);
    expect(later.map((w) => w.id)).toEqual(["opencode:live"]);
  });

  it("resolves a human title with honest fallbacks", () => {
    expect(officeWorkerTitle(sessionWorker("s1", { goal: "Fix bug" }))).toBe("Fix bug");
    expect(officeWorkerTitle(sessionWorker("s1", { name: "Refactor" }))).toBe("Refactor");
    expect(officeWorkerTitle(sessionWorker("abcdef123456"))).toBe("session abcdef12");
  });

  it("labels worker kind honestly per runtime", () => {
    expect(officeWorkerKindLabel(sessionWorker("s1"))).toBe("session");
    expect(
      officeWorkerKindLabel({
        ...sessionWorker("s1"),
        runtime: "hermes",
        role: "subagent",
        kind: "worker",
      }),
    ).toBe("subagent");
  });

  it("exposes distinct runtime accents", () => {
    expect(runtimeAccent("hermes")).not.toBe(runtimeAccent("opencode"));
  });
});
