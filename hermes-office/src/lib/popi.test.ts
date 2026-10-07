import { describe, expect, it } from "vitest";
import type { AgentStatus } from "./hermes/types";
import {
  BASE_Y,
  FACING_SCREEN,
  getBodyColor,
  getPopiPose,
  getScreenGlow,
  isFacingScreen,
} from "./popi";

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
