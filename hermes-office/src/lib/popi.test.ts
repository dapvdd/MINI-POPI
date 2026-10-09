import { describe, expect, it } from "vitest";
import type { AgentStatus } from "./hermes/types";
import {
  BASE_Y,
  blendPose,
  dampAngle,
  dampScalar,
  FACING_SCREEN,
  getBodyColor,
  getPointLightIntensity,
  getPopiPose,
  getPopiRestPose,
  getScreenColor,
  getScreenGlow,
  isFacingScreen,
  resolvePopiPresence,
  type PopiPresence,
} from "./popi";

const TWO_PI = Math.PI * 2;

const STATUSES: AgentStatus[] = [
  "OFFLINE",
  "IDLE",
  "THINKING",
  "USING_TOOL",
  "WORKING",
  "TERMINAL",
  "ERROR",
];

const TIMES = Array.from(
  { length: 101 },
  (_, index) => index * 0.1,
);

function maxAbs(values: number[]) {
  return Math.max(...values.map(Math.abs));
}

const ARM_LENGTH = 0.55;
const SHOULDER_X = 0.42;
const SHOULDER_Y = 1.05;
const HEAD_CENTER_Y = 1.65;
const HEAD_RADIUS = 0.38;
const TORSO_RADIUS = 0.35;
const TORSO_MIN_Y = 0.45;
const TORSO_MAX_Y = 1.15;

/** World(ish) hand-tip position for the arm, matching three's default 'XYZ'
 * Euler order when only rotation.x and rotation.z are set. */
function handPosition(
  arm: number,
  armZ: number,
  side: "left" | "right",
): [number, number, number] {
  const pivotX = side === "left" ? -SHOULDER_X : SHOULDER_X;
  const cosArm = Math.cos(arm);
  const sinArm = Math.sin(arm);
  const cosZ = Math.cos(armZ);
  const sinZ = Math.sin(armZ);

  return [
    pivotX + ARM_LENGTH * sinZ,
    SHOULDER_Y - ARM_LENGTH * cosArm * cosZ,
    -ARM_LENGTH * sinArm * cosZ,
  ];
}

function distanceToHead(hand: [number, number, number]): number {
  return Math.hypot(
    hand[0],
    hand[1] - HEAD_CENTER_Y,
    hand[2],
  );
}

function distanceToTorso(hand: [number, number, number]): number {
  const clampedY = Math.min(
    TORSO_MAX_Y,
    Math.max(TORSO_MIN_Y, hand[1]),
  );

  return Math.hypot(hand[0], hand[2], hand[1] - clampedY);
}

