import { describe, expect, it } from "vitest";
import type { AgentStatus } from "./hermes/types";
import {
  BASE_Y,
  FACING_SCREEN,
  POPI_SCALE,
  POPI_SEAT_ANCHOR,
  POPI_STAND_POSE_POSITION,
  getPopiBehaviorPose,
  getPopiBehaviorRestPose,
  isSeatedBehavior,
  type PopiActivity,
  type PopiBehavior,
  type PopiLocomotion,
} from "./popi";

const TIMES = Array.from({ length: 121 }, (_, index) => index * 0.1);

const ACTIVITIES: PopiActivity[] = [
  "wander",
  "observe",
  "wave",
  "hum",
  "rest",
];

const BEHAVIORS: PopiBehavior[] = [
  "idle",
  "thinking",
  "working",
  "tool-use",
  "terminal",
  "celebrating",
  "error",
  "resting",
  "offline",
];

const ARM_LENGTH = 0.55;
const SHOULDER_X = 0.42;
const SHOULDER_Y = 1.05;
const HEAD_CENTER_Y = 1.65;
const HEAD_RADIUS = 0.38;
const TORSO_RADIUS = 0.35;
const TORSO_MIN_Y = 0.45;
const TORSO_MAX_Y = 1.15;

/** World hand position for the rig, matching three's default XYZ Euler order. */
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
  return Math.hypot(hand[0], hand[1] - HEAD_CENTER_Y, hand[2]);
}

function distanceToTorso(hand: [number, number, number]): number {
  const clampedY = Math.min(
    TORSO_MAX_Y,
    Math.max(TORSO_MIN_Y, hand[1]),
  );

  return Math.hypot(hand[0], hand[2], hand[1] - clampedY);
}

const WALK: PopiLocomotion = { x: 1.4, z: 2.2, facing: 0.7 };

