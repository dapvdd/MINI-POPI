/**
 * Popi's behaviour state machine.
 *
 * The machine is deliberately small and pure: it is driven only by state the
 * application already owns (`AgentStatus`, `PopiPresence`, the real turn
 * sequence) plus a monotonic frame delta. There are no timers that can leak, no
 * per-frame randomness, and no React involvement — it owns locomotion and
 * activity selection, and hands a single pose target to the render component.
 *
 * Autonomous activities are picked deterministically from an integer counter
 * with cooldowns, so the same seed produces the same sequence and a unit test
 * can prove the character never repeats, locks up or escapes her bounds.
 */

import type { AgentStatus } from "./hermes/types";
import {
  POPI_HOME_POSITION,
  headingToward,
  isPathClear,
  isWanderPointSafe,
  pickWanderTarget,
  POPI_WALK_SPEED,
  steerDirection,
} from "./popi-navigation";
import {
  POPI_SEAT_ANCHOR,
  POPI_STAND_POSE_POSITION,
  dampAngle as dampFacing,
  type PopiActivity,
  type PopiBehavior,
  type PopiPresence,
} from "./popi";

/** Behaviour names and activity names live with the pose model in `popi.ts`. */
export type { PopiActivity, PopiBehavior } from "./popi";

export interface PopiBehaviorContext {
  status: AgentStatus;
  presence: PopiPresence;
  /** Real completion counter; a new value is what triggers the celebration. */
  turnSeq: number;
}

/** Seconds each autonomous activity lasts before another one is picked. */
export const ACTIVITY_DURATIONS: Record<PopiActivity, number> = {
  wander: 9.5,
  observe: 6.5,
  wave: 3.6,
  hum: 8,
  rest: 15,
};

/** Seconds before the same activity may run again. */
export const ACTIVITY_COOLDOWN = 12;

/**
 * Weighted, deterministic bag. `wander` and `rest` are weighted up because a
 * companion that is always doing something reads as a loop, not as company.
 */
const ACTIVITY_BAG: readonly PopiActivity[] = [
  "wander",
  "wander",
  "observe",
  "rest",
  "wave",
  "hum",
  "rest",
];

/** Celebration length after a real completion, in seconds. */
export const CELEBRATION_DURATION = 4.2;

/** Longest frame delta fed to the machine, so a hidden tab cannot jump. */
export const MAX_BEHAVIOR_STEP = 0.25;

/** How long a blocked wander waits before giving the activity up. */
export const WANDER_STUCK_TIMEOUT = 1.5;

const ACTIVITY_KEYS: readonly PopiActivity[] = [
  "wander",
  "observe",
  "wave",
  "hum",
  "rest",
];

function hash01(seed: number): number {
  const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453;

  return value - Math.floor(value);
}

/**
 * Map the real transport/agent state onto a behaviour.
 *
 * Presence wins over status: with nothing to observe Popi must never look like
 * she is working, so a down link forces a subdued behaviour regardless of the
 * last reported turn status.
 */
export function resolvePopiBehavior(
  status: AgentStatus,
  presence: PopiPresence,
): PopiBehavior {
  if (presence === "sse-down") {
    return "offline";
  }

  if (presence === "auth-error") {
    return "error";
  }

  if (presence === "gateway-down") {
    return "resting";
  }

  switch (status) {
    case "THINKING":
      return "thinking";
    case "WORKING":
      return "working";
    case "USING_TOOL":
      return "tool-use";
    case "TERMINAL":
      return "terminal";
    case "ERROR":
      return "error";
    case "IDLE":
      return "idle";
    default:
      return "resting";
  }
}

/** Everything the render layer needs to know about a behaviour. */
export interface PopiBehaviorTraits {
  behavior: PopiBehavior;
  /** Sits on the chair at the workstation. */
  seated: boolean;
  /** Runs the autonomous activity scheduler. */
  autonomous: boolean;
  /** Floating violet thought symbols. */
  thoughtSymbols: boolean;
  /** Cyan energy aura / motion trails. */
  aura: boolean;
  /** Restrained digital particles. */
  particles: boolean;
  /** Hacker visor. */
  visor: boolean;
  /** Brief celebration sparkles. */
  celebrate: boolean;
  /** Hum cue while humming. */
  humCue: boolean;
  /** Keyboard and desk feedback. */
  typing: boolean;
}