describe("getPopiPose", () => {
  it("stays finite and grounded for every status", () => {
    for (const status of STATUSES) {
      for (const t of TIMES) {
        const pose = getPopiPose(status, t);

        for (const value of [
          ...pose.position,
          ...pose.rotation,
          ...pose.headRotation,
          pose.facing,
          pose.armLeft,
          pose.armRight,
          pose.armLeftZ,
          pose.armRightZ,
          pose.bodyScale,
          pose.eyeOpen,
        ]) {
          expect(Number.isFinite(value)).toBe(true);
        }

        expect(pose.position[2]).toBe(0);
        expect(Math.abs(pose.position[1] - BASE_Y)).toBeLessThanOrEqual(0.1);
      }
    }
  });

  it("IDLE only breathes subtly", () => {
    const bob = TIMES.map(
      (t) => getPopiPose("IDLE", t).position[1] - BASE_Y,
    );
    const sway = TIMES.map(
      (t) => getPopiPose("IDLE", t).rotation[1],
    );

    expect(maxAbs(bob)).toBeLessThanOrEqual(0.021);
    expect(maxAbs(sway)).toBeLessThanOrEqual(0.081);
    expect(isFacingScreen("IDLE")).toBe(false);
  });

  it("THINKING looks clearly different from IDLE", () => {
    const thinkingHeadTilt = TIMES.map(
      (t) => getPopiPose("THINKING", t).headRotation[2],
    );
    const idleHeadTilt = TIMES.map(
      (t) => getPopiPose("IDLE", t).headRotation[2],
    );

    expect(maxAbs(thinkingHeadTilt)).toBeGreaterThan(0.1);
    expect(maxAbs(idleHeadTilt)).toBeLessThan(0.001);
    expect(isFacingScreen("THINKING")).toBe(false);
  });

  it("USING_TOOL swings the arms much harder than IDLE", () => {
    const toolArms = TIMES.map((t) =>
      Math.max(
        Math.abs(getPopiPose("USING_TOOL", t).armLeft),
        Math.abs(getPopiPose("USING_TOOL", t).armRight),
      ),
    );
    const idleArms = TIMES.map((t) =>
      Math.abs(getPopiPose("IDLE", t).armLeft),
    );

    expect(maxAbs(toolArms)).toBeGreaterThan(0.3);
    expect(maxAbs(idleArms)).toBeLessThan(0.1);
  });

  it("WORKING bounces while IDLE does not", () => {
    const workingBob = TIMES.map(
      (t) => getPopiPose("WORKING", t).position[1] - BASE_Y,
    );
    const idleBob = TIMES.map(
      (t) => getPopiPose("IDLE", t).position[1] - BASE_Y,
    );

    expect(maxAbs(workingBob)).toBeGreaterThan(
      maxAbs(idleBob) * 2,
    );
  });

  it("TERMINAL differs from WORKING", () => {
    const terminal = TIMES.map(
      (t) => getPopiPose("TERMINAL", t).headRotation[0],
    );
    const working = TIMES.map(
      (t) => getPopiPose("WORKING", t).headRotation[0],
    );

    expect(maxAbs(terminal)).toBeGreaterThan(0);
    expect(JSON.stringify(terminal)).not.toBe(
      JSON.stringify(working),
    );
  });

  it("ERROR shakes laterally and does not face the screen", () => {
    const shake = TIMES.map(
      (t) => getPopiPose("ERROR", t).position[0],
    );

    expect(maxAbs(shake)).toBeGreaterThan(0.03);
    expect(getPopiPose("ERROR", 0.5).eyeOpen).toBe(1.4);
    expect(isFacingScreen("ERROR")).toBe(false);
  });

  it("turns to the screen for tool, work and terminal states", () => {
    expect(isFacingScreen("USING_TOOL")).toBe(true);
    expect(isFacingScreen("WORKING")).toBe(true);
    expect(isFacingScreen("TERMINAL")).toBe(true);

    expect(getPopiPose("TERMINAL", 1).facing).toBe(
      FACING_SCREEN,
    );
  });

  it("blinks periodically", () => {
    const closed = TIMES.filter(
      (t) => getPopiPose("IDLE", t).eyeOpen < 1,
    );

    expect(closed.length).toBeGreaterThan(0);
    expect(
      TIMES.filter((t) => getPopiPose("IDLE", t).eyeOpen === 1).length,
    ).toBeGreaterThan(0);
  });
});

describe("expressive animation", () => {
  it("IDLE stays calm, low-amplitude and jitter-free", () => {
    const headYaw = TIMES.map(
      (t) => getPopiPose("IDLE", t).headRotation[1],
    );
    const bob = TIMES.map(
      (t) => getPopiPose("IDLE", t).position[1] - BASE_Y,
    );

    expect(maxAbs(headYaw)).toBeLessThan(0.6);
    expect(maxAbs(bob)).toBeLessThanOrEqual(0.021);

    const maxStep = Math.max(
      ...headYaw
        .slice(1)
        .map((value, index) => Math.abs(value - headYaw[index])),
    );

    expect(maxStep).toBeLessThan(0.1);
  });

  it("THINKING tilts, gestures in bursts, and pauses between them", () => {
    const arm = TIMES.map((t) => getPopiPose("THINKING", t).armLeft);

    expect(maxAbs(arm)).toBeGreaterThan(0.6);

    // Released close to the resting arm value for a real fraction of the time.
    const resting = arm.filter(
      (value) => Math.abs(value + 0.2) < 0.12,
    ).length;

    expect(resting).toBeGreaterThan(arm.length * 0.2);
  });

  it("THINKING reorients toward the monitor and returns", () => {
    const facing = TIMES.map(
      (t) => getPopiPose("THINKING", t).facing,
    );

    expect(Math.max(...facing)).toBeGreaterThan(1.0);
    expect(Math.min(...facing)).toBeLessThan(0.5);
  });

  it("WORKING keeps a forward posture with non-synchronized arms", () => {
    const left = TIMES.map((t) => getPopiPose("WORKING", t).armLeft);
    const right = TIMES.map((t) => getPopiPose("WORKING", t).armRight);
    const mean = left.reduce((sum, value) => sum + value, 0) / left.length;

    expect(mean).toBeLessThan(-0.5);
    expect(maxAbs(left)).toBeGreaterThan(0.6);
    expect(maxAbs(left)).toBeLessThan(1.3);

    const identical = left.filter(
      (value, index) => Math.abs(value - right[index]) < 1e-6,
    ).length;

    expect(identical).toBe(0);
  });

  it("USING_TOOL is deliberate, not more typing", () => {
    const reversals = (values: number[]) =>
      values.slice(2).filter((value, index) => {
        const previous = values[index + 1] - values[index];

        return previous * (value - values[index + 1]) < 0;
      }).length;

    const working = TIMES.map((t) => getPopiPose("WORKING", t).armLeft);
    const tool = TIMES.map((t) => getPopiPose("USING_TOOL", t).armLeft);

    expect(maxAbs(tool)).toBeGreaterThan(0.3);
    expect(reversals(tool)).toBeLessThan(reversals(working));
  });

  it("keeps both hands clear of the head and torso on every online status", () => {
    const statuses: AgentStatus[] = [
      "IDLE",
      "THINKING",
      "USING_TOOL",
      "WORKING",
      "TERMINAL",
      "ERROR",
    ];

    for (const status of statuses) {
      for (const t of TIMES) {
        const pose = getPopiPose(status, t);

        for (const side of ["left", "right"] as const) {
          const arm = side === "left" ? pose.armLeft : pose.armRight;
          const armZ =
            side === "left" ? pose.armLeftZ : pose.armRightZ;
          const hand = handPosition(arm, armZ, side);

          // A 0.02 margin over the raw geometry radius, so the 0.16-thick arm
          // never visibly intersects the body.
          expect(distanceToHead(hand)).toBeGreaterThan(HEAD_RADIUS + 0.02);
          expect(distanceToTorso(hand)).toBeGreaterThan(
            TORSO_RADIUS + 0.02,
          );
        }
      }
    }
  });
});