describe("getPopiBehaviorPose", () => {
  it("produces a finite, in-room pose for every behaviour", () => {
    for (const behavior of BEHAVIORS) {
      for (const activity of ACTIVITIES) {
        for (const t of TIMES) {
          const pose = getPopiBehaviorPose({
            behavior,
            activity,
            presence: "online",
            t,
            phase: t % 20,
            locomotion: WALK,
          });

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

          // Never below the floor, never outside a plausible room height.
          expect(pose.position[1]).toBeGreaterThan(-0.05);
          expect(pose.position[1]).toBeLessThan(1);
          expect(Math.abs(pose.position[0])).toBeLessThan(6);
          expect(Math.abs(pose.position[2])).toBeLessThan(6);
        }
      }
    }
  });

  it("keeps both hands clear of the head and torso on every behaviour", () => {
    for (const behavior of BEHAVIORS) {
      for (const activity of ACTIVITIES) {
        for (const t of TIMES) {
          const pose = getPopiBehaviorPose({
            behavior,
            activity,
            presence: "online",
            t,
            phase: t % 20,
            locomotion: WALK,
          });

          for (const side of ["left", "right"] as const) {
            const arm = side === "left" ? pose.armLeft : pose.armRight;
            const armZ = side === "left" ? pose.armLeftZ : pose.armRightZ;
            const hand = handPosition(arm, armZ, side);

            expect(distanceToHead(hand)).toBeGreaterThan(HEAD_RADIUS + 0.02);
            expect(distanceToTorso(hand)).toBeGreaterThan(TORSO_RADIUS + 0.02);
          }
        }
      }
    }
  });

  it("seats the workstation states on the chair and keeps the idle ones standing", () => {
    const seated: PopiBehavior[] = ["thinking", "working", "tool-use", "terminal"];

    for (const behavior of seated) {
      const pose = getPopiBehaviorPose({
        behavior,
        activity: "observe",
        presence: "online",
        t: 3,
      });

      expect(pose.position[0]).toBeCloseTo(POPI_SEAT_ANCHOR[0], 5);
      expect(pose.position[1]).toBeCloseTo(POPI_SEAT_ANCHOR[1], 5);
      expect(pose.position[2]).toBeCloseTo(POPI_SEAT_ANCHOR[2], 5);
      // ...and faces the monitors, not the camera.
      expect(pose.facing).toBeCloseTo(FACING_SCREEN, 5);
    }

    for (const activity of ["wander", "observe", "wave", "hum"] as PopiActivity[]) {
      const pose = getPopiBehaviorPose({
        behavior: "idle",
        activity,
        presence: "online",
        t: 3,
        phase: 1,
        locomotion: WALK,
      });

      if (activity === "wander") {
        expect(pose.position[0]).toBeCloseTo(WALK.x, 5);
        expect(pose.position[2]).toBeCloseTo(WALK.z, 5);
        expect(pose.facing).toBeCloseTo(WALK.facing, 5);
      } else {
        // Standing: on the floor, within a small sway of her own spot.
        expect(pose.position[1]).toBeCloseTo(BASE_Y, 1);
        expect(Math.abs(pose.position[0])).toBeLessThan(0.15);
      }
    }
  });

  it("carries the machine's locomotion only while wandering", () => {
    const walking = getPopiBehaviorPose({
      behavior: "idle",
      activity: "wander",
      presence: "online",
      t: 2,
      locomotion: WALK,
    });
    const standing = getPopiBehaviorPose({
      behavior: "idle",
      activity: "observe",
      presence: "online",
      t: 2,
      locomotion: WALK,
    });

    expect(walking.position[0]).toBeCloseTo(WALK.x, 5);
    expect(walking.facing).toBeCloseTo(WALK.facing, 5);
    expect(Math.abs(standing.position[0])).toBeLessThan(0.15);
    expect(standing.facing).toBeCloseTo(FACING_SCREEN, 5);
  });

  it("walks with a bob and keeps her feet off the floor", () => {
    const bobs = TIMES.map(
      (t) =>
        getPopiBehaviorPose({
          behavior: "idle",
          activity: "wander",
          presence: "online",
          t,
          locomotion: WALK,
        }).position[1] - BASE_Y,
    );

    expect(Math.max(...bobs)).toBeGreaterThan(0.02);
    expect(Math.min(...bobs)).toBeGreaterThanOrEqual(0);
  });

  it("lifts the arms to wave and puts them back down afterwards", () => {
    const raised = TIMES.map(
      (t) =>
        getPopiBehaviorPose({
          behavior: "idle",
          activity: "wave",
          presence: "online",
          t,
          phase: t,
        }).armRight,
    );

    expect(Math.min(...raised)).toBeLessThan(-1.5);

    // After the envelope closes she is back to a neutral arm.
    const lowered = getPopiBehaviorPose({
      behavior: "idle",
      activity: "wave",
      presence: "online",
      t: 5,
      phase: 9,
    }).armRight;

    expect(Math.abs(lowered)).toBeLessThan(0.05);
  });

  it("types harder than it uses a tool, and harder than it thinks", () => {
    const armAt = (behavior: PopiBehavior, t: number) =>
      getPopiBehaviorPose({ behavior, activity: "observe", presence: "online", t })
        .armLeft;

    const travel = (behavior: PopiBehavior) =>
      TIMES.slice(1).reduce(
        (sum, t, index) => sum + Math.abs(armAt(behavior, t) - armAt(behavior, TIMES[index])),
        0,
      );

    // Total arm travel per 12 seconds is how "busy" reads on screen.
    expect(travel("working")).toBeGreaterThan(travel("thinking") * 1.5);
    expect(travel("working")).toBeGreaterThan(travel("tool-use"));

    const amplitude = Math.max(
      ...TIMES.map((t) => Math.abs(armAt("working", t))),
    );

    expect(amplitude).toBeGreaterThan(0.6);
    expect(Math.max(...TIMES.map((t) => Math.abs(armAt("thinking", t))))).toBeGreaterThan(1.3);
    expect(Math.max(...TIMES.map((t) => Math.abs(armAt("tool-use", t))))).toBeGreaterThan(0.5);
  });

  it("hops only while celebrating and settles back to a calm frame", () => {
    const mid = TIMES.map(
      (t) =>
        getPopiBehaviorPose({
          behavior: "celebrating",
          activity: "observe",
          presence: "online",
          t,
          phase: t % 4,
        }).position[1] - BASE_Y,
    );

    expect(Math.max(...mid)).toBeGreaterThan(0.1);

    const settled = getPopiBehaviorPose({
      behavior: "celebrating",
      activity: "observe",
      presence: "online",
      t: 4.4,
      phase: 4.4,
    });

    expect(settled.position[1]).toBeCloseTo(BASE_Y, 5);
    expect(Math.abs(settled.armLeft)).toBeLessThan(0.05);
  });

  it("never shows work posture for a down link", () => {
    const gatewayDown = getPopiBehaviorPose({
      behavior: "resting",
      activity: "observe",
      presence: "gateway-down",
      t: 3,
    });

    expect(gatewayDown.facing).toBe(0);
    expect(Math.abs(gatewayDown.armLeft)).toBeLessThan(0.2);

    const sseDown = getPopiBehaviorPose({
      behavior: "working",
      activity: "observe",
      presence: "sse-down",
      t: 3,
    });

    expect(sseDown.eyeOpen).toBeLessThan(0.2);
    expect(sseDown.armLeft).toBe(0);
  });

  it("makes each behaviour visibly distinct", () => {
    const signatures = BEHAVIORS.map((behavior) => {
      const samples = TIMES.map(
        (t) =>
          getPopiBehaviorPose({
            behavior,
            activity: "observe",
            presence: "online",
            t,
            phase: 2,
          }),
      );

      return JSON.stringify(
        samples.map((pose) => [pose.facing, pose.armLeft, pose.headRotation[0]]),
      );
    });

    expect(new Set(signatures).size).toBe(BEHAVIORS.length);
  });
});

