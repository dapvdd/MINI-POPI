import { describe, expect, it } from "vitest";
import {
  applyWorkerEvent,
  workersToArray,
  type WorkerState,
  type WorkerStatus,
} from "./hermes/workers";
import {
  formatWorkerGoal,
  getWorkerStatusVisual,
  isWorkerVisuallyExpired,
  selectRenderableWorkers,
  WORKER_STATUS_VISUALS,
  WORKER_TERMINAL_TTL_MS,
} from "./worker-visuals";

const base = {
  subagent_id: "sa-0-abcd1234",
  goal: "research pricing",
  task_index: 0,
  task_count: 2,
};

function runningWorker(
  id = base.subagent_id,
  now = 1000,
): WorkerState {
  const state = applyWorkerEvent(
    {},
    { type: "subagent.start", payload: { ...base, subagent_id: id } },
    now,
  );

  return workersToArray(state)[0];
}

function completedWorker(
  status: WorkerStatus = "completed",
  completedAt = 2000,
): WorkerState {
  let state = applyWorkerEvent(
    {},
    { type: "subagent.start", payload: base },
    1000,
  );

  state = applyWorkerEvent(
    state,
    {
      type: "subagent.complete",
      payload: { ...base, status, summary: "done" },
    },
    completedAt,
  );

  return workersToArray(state)[0];
}

describe("worker status visuals", () => {
  it("marks only live work as active", () => {
    expect(getWorkerStatusVisual("running").active).toBe(true);
    expect(getWorkerStatusVisual("thinking").active).toBe(true);
    expect(getWorkerStatusVisual("using_tool").active).toBe(true);

    for (const status of [
      "queued",
      "completed",
      "failed",
      "error",
      "timeout",
      "interrupted",
    ] as WorkerStatus[]) {
      expect(getWorkerStatusVisual(status).active).toBe(false);
    }
  });

  it("maps every status to a color and label", () => {
    const statuses = Object.keys(
      WORKER_STATUS_VISUALS,
    ) as WorkerStatus[];

    expect(statuses).toHaveLength(9);

    for (const status of statuses) {
      const visual = getWorkerStatusVisual(status);
      expect(visual.color).toMatch(/^#[0-9a-f]{6}$/i);
      expect(visual.label.length).toBeGreaterThan(0);
    }
  });

  it("never maps a terminal worker to a live-work motion", () => {
    for (const status of [
      "completed",
      "failed",
      "error",
      "timeout",
      "interrupted",
    ] as WorkerStatus[]) {
      const visual = getWorkerStatusVisual(status);

      expect(visual.active).toBe(false);
      expect(["settled", "failed"]).toContain(visual.motion);
    }
  });

  it("gives each live phase a distinct motion", () => {
    expect(getWorkerStatusVisual("queued").motion).toBe("dormant");
    expect(getWorkerStatusVisual("running").motion).toBe("working");
    expect(getWorkerStatusVisual("thinking").motion).toBe("thinking");
    expect(getWorkerStatusVisual("using_tool").motion).toBe("tool");
  });

  it("tracks lifecycle transitions in motion", () => {
    expect(getWorkerStatusVisual(runningWorker().status).motion).toBe(
      "working",
    );
    expect(getWorkerStatusVisual(completedWorker().status).motion).toBe(
      "settled",
    );
    expect(
      getWorkerStatusVisual(completedWorker("failed").status).motion,
    ).toBe("failed");
  });
});

describe("formatWorkerGoal", () => {
  it("falls back for missing goals", () => {
    expect(formatWorkerGoal("")).toBe("untitled task");
    expect(formatWorkerGoal(null)).toBe("untitled task");
    expect(formatWorkerGoal("   ")).toBe("untitled task");
  });

  it("leaves short goals untouched", () => {
    expect(formatWorkerGoal("research pricing")).toBe("research pricing");
  });

  it("truncates long goals with an ellipsis", () => {
    const long = "a".repeat(120);
    const formatted = formatWorkerGoal(long, 20);

    expect(formatted.length).toBeLessThanOrEqual(20);
    expect(formatted.endsWith("…")).toBe(true);
  });
});

describe("terminal retention", () => {
  it("never expires non-terminal workers", () => {
    const worker = runningWorker();

    expect(
      isWorkerVisuallyExpired(worker, worker.updatedAt + 1_000_000),
    ).toBe(false);
  });

  it("retains a terminal worker inside the TTL window", () => {
    const worker = completedWorker();
    const completedAt = worker.completedAt ?? 0;

    expect(completedAt).toBe(2000);
    expect(
      isWorkerVisuallyExpired(
        worker,
        completedAt + WORKER_TERMINAL_TTL_MS - 1,
      ),
    ).toBe(false);
  });

  it("expires a terminal worker at the TTL boundary", () => {
    const worker = completedWorker();
    const completedAt = worker.completedAt ?? 0;

    expect(
      isWorkerVisuallyExpired(
        worker,
        completedAt + WORKER_TERMINAL_TTL_MS,
      ),
    ).toBe(true);
  });

  it("selects only renderable workers, preserving order", () => {
    const active = runningWorker("sa-0-active", 1000);
    const expiredTerminal = completedWorker("failed", 2000);
    const freshTerminal = completedWorker("completed", 50_000);

    const selected = selectRenderableWorkers(
      [active, expiredTerminal, freshTerminal],
      (freshTerminal.completedAt ?? 0) + 1000,
    );

    expect(selected.map((worker) => worker.id)).toEqual([
      active.id,
      freshTerminal.id,
    ]);
  });
});
