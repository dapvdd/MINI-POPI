import type { GatewayErrorKind } from "./hermes/connection";
import type { AgentStatus } from "./hermes/types";

export const BASE_Y = 0.05;

export const FACING_SCREEN = Math.PI;

const TWO_PI = Math.PI * 2;

const SCREEN_STATUSES: AgentStatus[] = [
  "USING_TOOL",
  "WORKING",
  "TERMINAL",
];

/**
 * Connection presence, derived from the two links the UI already tracks. This
 * is deliberately separate from `AgentStatus`: a turn status can be stale or
 * unknown while the transport is down, so presence decides whether Popi looks
 * online, waiting on the Gateway, or fully offline.
 */
export type PopiPresence =
  | "online"
  | "gateway-down"
  | "sse-down"
  | "auth-error";

export interface PopiPresenceInput {
  /** Browser -> Next.js SSE link. */
  sseConnected: boolean;
  /** Next.js -> Hermes Gateway WebSocket link. */
  gatewayConnected: boolean;
  connectionError: GatewayErrorKind | null;
}

/**
 * Precedence: no SSE means we cannot observe anything at all; an auth rejection
 * is a permanent error; a connected SSE with a down Gateway is a patient wait.
 */
export function resolvePopiPresence({
  sseConnected,
  gatewayConnected,
  connectionError,
}: PopiPresenceInput): PopiPresence {
  if (!sseConnected) {
    return "sse-down";
  }

  if (connectionError === "auth") {
    return "auth-error";
  }

  if (!gatewayConnected) {
    return "gateway-down";
  }

  return "online";
}

/**
 * Target pose for Popi. `armLeft`/`armRight` are shoulder pitch (rotation.x);
 * `armLeftZ`/`armRightZ` are shoulder roll (rotation.z), which is what lifts a
 * hand toward the chest for the thinking gesture. The rig is the existing
 * single-segment arm: no elbow or finger joint is assumed anywhere.
 */
export interface PopiPose {
  position: [number, number, number];
  rotation: [number, number, number];
  facing: number;
  headRotation: [number, number, number];
  armLeft: number;
  armRight: number;
  armLeftZ: number;
  armRightZ: number;
  bodyScale: number;
  eyeOpen: number;
}

export interface PopiPoseOptions {
  presence?: PopiPresence;
  reducedMotion?: boolean;
}

/* =========================================================
   MOTION PRIMITIVES
   Deterministic, allocation-free, and non-repeating enough to
   avoid the "obvious loop" look while staying unit-testable.
========================================================= */

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function smoothstep(fraction: number): number {
  const x = clamp01(fraction);

  return x * x * (3 - 2 * x);
}

/** Deterministic pseudo-random value in [0, 1) from an integer seed. */
function hash01(seed: number): number {
  const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453;

  return value - Math.floor(value);
}

/**
 * Smooth value noise in [0, 1] that only changes once per `period` seconds.
 * Used for deliberate gaze/posture shifts and rhythm variation without touching
 * per-frame randomness or allocating.
 */
export function smoothNoise(
  t: number,
  period: number,
  offset = 0,
): number {
  const x = (t + offset) / period;
  const index = Math.floor(x);
  const fraction = x - index;
  const from = hash01(index);
  const to = hash01(index + 1);

  return from + (to - from) * smoothstep(fraction);
}

/**
 * Smooth 0 -> 1 -> 0 burst once per `period`, silent for the rest. This is what
 * gives THINKING short gestures and real pauses instead of constant motion.
 */
export function pulse(
  t: number,
  period: number,
  activeFraction: number,
  offset = 0,
): number {
  const wrapped = (((t + offset) % period) + period) % period;
  const fraction = wrapped / period;

  if (fraction >= activeFraction) {
    return 0;
  }

  return Math.sin(Math.PI * (fraction / activeFraction));
}