describe("pose transitions", () => {
  it("dampScalar eases monotonically toward the target with no overshoot", () => {
    let value = 0;

    for (let i = 0; i < 120; i += 1) {
      const previous = value;
      value = dampScalar(value, 1, 8, 1 / 60);
      expect(value).toBeGreaterThanOrEqual(previous);
      expect(value).toBeLessThanOrEqual(1);
    }

    expect(value).toBeGreaterThan(0.99);
  });

  it("dampScalar is frame-rate independent", () => {
    const once = dampScalar(0, 1, 8, 0.1);
    let stepped = 0;

    for (let i = 0; i < 6; i += 1) {
      stepped = dampScalar(stepped, 1, 8, 0.1 / 6);
    }

    expect(Math.abs(once - stepped)).toBeLessThan(1e-9);
  });

  it("dampAngle takes the shortest way around", () => {
    const next = dampAngle(0.1, TWO_PI - 0.1, 8, 1 / 60);

    expect(next).toBeLessThan(0.1);
    expect(0.1 - next).toBeGreaterThan(0);
    expect(0.1 - next).toBeLessThan(0.05);
  });

  it("blendPose eases channels in place without snapping blinks", () => {
    const current = getPopiRestPose("IDLE", "online");
    const reference = current;
    const target = getPopiPose("WORKING", 2, {});

    const blended = blendPose(current, target, 1 / 60);

    expect(blended).toBe(reference);
    expect(current.armLeft).toBeGreaterThan(target.armLeft);
    expect(current.armLeft).toBeLessThan(0);
    expect(current.facing).toBeGreaterThan(0);
    expect(current.facing).toBeLessThan(FACING_SCREEN);
    expect(current.eyeOpen).toBe(target.eyeOpen);

    for (let i = 0; i < 600; i += 1) {
      blendPose(current, target, 1 / 60);
    }

    expect(Math.abs(current.armLeft - target.armLeft)).toBeLessThan(1e-3);
    expect(Math.abs(current.facing - target.facing)).toBeLessThan(1e-3);
  });

  it("eases across a status switch without a single-frame jump", () => {
    const dt = 1 / 60;
    let pose = getPopiPose("IDLE", 0);
    let t = 0;
    let maxArmStep = 0;
    let maxFacingStep = 0;

    for (let frame = 0; frame < 180; frame += 1) {
      t += dt;

      const status: AgentStatus = frame < 60 ? "IDLE" : "WORKING";
      const target = getPopiPose(status, t);
      const beforeArm = pose.armLeft;
      const beforeFacing = pose.facing;

      pose = blendPose(pose, target, dt);

      maxArmStep = Math.max(
        maxArmStep,
        Math.abs(pose.armLeft - beforeArm),
      );
      maxFacingStep = Math.max(
        maxFacingStep,
        Math.abs(pose.facing - beforeFacing),
      );
    }

    // A snap would be the full delta (arm ~0.95 rad, facing PI) in one frame;
    // easing spreads each change over many frames instead.
    expect(maxArmStep).toBeLessThan(0.25);
    expect(maxFacingStep).toBeLessThan(0.3);
    expect(maxFacingStep).toBeLessThan(FACING_SCREEN / 4);
  });
});

