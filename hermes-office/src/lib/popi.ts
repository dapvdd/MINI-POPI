import type { AgentStatus } from "./hermes/types";

export const BASE_Y = 0.05;

export const FACING_SCREEN = Math.PI;

const SCREEN_STATUSES: AgentStatus[] = [
  "USING_TOOL",
  "WORKING",
  "TERMINAL",
];

export interface PopiPose {
  position: [number, number, number];
  rotation: [number, number, number];
  facing: number;
  headRotation: [number, number, number];
  armLeft: number;
  armRight: number;
  bodyScale: number;
  eyeOpen: number;
}

function blink(t: number) {
  const phase = t % 3.7;

  return phase < 0.12 ? 0.12 : 1;
}

export function isFacingScreen(status: AgentStatus) {
  return SCREEN_STATUSES.includes(status);
}

export function getPopiPose(
  status: AgentStatus,
  t: number,
): PopiPose {
  const eye = blink(t);

  switch (status) {
    case "THINKING":
      return {
        position: [0, BASE_Y + Math.sin(t * 1.6) * 0.03, 0],
        rotation: [0, 0, Math.sin(t * 1.3) * 0.05],
        facing: 0,
        headRotation: [
          -0.18 + Math.sin(t * 1.1) * 0.08,
          Math.sin(t * 0.8) * 0.55,
          0.14,
        ],
        armLeft: 0.15 + Math.sin(t * 1.6) * 0.1,
        armRight: -0.15 - Math.sin(t * 1.6) * 0.1,
        bodyScale: 1 + Math.sin(t * 1.6) * 0.03,
        eyeOpen: eye,
      };

    case "USING_TOOL":
      return {
        position: [0, BASE_Y, 0],
        rotation: [0.06, 0, 0],
        facing: FACING_SCREEN,
        headRotation: [0.18, Math.sin(t * 2) * 0.12, 0],
        armLeft: Math.sin(t * 13) * 0.45,
        armRight: Math.sin(t * 13 + Math.PI) * 0.45,
        bodyScale: 1 + Math.sin(t * 6) * 0.01,
        eyeOpen: eye,
      };

    case "WORKING":
      return {
        position: [
          0,
          BASE_Y + Math.abs(Math.sin(t * 5)) * 0.09,
          0,
        ],
        rotation: [0.05, 0, Math.sin(t * 5) * 0.06],
        facing: FACING_SCREEN,
        headRotation: [
          0.12 + Math.sin(t * 5) * 0.06,
          Math.sin(t * 2.5) * 0.2,
          0,
        ],
        armLeft: Math.sin(t * 9) * 0.6,
        armRight: Math.sin(t * 9 + Math.PI) * 0.6,
        bodyScale: 1 + Math.sin(t * 5) * 0.04,
        eyeOpen: eye,
      };

    case "TERMINAL":
      return {
        position: [0, BASE_Y + Math.sin(t * 3) * 0.01, 0],
        rotation: [0.08, 0, 0],
        facing: FACING_SCREEN,
        headRotation: [0.22, Math.sin(t * 4) * 0.06, 0],
        armLeft: Math.sin(t * 16) * 0.5,
        armRight: Math.sin(t * 16 + Math.PI) * 0.5,
        bodyScale: 1 + Math.sin(t * 4) * 0.01,
        eyeOpen: eye,
      };

    case "ERROR":
      return {
        position: [Math.sin(t * 38) * 0.06, BASE_Y, 0],
        rotation: [0, 0, Math.sin(t * 30) * 0.12],
        facing: 0,
        headRotation: [
          -0.1,
          Math.sin(t * 20) * 0.12,
          Math.sin(t * 30) * 0.15,
        ],
        armLeft: -0.6 + Math.sin(t * 25) * 0.2,
        armRight: 0.6 - Math.sin(t * 25) * 0.2,
        bodyScale: 1 + Math.sin(t * 12) * 0.03,
        eyeOpen: 1.4,
      };

    case "IDLE":
    default:
      return {
        position: [0, BASE_Y + Math.sin(t * 1.3) * 0.02, 0],
        rotation: [0, Math.sin(t * 0.4) * 0.08, 0],
        facing: 0,
        headRotation: [
          Math.sin(t * 1.3) * 0.03,
          Math.sin(t * 0.4) * 0.1,
          0,
        ],
        armLeft: Math.sin(t * 1.3) * 0.05,
        armRight: -Math.sin(t * 1.3) * 0.05,
        bodyScale: 1 + Math.sin(t * 1.3) * 0.02,
        eyeOpen: eye,
      };
  }
}

export function getBodyColor(status: AgentStatus) {
  switch (status) {
    case "ERROR":
      return "#ef4444";
    case "TERMINAL":
      return "#22c55e";
    case "USING_TOOL":
      return "#fb923c";
    case "WORKING":
      return "#f59e0b";
    case "THINKING":
      return "#a78bfa";
    case "IDLE":
      return "#60a5fa";
    default:
      return "#94a3b8";
  }
}

export function getScreenColor(status: AgentStatus) {
  switch (status) {
    case "ERROR":
      return "#ef4444";
    case "TERMINAL":
      return "#22c55e";
    case "THINKING":
      return "#a78bfa";
    case "USING_TOOL":
    case "WORKING":
      return "#f59e0b";
    default:
      return "#22c55e";
  }
}

export function getScreenGlow(
  status: AgentStatus,
  t: number,
) {
  switch (status) {
    case "ERROR":
      return Math.sin(t * 12) > 0 ? 1.8 : 0.15;
    case "THINKING":
      return 0.9 + Math.sin(t * 3) * 0.4;
    case "USING_TOOL":
      return 1.2 + Math.sin(t * 8) * 0.3;
    case "WORKING":
      return 1.5 + Math.sin(t * 4) * 0.3;
    case "TERMINAL":
      return 1.4 + Math.sin(t * 6) * 0.2;
    case "IDLE":
      return 0.3 + Math.sin(t * 1.2) * 0.05;
    default:
      return 0.08;
  }
}

export function getPointLightIntensity(
  status: AgentStatus,
  t: number,
) {
  switch (status) {
    case "ERROR":
      return Math.sin(t * 12) > 0 ? 8 : 1;
    case "WORKING":
      return 8 + Math.sin(t * 4) * 1.5;
    case "USING_TOOL":
      return 6 + Math.sin(t * 8) * 1;
    case "TERMINAL":
      return 6 + Math.sin(t * 6) * 1;
    case "THINKING":
      return 4 + Math.sin(t * 3) * 1.5;
    case "IDLE":
      return 1.5 + Math.sin(t * 1.2) * 0.3;
    default:
      return 0.5;
  }
}

export function getPointLightColor(
  status: AgentStatus,
) {
  switch (status) {
    case "ERROR":
      return "#ef4444";
    case "TERMINAL":
      return "#22c55e";
    case "THINKING":
      return "#a78bfa";
    default:
      return "#f59e0b";
  }
}