/** Blink whose inter-blink timing drifts, so it never looks metronomic. */
function blink(t: number, period = 3.9): number {
  const phase = (t + smoothNoise(t, 17, 3) * 0.6) % period;

  if (phase < 0.1) {
    return 0.1;
  }

  if (phase < 0.2) {
    return 0.1 + ((phase - 0.1) / 0.1) * 0.9;
  }

  return 1;
}

function makePose(partial: Partial<PopiPose>): PopiPose {
  return {
    position: [0, BASE_Y, 0],
    rotation: [0, 0, 0],
    facing: 0,
    headRotation: [0, 0, 0],
    armLeft: 0,
    armRight: 0,
    armLeftZ: 0,
    armRightZ: 0,
    bodyScale: 1,
    eyeOpen: 1,
    ...partial,
  };
}

export function isFacingScreen(status: AgentStatus) {
  return SCREEN_STATUSES.includes(status);
}

/* =========================================================
   ONLINE STATUS POSES
========================================================= */

/**
 * IDLE: calm and alive, not continuously animated. A slow breath plus a low
 * sway, with infrequent posture shifts (pulses) and a drifting gaze. Amplitudes
 * stay tiny so the office stays readable.
 */
function idlePose(t: number): PopiPose {
  const breathe = Math.sin(t * 0.85);
  const sway = Math.sin(t * 0.31 + 0.5);
  const shift =
    pulse(t, 13.0, 0.35, 2.0) - pulse(t, 17.5, 0.3, 7.5);
  const turn = Math.max(0, shift);
  const gaze = (smoothNoise(t, 6.5, 1.3) - 0.5) * 0.5;

  return makePose({
    position: [
      0.02 * sway + 0.03 * shift,
      BASE_Y + 0.009 * breathe,
      0,
    ],
    rotation: [0, 0, 0.014 * sway + 0.02 * shift],
    facing: 0.3 * turn,
    headRotation: [
      0.02 + 0.03 * breathe,
      gaze * (0.6 + 0.4 * Math.abs(shift)) + 0.25 * turn,
      0,
    ],
    armLeft: 0.02 * sway + 0.05 * shift,
    armRight: -0.02 * sway - 0.05 * shift,
    armLeftZ: 0.02 * sway,
    armRightZ: -0.02 * sway,
    bodyScale: 1 + 0.01 * breathe,
    eyeOpen: blink(t),
  });
}

/**
 * THINKING: an unmistakable pondering pose. The head tilts and pitches down,
 * the gaze holds then shifts, one hand rises forward toward the chest in short
 * bursts with real pauses between them, and the body occasionally turns toward
 * the monitor as if reviewing. The arm stays on its own side of the torso (the
 * single-segment rig cannot reach the head without clipping), so this reads as
 * a hand-to-chest ponder rather than literal chin contact.
 */
function thinkingPose(t: number): PopiPose {
  const chin = pulse(t, 7.3, 0.4, 0.8);
  const review = pulse(t, 11.7, 0.32, 4.2);
  const nod = Math.sin(t * 0.9);
  const gaze = (smoothNoise(t, 3.3, 2.0) - 0.5) * 0.9;
  const tilt = 0.16 + 0.05 * Math.sin(t * 0.53);

  return makePose({
    position: [0, BASE_Y + 0.014 * Math.sin(t * 1.1), 0],
    rotation: [0, 0, 0.03 * Math.sin(t * 0.9)],
    facing: 1.7 * review,
    headRotation: [
      -0.12 - 0.1 * chin + 0.05 * review + 0.03 * nod,
      gaze * (1 - 0.5 * chin) + 0.5 * review,
      tilt + 0.04 * Math.sin(t * 0.67),
    ],
    armLeft: -0.2 - 0.6 * chin + 0.05 * Math.sin(t * 0.9),
    armRight: -0.06 - 0.05 * Math.sin(t * 0.9),
    armLeftZ: 0.08 + 0.12 * chin,
    armRightZ: -0.08,
    bodyScale: 1 + 0.014 * Math.sin(t * 1.0),
    eyeOpen: blink(t),
  });
}