describe("reduced motion", () => {
  it("returns one stable frame per behaviour", () => {
    for (const behavior of BEHAVIORS) {
      for (const activity of ACTIVITIES) {
        expect(
          getPopiBehaviorPose({
            behavior,
            activity,
            presence: "online",
            t: 0,
            reducedMotion: true,
          }),
        ).toEqual(
          getPopiBehaviorPose({
            behavior,
            activity,
            presence: "online",
            t: 12.5,
            reducedMotion: true,
          }),
        );
      }
    }
  });

  it("keeps the seated state seated and eyes open while reduced", () => {
    const pose = getPopiBehaviorPose({
      behavior: "working",
      activity: "observe",
      presence: "online",
      t: 3,
      reducedMotion: true,
    });

    expect(pose.position[1]).toBeCloseTo(POPI_SEAT_ANCHOR[1], 5);
    expect(pose.facing).toBeCloseTo(FACING_SCREEN, 5);
    expect(pose.eyeOpen).toBe(1);

    expect(getPopiBehaviorRestPose("idle", "wander").position).toEqual([
      ...POPI_STAND_POSE_POSITION,
    ]);
  });
});

describe("character rig", () => {
  it("scales the character up without breaking the room", () => {
    // The head must stay under the 4.4-unit ceiling even when seated.
    const seatedHead =
      POPI_SEAT_ANCHOR[1] + POPI_SCALE * HEAD_CENTER_Y + HEAD_RADIUS * POPI_SCALE;

    expect(seatedHead).toBeLessThan(4.4);
    expect(POPI_SCALE).toBeGreaterThan(1.3);
  });

  it("knows which behaviours sit down", () => {
    expect(isSeatedBehavior("working")).toBe(true);
    expect(isSeatedBehavior("thinking")).toBe(true);
    expect(isSeatedBehavior("idle", "rest")).toBe(true);
    expect(isSeatedBehavior("idle", "wander")).toBe(false);
    expect(isSeatedBehavior("celebrating")).toBe(false);
  });
});

describe("pose scenarios mirror real agent statuses", () => {
  const scenarios: Array<[AgentStatus, PopiBehavior]> = [
    ["IDLE", "idle"],
    ["THINKING", "thinking"],
    ["WORKING", "working"],
    ["USING_TOOL", "tool-use"],
    ["TERMINAL", "terminal"],
    ["ERROR", "error"],
  ];

  it("gives every real status its own behaviour pose", () => {
    const signatures = scenarios.map(([, behavior]) =>
      TIMES.map(
        (t) =>
          getPopiBehaviorPose({
            behavior,
            activity: "observe",
            presence: "online",
            t,
            phase: t,
          }).armLeft,
      ).join(","),
    );

    expect(new Set(signatures).size).toBe(scenarios.length);
  });
});