describe("visual identity", () => {
  it("gives each key status its own body color", () => {
    const colors = [
      getBodyColor("IDLE"),
      getBodyColor("THINKING"),
      getBodyColor("USING_TOOL"),
      getBodyColor("WORKING"),
      getBodyColor("TERMINAL"),
      getBodyColor("ERROR"),
    ];

    expect(new Set(colors).size).toBe(colors.length);
    expect(getBodyColor("ERROR")).toBe("#ef4444");
  });

  it("flashes the screen on ERROR and pulses on THINKING", () => {
    const errorValues = TIMES.map((t) => getScreenGlow("ERROR", t));

    expect(Math.min(...errorValues)).toBeLessThan(0.5);
    expect(Math.max(...errorValues)).toBeGreaterThan(1);

    const thinkValues = TIMES.map((t) =>
      getScreenGlow("THINKING", t),
    );

    expect(Math.max(...thinkValues) - Math.min(...thinkValues)).toBeGreaterThan(0.5);
  });
});

describe("resolvePopiPresence", () => {
  it("treats a missing SSE link as the strongest signal", () => {
    expect(
      resolvePopiPresence({
        sseConnected: false,
        gatewayConnected: true,
        connectionError: null,
      }),
    ).toBe("sse-down");

    expect(
      resolvePopiPresence({
        sseConnected: false,
        gatewayConnected: false,
        connectionError: "auth",
      }),
    ).toBe("sse-down");
  });

  it("separates an auth rejection from a transient gateway loss", () => {
    expect(
      resolvePopiPresence({
        sseConnected: true,
        gatewayConnected: false,
        connectionError: "auth",
      }),
    ).toBe("auth-error");

    expect(
      resolvePopiPresence({
        sseConnected: true,
        gatewayConnected: false,
        connectionError: "transient",
      }),
    ).toBe("gateway-down");

    expect(
      resolvePopiPresence({
        sseConnected: true,
        gatewayConnected: true,
        connectionError: null,
      }),
    ).toBe("online");
  });
});

describe("Popi presence poses", () => {
  it("freezes to a powered-down rest pose when SSE is down", () => {
    for (const t of TIMES) {
      expect(getPopiPose("WORKING", t, { presence: "sse-down" })).toEqual(
        getPopiPose("WORKING", 0, { presence: "sse-down" }),
      );
    }

    const pose = getPopiPose("WORKING", 1.3, { presence: "sse-down" });

    expect(pose.eyeOpen).toBeLessThan(0.2);
    expect(pose.armLeft).toBe(0);
    expect(pose.armRight).toBe(0);
  });

  it("waits without faking work when the gateway is down", () => {
    const gateway = TIMES.map((t) =>
      getPopiPose("WORKING", t, { presence: "gateway-down" }),
    );
    const working = TIMES.map((t) => getPopiPose("WORKING", t));

    const gatewayArms = maxAbs(gateway.map((pose) => pose.armLeft));
    const workingArms = maxAbs(working.map((pose) => pose.armLeft));

    expect(gatewayArms).toBeLessThan(0.2);
    expect(workingArms).toBeGreaterThan(gatewayArms);

    for (const pose of gateway) {
      expect(pose.facing).toBe(0);
    }
  });

  it("treats a rejected token as an error even from an idle status", () => {
    const pose = getPopiPose("IDLE", 0.5, { presence: "auth-error" });

    expect(pose.eyeOpen).toBe(1.4);
    expect(Math.abs(pose.armLeft)).toBeGreaterThan(0.3);
    expect(getBodyColor("IDLE", "auth-error")).toBe("#ef4444");
  });
});

describe("reduced motion", () => {
  const PRESENCES: PopiPresence[] = [
    "online",
    "gateway-down",
    "sse-down",
    "auth-error",
  ];

  it("returns a time-independent pose for every presence", () => {
    for (const presence of PRESENCES) {
      expect(
        getPopiPose("THINKING", 0, { presence, reducedMotion: true }),
      ).toEqual(
        getPopiPose("THINKING", 5.7, { presence, reducedMotion: true }),
      );
    }
  });

  it("keeps eyes open and arms at rest while reduced", () => {
    const pose = getPopiRestPose("WORKING", "online");

    expect(pose.eyeOpen).toBe(1);
    expect(pose.armLeft).toBe(0);
    expect(pose.armRight).toBe(0);
    expect(pose.facing).toBe(FACING_SCREEN);
  });
});

describe("presence visuals", () => {
  it("dims the screen and light when disconnected", () => {
    expect(getScreenGlow("WORKING", 1, "sse-down")).toBeLessThan(0.1);
    expect(getPointLightIntensity("WORKING", 1, "sse-down")).toBe(0);
    expect(
      getPointLightIntensity("WORKING", 1, "gateway-down"),
    ).toBeLessThan(1);
    expect(getScreenColor("WORKING", "sse-down")).not.toBe(
      getScreenColor("WORKING"),
    );
  });
});