/**
 * WORKING: purposeful screen-oriented posture with alternating typing arms. The
 * two arms use different frequencies and noise-modulated amplitude so they
 * never loop in perfect lockstep, and the hands stay forward/down over the desk
 * rather than wobbling. No tool output or progress is implied.
 */
function workingPose(t: number): PopiPose {
  const typeLeft =
    Math.sin(t * 3.4) * (0.5 + 0.5 * smoothNoise(t, 2.1, 0.7));
  const typeRight =
    Math.sin(t * 3.4 + 2.1) *
    (0.5 + 0.5 * smoothNoise(t, 2.6, 2.3));
  const bob = Math.abs(Math.sin(t * 2.8));
  const scan = (smoothNoise(t, 3.1, 1.2) - 0.5) * 0.3;

  return makePose({
    position: [0, BASE_Y + 0.045 * bob, 0],
    rotation: [0.05, 0, 0.02 * Math.sin(t * 2.2)],
    facing: FACING_SCREEN,
    headRotation: [0.2 + 0.05 * Math.sin(t * 1.6), scan, 0],
    armLeft: -0.95 + 0.2 * typeLeft,
    armRight: -0.95 + 0.2 * typeRight,
    armLeftZ: 0.32,
    armRightZ: -0.32,
    bodyScale: 1 + 0.02 * Math.sin(t * 2.8),
    eyeOpen: blink(t),
  });
}

/**
 * USING_TOOL: focused, deliberate interaction. Fewer, slower presses than
 * WORKING (pulse-driven reaches) with the gaze fixed on the screen, so it is
 * visibly a different activity rather than more typing.
 */
function toolPose(t: number): PopiPose {
  const pressLeft = pulse(t, 3.4, 0.5, 0.3);
  const pressRight = pulse(t, 4.6, 0.45, 1.9);
  const cursor = (smoothNoise(t, 2.4, 0.5) - 0.5) * 0.5;

  return makePose({
    position: [0, BASE_Y + 0.01 * Math.sin(t * 2.0), 0],
    rotation: [0.06, 0, 0.02 * Math.sin(t * 3.0)],
    facing: FACING_SCREEN,
    headRotation: [0.24 + 0.05 * Math.sin(t * 1.5), cursor, 0.02],
    armLeft: -0.7 - 0.35 * pressLeft,
    armRight: -0.6 - 0.3 * pressRight,
    armLeftZ: 0.28,
    armRightZ: -0.28,
    bodyScale: 1 + 0.012 * Math.sin(t * 4.0),
    eyeOpen: blink(t),
  });
}

/** TERMINAL: urgent, faster keystrokes than WORKING, still screen-facing. */
function terminalPose(t: number): PopiPose {
  return makePose({
    position: [0, BASE_Y + Math.sin(t * 3) * 0.01, 0],
    rotation: [0.08, 0, 0],
    facing: FACING_SCREEN,
    headRotation: [
      0.22 + 0.04 * Math.sin(t * 5),
      Math.sin(t * 4) * 0.06,
      0,
    ],
    // Arms stay in the sagittal plane: a sideways offset would drag the
    // hanging hand through the torso when the swing passes arm == 0.
    armLeft: Math.sin(t * 16) * 0.5,
    armRight: Math.sin(t * 16 + Math.PI) * 0.5,
    bodyScale: 1 + Math.sin(t * 4) * 0.01,
    eyeOpen: blink(t),
  });
}

function errorPose(t: number): PopiPose {
  return makePose({
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
  });
}

function statusPose(status: AgentStatus, t: number): PopiPose {
  switch (status) {
    case "THINKING":
      return thinkingPose(t);

    case "USING_TOOL":
      return toolPose(t);

    case "WORKING":
      return workingPose(t);

    case "TERMINAL":
      return terminalPose(t);

    case "ERROR":
      return errorPose(t);

    case "IDLE":
    default:
      return idlePose(t);
  }
}

