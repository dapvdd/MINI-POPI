import { describe, expect, it } from "vitest";
import type { AgentStatus } from "./hermes/types";
import {
  ACTIVITY_COOLDOWN,
  ACTIVITY_DURATIONS,
  CELEBRATION_DURATION,
  MAX_BEHAVIOR_STEP,
  createPopiRuntime,
  getPopiBehaviorTraits,
  resolvePopiBehavior,
  resolveVisor,
  selectNextActivity,
  stepPopiRuntime,
  type PopiActivity,
  type PopiBehavior,
} from "./popi-behavior";
import type { PopiPresence } from "./popi";
import { POPI_SEAT_ANCHOR } from "./popi";
import {
  isClearOfFurniture,
  isWanderPointSafe,
  isWithinWanderLimits,
} from "./popi-navigation";

const STATUSES: AgentStatus[] = [
  "OFFLINE",
  "IDLE",
  "THINKING",
  "USING_TOOL",
  "WORKING",
  "TERMINAL",
  "ERROR",
];

const PRESENCES: PopiPresence[] = [
  "online",
  "sse-down",
  "gateway-down",
  "auth-error",
];

const ACTIVITIES: PopiActivity[] = [
  "wander",
  "observe",
  "wave",
  "hum",
  "rest",
];

function run(
  options: {
    status?: AgentStatus;
    presence?: PopiPresence;
    seconds?: number;
    turnSeq?: number;
    frame?: number;
  } = {},
) {
  const {
    status = "IDLE",
    presence = "online",
    seconds = 20,
    turnSeq = 0,
    frame = 1 / 60,
  } = options;

  const machine = createPopiRuntime();
  const trace: Array<{ behavior: PopiBehavior; activity: PopiActivity }> = [];
  const frames = Math.round(seconds / frame);

  for (let i = 0; i < frames; i += 1) {
    stepPopiRuntime(machine, frame, { status, presence, turnSeq });
    trace.push({ behavior: machine.behavior, activity: machine.activity });
  }

  return { machine, trace };
}

describe("resolvePopiBehavior", () => {
  it("maps every real agent status to a behaviour", () => {
    expect(resolvePopiBehavior("IDLE", "online")).toBe("idle");
    expect(resolvePopiBehavior("THINKING", "online")).toBe("thinking");
    expect(resolvePopiBehavior("WORKING", "online")).toBe("working");
    expect(resolvePopiBehavior("USING_TOOL", "online")).toBe("tool-use");
    expect(resolvePopiBehavior("TERMINAL", "online")).toBe("terminal");
    expect(resolvePopiBehavior("ERROR", "online")).toBe("error");
  });

  it("never lets a down link look like work", () => {
    for (const status of STATUSES) {
      expect(resolvePopiBehavior(status, "sse-down")).toBe("offline");
      expect(resolvePopiBehavior(status, "gateway-down")).toBe("resting");
      expect(resolvePopiBehavior(status, "auth-error")).toBe("error");
    }
  });

  it("treats an unknown status as resting, not as activity", () => {
    expect(resolvePopiBehavior("OFFLINE", "online")).toBe("resting");
  });

  it("is a total function over every real combination", () => {
    for (const status of STATUSES) {
      for (const presence of PRESENCES) {
        expect(resolvePopiBehavior(status, presence)).toBeTruthy();
      }
    }
  });
});

describe("getPopiBehaviorTraits", () => {
  it("seats the workstation states and keeps the idle ones standing", () => {
    for (const behavior of ["thinking", "working", "tool-use", "terminal"] as const) {
      expect(getPopiBehaviorTraits(behavior).seated).toBe(true);
    }

    expect(getPopiBehaviorTraits("idle", "wander").seated).toBe(false);
    expect(getPopiBehaviorTraits("idle", "rest").seated).toBe(true);
  });

  it("gives each behaviour only the effects it earned", () => {
    expect(getPopiBehaviorTraits("thinking").thoughtSymbols).toBe(true);
    expect(getPopiBehaviorTraits("thinking").thoughtSymbols && getPopiBehaviorTraits("working").thoughtSymbols).toBe(
      false,
    );

    const working = getPopiBehaviorTraits("working");
    expect(working.aura).toBe(true);
    expect(working.typing).toBe(true);
    expect(working.visor).toBe(false);

    const terminal = getPopiBehaviorTraits("terminal");
    expect(terminal.aura).toBe(true);
    expect(terminal.particles).toBe(true);
    expect(terminal.visor).toBe(true);

    const resting = getPopiBehaviorTraits("resting");
    expect(resting.typing).toBe(false);
    expect(resting.aura).toBe(false);
    expect(resting.visor).toBe(false);

    const idle = getPopiBehaviorTraits("idle", "hum");
    expect(idle.autonomous).toBe(true);
    expect(idle.humCue).toBe(true);
    expect(getPopiBehaviorTraits("idle", "observe").humCue).toBe(false);
  });

  it("marks only a real celebration as celebrating", () => {
    expect(getPopiBehaviorTraits("celebrating").celebrate).toBe(true);
    expect(getPopiBehaviorTraits("working").celebrate).toBe(false);
  });
});

