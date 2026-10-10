/**
 * Room atmosphere model.
 *
 * The physical room, its lights and its monitor content are all derived from
 * real, already-existing application state — `AgentStatus` and
 * `PopiPresence` — through this pure module. Nothing here invents telemetry:
 * every value is a function of a state the Gateway actually reports, and when
 * that state is unavailable the room dims instead of pretending.
 *
 * Keeping the model Three.js-free means the state -> light/content mapping is
 * unit-testable without a renderer.
 */

import type { AgentStatus } from "./hermes/types";
import type { PopiPresence } from "./popi";
import { getScreenColor } from "./popi";

export type AtmosphereMood =
  | "calm"
  | "focused"
  | "busy"
  | "tool"
  | "terminal"
  | "critical"
  | "dormant"
  | "down";

export interface RoomAtmosphere {
  mood: AtmosphereMood;
  /** Base fill light — calm rooms stay dimmer. */
  ambient: number;
  hemisphere: number;
  /** Cyan structural rim light along the back wall. */
  rim: number;
  /** Violet bounce from the opposite corner. */
  fill: number;
  /** Emissive strength of the ceiling light strips. */
  ceiling: number;
  /** Monitor content tint (reuses the single source of truth in popi.ts). */
  screen: string;
  /** How fast monitor content scrolls; 0 when it should hold still. */
  scroll: number;
}

const ATMOSPHERE: Record<AtmosphereMood, Omit<RoomAtmosphere, "screen">> = {
  calm: {
    mood: "calm",
    ambient: 0.3,
    hemisphere: 0.5,
    rim: 0.7,
    fill: 0.35,
    ceiling: 0.35,
    scroll: 0,
  },
  focused: {
    mood: "focused",
    ambient: 0.32,
    hemisphere: 0.6,
    rim: 1.0,
    fill: 0.6,
    ceiling: 0.45,
    scroll: 0.6,
  },
  busy: {
    mood: "busy",
    ambient: 0.36,
    hemisphere: 0.68,
    rim: 1.4,
    fill: 0.8,
    ceiling: 0.6,
    scroll: 1.0,
  },
  tool: {
    mood: "tool",
    ambient: 0.36,
    hemisphere: 0.66,
    rim: 1.3,
    fill: 0.75,
    ceiling: 0.58,
    scroll: 1.3,
  },
  terminal: {
    mood: "terminal",
    ambient: 0.34,
    hemisphere: 0.64,
    rim: 1.25,
    fill: 0.7,
    ceiling: 0.55,
    scroll: 1.5,
  },
  critical: {
    mood: "critical",
    ambient: 0.4,
    hemisphere: 0.7,
    rim: 1.6,
    fill: 0.9,
    ceiling: 0.8,
    scroll: 0.9,
  },
  dormant: {
    mood: "dormant",
    ambient: 0.22,
    hemisphere: 0.36,
    rim: 0.4,
    fill: 0.25,
    ceiling: 0.2,
    scroll: 0.5,
  },
  down: {
    mood: "down",
    ambient: 0.16,
    hemisphere: 0.24,
    rim: 0.25,
    fill: 0.15,
    ceiling: 0.12,
    scroll: 0,
  },
};

function moodFor(
  status: AgentStatus,
  presence: PopiPresence,
): AtmosphereMood {
  if (presence === "sse-down" || presence === "gateway-down") {
    return "down";
  }

  if (presence === "auth-error") {
    return "critical";
  }

  switch (status) {
    case "WORKING":
      return "busy";
    case "USING_TOOL":
      return "tool";
    case "THINKING":
      return "focused";
    case "TERMINAL":
      return "terminal";
    case "ERROR":
      return "critical";
    case "IDLE":
      return "calm";
    default:
      return "dormant";
  }
}

/** Static atmosphere for a status/presence pair. */
export function resolveAtmosphere(
  status: AgentStatus,
  presence: PopiPresence = "online",
): RoomAtmosphere {
  const mood = moodFor(status, presence);
  const base = ATMOSPHERE[mood];

  return { ...base, screen: getScreenColor(status, presence) };
}

/**
 * Slow breath applied to the structural lights so an idle room is never
 * perfectly static. Returns a multiplier around 1.
 */
export function atmosphereBreath(mood: AtmosphereMood, t: number): number {
  switch (mood) {
    case "busy":
      return 1 + Math.sin(t * 3.4) * 0.1;
    case "tool":
      return 1 + Math.sin(t * 5.2) * 0.09;
    case "focused":
      return 1 + Math.sin(t * 1.8) * 0.07;
    case "critical":
      return 1 + Math.sin(t * 9) * 0.22;
    case "terminal":
      return 1 + Math.sin(t * 4.6) * 0.06;
    default:
      return 1 + Math.sin(t * 0.9) * 0.03;
  }
}

/** True when a mood is intentionally static (reduced motion / unknown state). */
export function isStaticAtmosphere(mood: AtmosphereMood): boolean {
  return mood === "down";
}