/* =========================================================
   PRESENCE POSES
========================================================= */

/**
 * Gateway reachable link is down but the browser still observes state: a
 * patient, restrained "waiting" idle that looks clearly different from doing
 * work. No screen-facing and no arm motion, so it cannot read as progress.
 */
function gatewayDownPose(t: number): PopiPose {
  return makePose({
    position: [0, BASE_Y + Math.sin(t * 1.1) * 0.02, 0],
    rotation: [0, Math.sin(t * 0.5) * 0.1, Math.sin(t * 1.1) * 0.03],
    facing: 0,
    headRotation: [-0.05, Math.sin(t * 0.5) * 0.35, 0.08],
    armLeft: 0.08 + Math.sin(t * 1.1) * 0.04,
    armRight: -0.08 - Math.sin(t * 1.1) * 0.04,
    bodyScale: 1 + Math.sin(t * 1.1) * 0.015,
    eyeOpen: blink(t, 4.6),
  });
}

/**
 * No browser observation at all: fully powered-down, no fabricated activity.
 */
function sseDownPose(): PopiPose {
  return makePose({
    headRotation: [0.4, 0, 0],
    eyeOpen: 0.05,
  });
}

/**
 * Reduced-motion resting pose: a single stable frame per presence/status with
 * eyes open, so no oscillation reaches the render loop.
 */
export function getPopiRestPose(
  status: AgentStatus,
  presence: PopiPresence = "online",
): PopiPose {
  if (presence === "sse-down") {
    return sseDownPose();
  }

  const facing =
    presence === "online" && isFacingScreen(status)
      ? FACING_SCREEN
      : 0;

  const headRotation: [number, number, number] =
    presence === "auth-error"
      ? [-0.05, 0, 0]
      : presence === "online" && isFacingScreen(status)
        ? [0.14, 0, 0]
        : [0.02, 0, 0];

  return makePose({ facing, headRotation });
}

export function getPopiPose(
  status: AgentStatus,
  t: number,
  options: PopiPoseOptions = {},
): PopiPose {
  const presence = options.presence ?? "online";

  if (options.reducedMotion) {
    return getPopiRestPose(status, presence);
  }

  switch (presence) {
    case "sse-down":
      return sseDownPose();

    case "gateway-down":
      return gatewayDownPose(t);

    case "auth-error":
      return errorPose(t);

    default:
      return statusPose(status, t);
  }
}

/* =========================================================
   TRANSITIONS
   Pose targets are blended per channel toward the previous frame's
   value, so switching status/presence never snaps. Damping is
   frame-rate independent (exponential in delta).
========================================================= */

export interface PoseDamping {
  position: number;
  rotation: number;
  facing: number;
  head: number;
  arm: number;
  bodyScale: number;
}

export const POSE_DAMPING: PoseDamping = {
  position: 10,
  rotation: 9,
  facing: 5,
  head: 12,
  arm: 13,
  bodyScale: 10,
};

export function dampScalar(
  current: number,
  target: number,
  lambda: number,
  delta: number,
): number {
  if (lambda <= 0 || delta <= 0) {
    return current;
  }

  const amount = 1 - Math.exp(-lambda * delta);

  return current + (target - current) * amount;
}

/** Damp along the shortest angular path, so PI turns never spin the long way. */
export function dampAngle(
  current: number,
  target: number,
  lambda: number,
  delta: number,
): number {
  const wrapped = ((target - current) % TWO_PI + TWO_PI) % TWO_PI;
  const shortest = wrapped > Math.PI ? wrapped - TWO_PI : wrapped;

  return dampScalar(current, current + shortest, lambda, delta);
}