describe("resolveVisor", () => {
  it("appears only for terminal behaviour, and never when switched off", () => {
    expect(resolveVisor("terminal", "auto")).toBe(true);
    expect(resolveVisor("working", "auto")).toBe(false);
    expect(resolveVisor("terminal", "off")).toBe(false);
  });
});

describe("selectNextActivity", () => {
  it("never repeats the activity that just ran", () => {
    const cooldown = { wander: 0, observe: 0, wave: 0, hum: 0, rest: 0 };

    for (let index = 1; index <= 500; index += 1) {
      for (const current of ACTIVITIES) {
        expect(selectNextActivity(index, cooldown, current)).not.toBe(current);
      }
    }
  });

  it("is deterministic", () => {
    const cooldown = { wander: 0, observe: 0, wave: 0, hum: 0, rest: 0 };

    expect(selectNextActivity(9, cooldown, "wander")).toBe(
      selectNextActivity(9, cooldown, "wander"),
    );
  });

  it("respects cooldowns and never returns an activity still cooling down", () => {
    const cooldown = { wander: 0, observe: 5, wave: 5, hum: 0, rest: 5 };

    for (let index = 1; index <= 200; index += 1) {
      const next = selectNextActivity(index, cooldown, "wander");

      expect(["wander", "hum"]).toContain(next);
    }
  });

  it("always produces a valid activity, even with everything cooling down", () => {
    const cooldown = { wander: 9, observe: 9, wave: 9, hum: 9, rest: 9 };

    for (let index = 1; index <= 50; index += 1) {
      expect(ACTIVITIES).toContain(
        selectNextActivity(index, cooldown, "observe"),
      );
    }
  });

  it("visits every activity over a long deterministic run", () => {
    const cooldown = { wander: 0, observe: 0, wave: 0, hum: 0, rest: 0 };
    const seen = new Set<PopiActivity>();
    let current: PopiActivity = "observe";

    for (let index = 1; index < 200; index += 1) {
      current = selectNextActivity(index, cooldown, current);
      seen.add(current);
    }

    expect(seen.size).toBe(ACTIVITIES.length);
  });
});

describe("autonomous scheduling", () => {
  it("runs other activities while idle and none while working", () => {
    const { trace } = run({ seconds: 90 });
    const activities = new Set(trace.map((frame) => frame.activity));

    expect(activities.size).toBeGreaterThan(2);
    expect(trace.every((frame) => frame.behavior === "idle")).toBe(true);

    const working = run({ status: "WORKING", seconds: 30 });
    expect(working.trace.every((frame) => frame.behavior === "working")).toBe(
      true,
    );
  });

  /** Collapse the trace into runs of the same activity. */
  function activityRuns(trace: Array<{ behavior: PopiBehavior; activity: PopiActivity }>) {
    const runs: Array<{ activity: PopiActivity; frames: number }> = [];

    for (const frame of trace) {
      if (frame.behavior !== "idle") {
        continue;
      }

      const last = runs[runs.length - 1];

      if (last && last.activity === frame.activity) {
        last.frames += 1;
      } else {
        runs.push({ activity: frame.activity, frames: 1 });
      }
    }

    return runs;
  }

  it("never runs the same activity twice in a row", () => {
    const runs = activityRuns(run({ seconds: 240 }).trace);

    for (let i = 1; i < runs.length; i += 1) {
      expect(runs[i].activity).not.toBe(runs[i - 1].activity);
    }
  });

  it("visits every autonomous activity", () => {
    const seen = new Set(
      activityRuns(run({ seconds: 300 }).trace).map((run_) => run_.activity),
    );

    for (const activity of ACTIVITIES) {
      expect(seen).toContain(activity);
    }
  });

  it("holds an activity for its whole duration instead of flickering", () => {
    const frame = 1 / 60;
    const runs = activityRuns(run({ seconds: 240, frame }).trace);

    // The last run is cut off by the end of the simulation window.
    for (const run_ of runs.slice(0, -1)) {
      const duration = ACTIVITY_DURATIONS[run_.activity];

      // Standing activities always run to term; a wander may end early once she
      // reaches a target and picks the next one.
      expect(run_.frames).toBeGreaterThanOrEqual(
        Math.floor(duration / frame) - 2,
      );
    }
  });

  it("honours the cooldown before repeating an activity", () => {
    const frame = 1 / 20;
    const runs = activityRuns(run({ seconds: 600, frame }).trace);
    const lastFrame: Record<PopiActivity, number> = {
      wander: 0,
      observe: 0,
      wave: 0,
      hum: 0,
      rest: 0,
    };

    runs.forEach((run_, index) => {
      if (index === 0) return;

      const expected =
        (ACTIVITY_DURATIONS[run_.activity] + ACTIVITY_COOLDOWN) / frame;

      expect(run_.frames).toBeLessThanOrEqual(expected + 2);
      lastFrame[run_.activity] = 0;
    });

    expect(runs.length).toBeGreaterThan(20);
  });
});

