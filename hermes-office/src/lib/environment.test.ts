import { describe, expect, it } from "vitest";
import {
  ROOM_LIGHT_GAIN,
  atmosphereBreath,
  isStaticAtmosphere,
  resolveAtmosphere,
  resolveRoomLighting,
  type AtmosphereMood,
} from "./environment";
import type { AgentStatus } from "./hermes/types";
import type { PopiPresence } from "./popi";

const ALL_STATUSES: AgentStatus[] = [
  "OFFLINE",
  "IDLE",
  "THINKING",
  "WORKING",
  "USING_TOOL",
  "TERMINAL",
  "ERROR",
];

const ALL_PRESENCES: PopiPresence[] = [
  "online",
  "sse-down",
  "gateway-down",
  "auth-error",
];

describe("resolveAtmosphere", () => {
  it("maps every real status to a defined mood with finite intensities", () => {
    for (const status of ALL_STATUSES) {
      const atmosphere = resolveAtmosphere(status, "online");

      expect(typeof atmosphere.mood).toBe("string");
      expect(atmosphere.screen).toMatch(/^#[0-9a-f]{6}$/i);

      for (const key of [
        "ambient",
        "hemisphere",
        "rim",
        "fill",
        "ceiling",
      ] as const) {
        expect(Number.isFinite(atmosphere[key])).toBe(true);
        expect(atmosphere[key]).toBeGreaterThan(0);
      }
    }
  });

  it("maps each working state to its own mood", () => {
    expect(resolveAtmosphere("IDLE").mood).toBe("calm");
    expect(resolveAtmosphere("THINKING").mood).toBe("focused");
    expect(resolveAtmosphere("WORKING").mood).toBe("busy");
    expect(resolveAtmosphere("USING_TOOL").mood).toBe("tool");
    expect(resolveAtmosphere("TERMINAL").mood).toBe("terminal");
    expect(resolveAtmosphere("ERROR").mood).toBe("critical");
    expect(resolveAtmosphere("OFFLINE").mood).toBe("dormant");
  });

  it("brightens the structural lights for active states", () => {
    expect(resolveAtmosphere("WORKING").rim).toBeGreaterThan(
      resolveAtmosphere("IDLE").rim,
    );
    expect(resolveAtmosphere("THINKING").rim).toBeGreaterThan(
      resolveAtmosphere("IDLE").rim,
    );
    expect(resolveAtmosphere("USING_TOOL").rim).toBeGreaterThan(
      resolveAtmosphere("IDLE").rim,
    );
    expect(resolveAtmosphere("TERMINAL").rim).toBeGreaterThan(
      resolveAtmosphere("IDLE").rim,
    );
  });

  it("dims the room instead of faking activity when a link is down", () => {
    const down = resolveAtmosphere("WORKING", "sse-down");
    expect(down.mood).toBe("down");
    expect(down.rim).toBeLessThan(resolveAtmosphere("WORKING").rim);
    expect(down.scroll).toBe(0);
  });

  it("treats a rejected token as critical even from a calm status", () => {
    expect(resolveAtmosphere("IDLE", "auth-error").mood).toBe("critical");
    expect(resolveAtmosphere("THINKING", "gateway-down").mood).toBe("down");
  });

  it("never exceeds the model's sane upper bounds", () => {
    for (const presence of ALL_PRESENCES) {
      for (const status of ALL_STATUSES) {
        const atmosphere = resolveAtmosphere(status, presence);

        expect(atmosphere.ambient).toBeLessThanOrEqual(0.45);
        expect(atmosphere.rim).toBeLessThanOrEqual(1.7);
        expect(atmosphere.ceiling).toBeLessThanOrEqual(0.85);
        expect(atmosphere.scroll).toBeLessThanOrEqual(1.5);
      }
    }
  });
});

describe("atmosphereBreath", () => {
  it("is bounded around 1 for every mood", () => {
    const moods: AtmosphereMood[] = [
      "calm",
      "focused",
      "busy",
      "tool",
      "terminal",
      "critical",
      "dormant",
      "down",
    ];

    for (let t = 0; t < 40; t += 0.37) {
      for (const mood of moods) {
        const breath = atmosphereBreath(mood, t);

        expect(Number.isFinite(breath)).toBe(true);
        expect(breath).toBeGreaterThan(0.7);
        expect(breath).toBeLessThan(1.3);
      }
    }
  });

  it("swings harder on critical than on calm", () => {
    let calmSwing = 0;
    let criticalSwing = 0;
    let previousCalm = atmosphereBreath("calm", 0);
    let previousCritical = atmosphereBreath("critical", 0);

    for (let t = 0.05; t < 30; t += 0.05) {
      const calm = atmosphereBreath("calm", t);
      const critical = atmosphereBreath("critical", t);

      calmSwing += Math.abs(calm - previousCalm);
      criticalSwing += Math.abs(critical - previousCritical);
      previousCalm = calm;
      previousCritical = critical;
    }

    expect(criticalSwing).toBeGreaterThan(calmSwing * 2);
  });
});

describe("isStaticAtmosphere", () => {
  it("only freezes the down mood", () => {
    expect(isStaticAtmosphere("down")).toBe(true);
    expect(isStaticAtmosphere("calm")).toBe(false);
    expect(isStaticAtmosphere("busy")).toBe(false);
  });
});

describe("resolveRoomLighting", () => {
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

  it("turns every mood into concrete, positive light values", () => {
    for (const status of STATUSES) {
      for (const presence of PRESENCES) {
        const lighting = resolveRoomLighting(resolveAtmosphere(status, presence));

        for (const key of [
          "ambient",
          "hemisphere",
          "key",
          "coolFill",
          "rim",
          "fill",
          "ceilingPoint",
        ] as const) {
          expect(Number.isFinite(lighting[key])).toBe(true);
          expect(lighting[key]).toBeGreaterThan(0);
        }
      }
    }
  });

  it("keeps the room readable even in the dimmest mood", () => {
    // The whole point of the gain stage: no mood may fall back to near-black.
    const down = resolveRoomLighting(resolveAtmosphere("WORKING", "sse-down"));
    const calm = resolveRoomLighting(resolveAtmosphere("IDLE", "online"));

    expect(down.ambient).toBeGreaterThan(0.4);
    expect(calm.ambient).toBeGreaterThan(0.7);
    expect(calm.key).toBeGreaterThan(calm.ambient);
    expect(calm.ceilingPoint).toBeGreaterThan(0.9);
  });

  it("brightens the key and rim lights for active states", () => {
    const idle = resolveRoomLighting(resolveAtmosphere("IDLE"));
    const busy = resolveRoomLighting(resolveAtmosphere("WORKING"));

    expect(busy.key).toBeGreaterThan(idle.key);
    expect(busy.rim).toBeGreaterThan(idle.rim);
    expect(busy.ceilingPoint).toBeGreaterThan(idle.ceilingPoint);
  });

  it("stays within sane render bounds for every mood", () => {
    for (const status of STATUSES) {
      for (const presence of PRESENCES) {
        const lighting = resolveRoomLighting(
          resolveAtmosphere(status, presence),
        );

        expect(lighting.ambient).toBeLessThanOrEqual(2);
        expect(lighting.key).toBeLessThanOrEqual(3.5);
        expect(lighting.rim).toBeLessThanOrEqual(6);
        expect(ROOM_LIGHT_GAIN.ambient).toBeGreaterThan(1);
      }
    }
  });
});