export function getPopiBehaviorTraits(
  behavior: PopiBehavior,
  activity: PopiActivity = "observe",
): PopiBehaviorTraits {
  const traits: PopiBehaviorTraits = {
    behavior,
    seated: false,
    autonomous: false,
    thoughtSymbols: false,
    aura: false,
    particles: false,
    visor: false,
    celebrate: false,
    humCue: false,
    typing: false,
  };

  switch (behavior) {
    case "thinking":
      traits.seated = true;
      traits.thoughtSymbols = true;
      break;

    case "working":
      traits.seated = true;
      traits.aura = true;
      traits.typing = true;
      break;

    case "tool-use":
      traits.seated = true;
      traits.aura = true;
      traits.typing = true;
      break;

    case "terminal":
      traits.seated = true;
      traits.aura = true;
      traits.particles = true;
      traits.visor = true;
      traits.typing = true;
      break;

    case "celebrating":
      traits.celebrate = true;
      break;

    case "idle":
      traits.autonomous = true;
      traits.humCue = activity === "hum";
      traits.seated = activity === "rest";
      break;

    case "resting":
    case "offline":
    case "error":
    default:
      break;
  }

  return traits;
}

export interface PopiRuntime {
  /** Monotonic machine time in seconds; the only clock the machine reads. */
  elapsed: number;
  behavior: PopiBehavior;
  activity: PopiActivity;
  activityElapsed: number;
  activityCount: number;
  cooldown: Record<PopiActivity, number>;
  /** Logical position/facing. Stand-in for the rendered root transform. */
  x: number;
  z: number;
  facing: number;
  targetX: number;
  targetZ: number;
  hasTarget: boolean;
  blockedFor: number;
  /** Seconds of celebration left after a real completion. */
  celebration: number;
  lastTurnSeq: number;
  /** Set by the wander step when the activity should end early. */
  advance: boolean;
}

export function createPopiRuntime(): PopiRuntime {
  return {
    elapsed: 0,
    behavior: "idle",
    activity: "observe",
    activityElapsed: 0,
    activityCount: 0,
    cooldown: { wander: 0, observe: 0, wave: 0, hum: 0, rest: 0 },
    x: POPI_HOME_POSITION[0],
    z: POPI_HOME_POSITION[2],
    facing: 0,
    targetX: POPI_HOME_POSITION[0],
    targetZ: POPI_HOME_POSITION[2],
    hasTarget: false,
    blockedFor: 0,
    celebration: 0,
    lastTurnSeq: 0,
    advance: false,
  };
}

/** Neutral activity for behaviours that do not run the scheduler. */
function activityForBehavior(behavior: PopiBehavior): PopiActivity {
  switch (behavior) {
    case "thinking":
    case "working":
    case "tool-use":
    case "terminal":
    case "error":
      return "rest";
    default:
      return "observe";
  }
}

function anchorFor(behavior: PopiBehavior): { x: number; z: number } {
  if (
    behavior === "thinking" ||
    behavior === "working" ||
    behavior === "tool-use" ||
    behavior === "terminal"
  ) {
    return { x: POPI_SEAT_ANCHOR[0], z: POPI_SEAT_ANCHOR[2] };
  }

  return { x: POPI_STAND_POSE_POSITION[0], z: POPI_STAND_POSE_POSITION[2] };
}

/**
 * Choose the next autonomous activity.
 *
 * Deterministic from `index`, never the activity that just ran, and always one
 * whose cooldown has lapsed. The fallback is exhaustive, so the scheduler can
 * never return an undefined activity or deadlock on cooldowns.
 */
export function selectNextActivity(
  index: number,
  cooldown: Record<PopiActivity, number>,
  current: PopiActivity,
): PopiActivity {
  for (let attempt = 0; attempt < ACTIVITY_BAG.length; attempt += 1) {
    const pick = ACTIVITY_BAG[Math.floor(hash01(index * 1.37 + attempt * 0.79) * ACTIVITY_BAG.length) % ACTIVITY_BAG.length];

    if (pick !== current && cooldown[pick] <= 0) {
      return pick;
    }
  }

  for (const candidate of ACTIVITY_KEYS) {
    if (candidate !== current && cooldown[candidate] <= 0) {
      return candidate;
    }
  }

  return current === "observe" ? "wander" : "observe";
}

function enterBehavior(runtime: PopiRuntime, behavior: PopiBehavior): void {
  runtime.behavior = behavior;
  runtime.activity = activityForBehavior(behavior);
  runtime.activityElapsed = 0;
  runtime.activityCount += 1;
  runtime.hasTarget = false;
  runtime.blockedFor = 0;
  runtime.advance = false;
}

function concludeActivity(runtime: PopiRuntime): void {
  const previous = runtime.activity;

  runtime.cooldown[previous] = ACTIVITY_COOLDOWN;
  runtime.activityCount += 1;
  runtime.activity = selectNextActivity(
    runtime.activityCount,
    runtime.cooldown,
    previous,
  );
  runtime.activityElapsed = 0;
  runtime.blockedFor = 0;
  runtime.advance = false;
  runtime.hasTarget = false;
}