describe("wander locomotion", () => {
  it("stays inside the roamable area and off the furniture", () => {
    const machine = createPopiRuntime();
    const frame = 1 / 60;
    let clearFrames = 0;
    let unsafeAfterClear = 0;
    let movedFrames = 0;

    for (let i = 0; i < 60 * 60 * 4; i += 1) {
      stepPopiRuntime(machine, frame, {
        status: "IDLE",
        presence: "online",
        turnSeq: 0,
      });

      expect(isWithinWanderLimits(machine.x, machine.z)).toBe(true);

      if (machine.activity === "wander") {
        movedFrames += 1;

        // The invariant that matters: once she has cleared the furniture she
        // never walks back into it, at any point over two hours of wandering.
        if (isClearOfFurniture(machine.x, machine.z)) {
          clearFrames += 1;

          if (!isWanderPointSafe(machine.x, machine.z)) {
            unsafeAfterClear += 1;
          }
        }
      }
    }

    expect(movedFrames).toBeGreaterThan(60 * 30);
    expect(clearFrames).toBeGreaterThan(500);
    expect(unsafeAfterClear).toBe(0);
  });

  it("actually walks the character somewhere", () => {
    const machine = createPopiRuntime();
    let travelled = 0;
    let previousX = machine.x;
    let previousZ = machine.z;

    for (let i = 0; i < 60 * 120; i += 1) {
      stepPopiRuntime(machine, 1 / 60, {
        status: "IDLE",
        presence: "online",
        turnSeq: 0,
      });

      if (machine.activity === "wander") {
        travelled += Math.hypot(machine.x - previousX, machine.z - previousZ);
        previousX = machine.x;
        previousZ = machine.z;
      }
    }

    // Two minutes of wandering has to cover a plausible distance, not stay on
    // the same pixel.
    expect(travelled).toBeGreaterThan(10);
  });

  it("keeps a finite heading at all times", () => {
    const { machine } = run({ seconds: 120, frame: 1 / 30 });

    expect(Number.isFinite(machine.facing)).toBe(true);
    expect(Math.abs(machine.facing)).toBeLessThan(Math.PI * 2 + 0.001);
  });

  it("clamps a huge frame delta so a hidden tab cannot teleport her", () => {
    const machine = createPopiRuntime();
    const before = { x: machine.x, z: machine.z };

    stepPopiRuntime(machine, 30, {
      status: "IDLE",
      presence: "online",
      turnSeq: 0,
    });

    // Only one clamped step is integrated: the machine has to advance a fraction
    // of a second, not thirty of them.
    expect(machine.elapsed).toBeCloseTo(MAX_BEHAVIOR_STEP, 6);
    expect(!isWithinWanderLimits(machine.x, machine.z)).toBe(false);

    const moved = Math.hypot(machine.x - before.x, machine.z - before.z);

    expect(moved).toBeLessThan(2);
  });
});