/**
 * Blend `current` toward `target` in place and return the same object, so the
 * render loop allocates nothing extra. `eyeOpen` passes straight through so
 * blinks stay crisp instead of being smeared by damping.
 */
export function blendPose(
  current: PopiPose,
  target: PopiPose,
  delta: number,
  damping: PoseDamping = POSE_DAMPING,
): PopiPose {
  current.position[0] = dampScalar(
    current.position[0],
    target.position[0],
    damping.position,
    delta,
  );
  current.position[1] = dampScalar(
    current.position[1],
    target.position[1],
    damping.position,
    delta,
  );
  current.position[2] = dampScalar(
    current.position[2],
    target.position[2],
    damping.position,
    delta,
  );

  current.rotation[0] = dampScalar(
    current.rotation[0],
    target.rotation[0],
    damping.rotation,
    delta,
  );
  current.rotation[1] = dampScalar(
    current.rotation[1],
    target.rotation[1],
    damping.rotation,
    delta,
  );
  current.rotation[2] = dampScalar(
    current.rotation[2],
    target.rotation[2],
    damping.rotation,
    delta,
  );

  current.facing = dampAngle(
    current.facing,
    target.facing,
    damping.facing,
    delta,
  );

  current.headRotation[0] = dampScalar(
    current.headRotation[0],
    target.headRotation[0],
    damping.head,
    delta,
  );
  current.headRotation[1] = dampScalar(
    current.headRotation[1],
    target.headRotation[1],
    damping.head,
    delta,
  );
  current.headRotation[2] = dampScalar(
    current.headRotation[2],
    target.headRotation[2],
    damping.head,
    delta,
  );

  current.armLeft = dampScalar(
    current.armLeft,
    target.armLeft,
    damping.arm,
    delta,
  );
  current.armRight = dampScalar(
    current.armRight,
    target.armRight,
    damping.arm,
    delta,
  );
  current.armLeftZ = dampScalar(
    current.armLeftZ,
    target.armLeftZ,
    damping.arm,
    delta,
  );
  current.armRightZ = dampScalar(
    current.armRightZ,
    target.armRightZ,
    damping.arm,
    delta,
  );

  current.bodyScale = dampScalar(
    current.bodyScale,
    target.bodyScale,
    damping.bodyScale,
    delta,
  );

  current.eyeOpen = target.eyeOpen;

  return current;
}

/* =========================================================
   COLORS AND LIGHT
========================================================= */

export function getBodyColor(
  status: AgentStatus,
  presence: PopiPresence = "online",
) {
  if (presence === "sse-down") {
    return "#64748b";
  }

  if (presence === "gateway-down") {
    return "#94a3b8";
  }

  if (presence === "auth-error") {
    return "#ef4444";
  }

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

export function getScreenColor(
  status: AgentStatus,
  presence: PopiPresence = "online",
) {
  if (presence === "sse-down") {
    return "#1e293b";
  }

  if (presence === "gateway-down") {
    return "#475569";
  }

  if (presence === "auth-error") {
    return "#ef4444";
  }

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
  presence: PopiPresence = "online",
) {
  if (presence === "sse-down") {
    return 0.02;
  }

  if (presence === "gateway-down") {
    return 0.12 + Math.sin(t * 0.6) * 0.03;
  }

  if (presence === "auth-error") {
    return Math.sin(t * 12) > 0 ? 1.8 : 0.15;
  }

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
  presence: PopiPresence = "online",
) {
  if (presence === "sse-down") {
    return 0;
  }

  if (presence === "gateway-down") {
    return 0.4 + Math.sin(t * 0.8) * 0.1;
  }

  if (presence === "auth-error") {
    return Math.sin(t * 12) > 0 ? 8 : 1;
  }

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
  presence: PopiPresence = "online",
) {
  if (presence === "sse-down") {
    return "#334155";
  }

  if (presence === "gateway-down") {
    return "#64748b";
  }

  if (presence === "auth-error") {
    return "#ef4444";
  }

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