/** One wander step: pick a target, steer around furniture, integrate motion. */
function stepWander(runtime: PopiRuntime, delta: number): void {
  const remaining = Math.hypot(
    runtime.targetX - runtime.x,
    runtime.targetZ - runtime.z,
  );

  // Reaching a spot keeps the stroll going: a fresh target inside the same
  // activity reads as walking around, not as teleporting to a new pose.
  if (!runtime.hasTarget || remaining < 0.5) {
    const target = pickWanderTarget(runtime.activityCount * 31 + 7, {
      x: runtime.x,
      z: runtime.z,
    });

    runtime.targetX = target.x;
    runtime.targetZ = target.z;
    runtime.hasTarget = true;
    runtime.blockedFor = 0;
    return;
  }

  const desired = headingToward(
    runtime.x,
    runtime.z,
    runtime.targetX,
    runtime.targetZ,
  );

  const heading = steerDirection(runtime.x, runtime.z, desired, {
    targetX: runtime.targetX,
    targetZ: runtime.targetZ,
  });

  // Turning is damped, so a full stop never snaps around to a new heading.
  runtime.facing = dampFacing(runtime.facing, heading, 6, delta);

  const probeX = runtime.x + Math.sin(runtime.facing) * 0.4;
  const probeZ = runtime.z + Math.cos(runtime.facing) * 0.4;

  runtime.blockedFor = isPathClear(runtime.x, runtime.z, probeX, probeZ)
    ? 0
    : runtime.blockedFor + delta;

  if (runtime.blockedFor > WANDER_STUCK_TIMEOUT) {
    runtime.advance = true;
    return;
  }

  const nextX = runtime.x + Math.sin(runtime.facing) * POPI_WALK_SPEED * delta;
  const nextZ = runtime.z + Math.cos(runtime.facing) * POPI_WALK_SPEED * delta;

  if (isWanderPointSafe(nextX, nextZ)) {
    runtime.x = nextX;
    runtime.z = nextZ;
  } else {
    runtime.blockedFor += delta;
  }
}

/** Ease the logical position toward the anchor of a non-walking behaviour. */
function easeToAnchor(
  runtime: PopiRuntime,
  behavior: PopiBehavior,
  delta: number,
): void {
  const anchor = anchorFor(behavior);
  const amount = 1 - Math.exp(-3.5 * delta);

  runtime.x += (anchor.x - runtime.x) * amount;
  runtime.z += (anchor.z - runtime.z) * amount;
}

/**
 * Advance the machine by one frame delta. Mutates `runtime` in place and
 * returns it, so the render loop never allocates and never touches React.
 */
export function stepPopiRuntime(
  runtime: PopiRuntime,
  delta: number,
  context: PopiBehaviorContext,
): PopiRuntime {
  const step = Math.min(Math.max(delta, 0), MAX_BEHAVIOR_STEP);

  runtime.elapsed += step;

  for (const key of ACTIVITY_KEYS) {
    runtime.cooldown[key] = Math.max(0, runtime.cooldown[key] - step);
  }

  const base = resolvePopiBehavior(context.status, context.presence);

  // A new turn sequence is a real completion event: celebrate once, briefly.
  if (context.turnSeq > runtime.lastTurnSeq) {
    runtime.lastTurnSeq = context.turnSeq;
    runtime.celebration = CELEBRATION_DURATION;
  }

  // Any real work state cancels the celebration immediately; it only ever
  // lives on top of an idle agent.
  runtime.celebration =
    base === "idle"
      ? Math.max(0, runtime.celebration - step)
      : 0;

  const behavior: PopiBehavior =
    base === "idle" && runtime.celebration > 0 ? "celebrating" : base;

  if (behavior !== runtime.behavior) {
    enterBehavior(runtime, behavior);
  }

  // `activityElapsed` doubles as "seconds inside the current behaviour", which
  // is the clock the one-shot pose envelopes (waving, the hop) are shaped by.
  runtime.activityElapsed += step;

  if (behavior === "idle") {
    if (runtime.activity === "wander") {
      stepWander(runtime, step);
    } else {
      easeToAnchor(runtime, behavior, step);
    }

    if (
      runtime.advance ||
      runtime.activityElapsed >= ACTIVITY_DURATIONS[runtime.activity]
    ) {
      concludeActivity(runtime);
    }
  } else {
    easeToAnchor(runtime, behavior, step);
  }

  return runtime;
}

/* =========================================================
   VISOR
   A terminal-like state is only ever entered from a tool the
   Gateway actually reported (see `mapEventToState`), so this
   is evidence-driven rather than assumed. The mode is still
   user-controllable, and `off` removes the effect entirely.
   ========================================================= */

export type VisorMode = "auto" | "off";

export function resolveVisor(
  behavior: PopiBehavior,
  mode: VisorMode = "auto",
): boolean {
  if (mode === "off") {
    return false;
  }

  return behavior === "terminal";
}

/**
 * Per-frame view of the machine, published through a ref so the effect layer
 * and the DOM anchor can read it without a React render.
 */
export interface PopiLiveState {
  behavior: PopiBehavior;
  activity: PopiActivity;
  /** Scene clock. */
  t: number;
  /** Seconds inside the current behaviour. */
  phase: number;
}