describe("seated workstation states", () => {
  it("eases onto the chair when a state seats her", () => {
    const machine = createPopiRuntime();

    for (let i = 0; i < 60 * 10; i += 1) {
      stepPopiRuntime(machine, 1 / 60, {
        status: "IDLE",
        presence: "online",
        turnSeq: 0,
      });
    }

    const wanderDistance = Math.hypot(
      machine.x - POPI_SEAT_ANCHOR[0],
      machine.z - POPI_SEAT_ANCHOR[2],
    );

    for (let i = 0; i < 60 * 8; i += 1) {
      stepPopiRuntime(machine, 1 / 60, {
        status: "WORKING",
        presence: "online",
        turnSeq: 0,
      });
    }

    expect(machine.behavior).toBe("working");
    expect(wanderDistance).toBeGreaterThan(0);
    expect(machine.x).toBeCloseTo(POPI_SEAT_ANCHOR[0], 1);
    expect(machine.z).toBeCloseTo(POPI_SEAT_ANCHOR[2], 1);
  });

  it("returns to standing activities once real work ends", () => {
    const machine = createPopiRuntime();

    for (let i = 0; i < 600; i += 1) {
      stepPopiRuntime(machine, 1 / 60, {
        status: "WORKING",
        presence: "online",
        turnSeq: 0,
      });
    }

    expect(Math.hypot(
      machine.x - POPI_SEAT_ANCHOR[0],
      machine.z - POPI_SEAT_ANCHOR[2],
    )).toBeLessThan(0.05);

    let furthest = 0;

    for (let i = 0; i < 60 * 40; i += 1) {
      stepPopiRuntime(machine, 1 / 60, {
        status: "IDLE",
        presence: "online",
        turnSeq: 0,
      });

      furthest = Math.max(
        furthest,
        Math.hypot(
          machine.x - POPI_SEAT_ANCHOR[0],
          machine.z - POPI_SEAT_ANCHOR[2],
        ),
      );
    }

    expect(machine.behavior).toBe("idle");
    expect(furthest).toBeGreaterThan(0.4);
  });
});

describe("completion celebration", () => {
  it("celebrates a real turn, then returns to idle", () => {
    const machine = createPopiRuntime();

    stepPopiRuntime(machine, 1 / 60, {
      status: "IDLE",
      presence: "online",
      turnSeq: 1,
    });
    expect(machine.behavior).toBe("celebrating");

    for (let i = 0; i < Math.round(CELEBRATION_DURATION * 60); i += 1) {
      stepPopiRuntime(machine, 1 / 60, {
        status: "IDLE",
        presence: "online",
        turnSeq: 1,
      });
    }

    expect(machine.behavior).toBe("idle");
  });

  it("does not re-trigger for the same turn", () => {
    const machine = createPopiRuntime();

    stepPopiRuntime(machine, 1 / 60, {
      status: "IDLE",
      presence: "online",
      turnSeq: 4,
    });
    expect(machine.behavior).toBe("celebrating");

    for (let i = 0; i < 60 * 3; i += 1) {
      stepPopiRuntime(machine, 1 / 60, {
        status: "IDLE",
        presence: "online",
        turnSeq: 4,
      });
    }

    // Still the one celebration, not a new one.
    expect(machine.celebration).toBeLessThan(CELEBRATION_DURATION - 3);
    expect(machine.behavior).toBe("celebrating");

    for (let i = 0; i < 60 * 5; i += 1) {
      stepPopiRuntime(machine, 1 / 60, {
        status: "IDLE",
        presence: "online",
        turnSeq: 4,
      });
    }

    expect(machine.behavior).toBe("idle");
  });

  it("never celebrates while the agent is not idle", () => {
    for (const status of ["WORKING", "THINKING", "ERROR"] as AgentStatus[]) {
      const machine = createPopiRuntime();

      stepPopiRuntime(machine, 1 / 60, {
        status,
        presence: "online",
        turnSeq: 9,
      });

      expect(machine.behavior).not.toBe("celebrating");
      expect(machine.celebration).toBe(0);
    }
  });

  it("does not celebrate a turn the Gateway never reported", () => {
    const machine = createPopiRuntime();

    for (let i = 0; i < 600; i += 1) {
      stepPopiRuntime(machine, 1 / 60, {
        status: "IDLE",
        presence: "online",
        turnSeq: 0,
      });
    }

    expect(machine.behavior).toBe("idle");
  });
});

describe("offline and error states", () => {
  it("powers down without faking a companion", () => {
    const { machine, trace } = run({
      status: "WORKING",
      presence: "sse-down",
      seconds: 30,
    });

    expect(machine.behavior).toBe("offline");
    expect(trace.some((frame) => frame.behavior === "idle")).toBe(false);
  });

  it("waits patiently while the gateway link is down", () => {
    const { machine, trace } = run({
      status: "WORKING",
      presence: "gateway-down",
      seconds: 30,
    });

    expect(machine.behavior).toBe("resting");
    expect(trace.some((frame) => frame.behavior === "idle")).toBe(false);
  });
});

describe("createPopiRuntime", () => {
  it("starts idle, calm and somewhere walkable", () => {
    const machine = createPopiRuntime();

    expect(machine.behavior).toBe("idle");
    expect(machine.elapsed).toBe(0);
    expect(machine.celebration).toBe(0);
    expect(isWithinWanderLimits(machine.x, machine.z)).toBe(true);
    for (const activity of ACTIVITIES) {
      expect(machine.cooldown[activity]).toBe(0);
    }
  });
});
