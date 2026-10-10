import { describe, expect, it } from "vitest";
import { OFFICE_LAYOUT, POPI_AGENT_OFFSET } from "./office";
import {
  POPI_BODY_RADIUS,
  POPI_OBSTACLES,
  POPI_WALK_SPEED,
  POPI_WANDER_LIMITS,
  headingToward,
  inflateBox,
  isPathClear,
  isPointInside,
  isWanderPointSafe,
  isWithinWanderLimits,
  pickWanderTarget,
  segmentIntersectsBox,
  steerDirection,
  type NavBox,
} from "./popi-navigation";

const SEEDS = Array.from({ length: 240 }, (_, index) => index * 7 + 1);

describe("wander bounds", () => {
  it("keeps every obstacle inside the room's walls", () => {
    const { leftWallX, rightWallX, backWallZ } = OFFICE_LAYOUT;
    const floorFarZ = OFFICE_LAYOUT.floor.center[2] + OFFICE_LAYOUT.floor.depth / 2;

    for (const box of POPI_OBSTACLES) {
      // Boxes are local; put them back into world space before comparing.
      expect(box.minX).toBeGreaterThanOrEqual(leftWallX);
      expect(box.maxX).toBeLessThanOrEqual(rightWallX);
      expect(box.minZ + POPI_AGENT_OFFSET[2]).toBeGreaterThanOrEqual(backWallZ);
      expect(box.maxZ + POPI_AGENT_OFFSET[2]).toBeLessThanOrEqual(floorFarZ);
    }
  });

  it("places the roamable area inside the room", () => {
    expect(POPI_WANDER_LIMITS.minX).toBeGreaterThan(OFFICE_LAYOUT.leftWallX);
    expect(POPI_WANDER_LIMITS.maxX).toBeLessThan(OFFICE_LAYOUT.rightWallX);
    expect(POPI_WANDER_LIMITS.minZ + POPI_AGENT_OFFSET[2]).toBeGreaterThan(
      OFFICE_LAYOUT.backWallZ,
    );
  });

  it("rejects points outside the limits", () => {
    expect(isWithinWanderLimits(POPI_WANDER_LIMITS.minX - 0.01, 0)).toBe(false);
    expect(isWithinWanderLimits(POPI_WANDER_LIMITS.maxX + 0.01, 0)).toBe(false);
    expect(isWithinWanderLimits(0, POPI_WANDER_LIMITS.minZ - 0.01)).toBe(false);
    expect(isWithinWanderLimits(0, POPI_WANDER_LIMITS.maxZ + 0.01)).toBe(false);
  });

  it("names the furniture she has to walk around", () => {
    const labels = POPI_OBSTACLES.map((box) => box.label);

    expect(labels).toContain("popi-desk");
    expect(labels).toContain("popi-chair");
    expect(labels).toContain("server-rack");
    expect(labels.filter((label) => label.startsWith("worker-")).length).toBe(
      10,
    );
  });
});

describe("isWanderPointSafe", () => {
  it("refuses the inside of every obstacle", () => {
    for (const box of POPI_OBSTACLES) {
      const x = (box.minX + box.maxX) / 2;
      const z = (box.minZ + box.maxZ) / 2;

      expect(isWanderPointSafe(x, z)).toBe(false);
    }
  });

  it("accepts open floor with body clearance", () => {
    expect(isWanderPointSafe(0.2, 2.4)).toBe(true);
    expect(isWanderPointSafe(1.6, 3.6)).toBe(true);
    expect(isWanderPointSafe(-2.2, 4.2)).toBe(true);
  });

  it("needs clearance to actually clear furniture", () => {
    const desk = POPI_OBSTACLES.find((box) => box.label === "popi-desk");

    expect(desk).toBeDefined();

    if (!desk) return;

    // Just outside the desk box but still inside its inflation.
    expect(isWanderPointSafe(desk.maxX + 0.1, desk.maxZ, 0.5)).toBe(false);
    // Clear of the inflation...
    expect(isWanderPointSafe(desk.maxX + 0.6, desk.maxZ, 0.5)).toBe(true);
    // ...but not clear of a larger body clearance.
    expect(
      isWanderPointSafe(desk.maxX + 0.25, desk.maxZ, POPI_BODY_RADIUS),
    ).toBe(false);
  });
});

describe("segmentIntersectsBox", () => {
  it("detects a crossing", () => {
    expect(
      segmentIntersectsBox(
        { label: "b", minX: -1, maxX: 1, minZ: -1, maxZ: 1, pad: 0 },
        -2,
        0,
        2,
        0,
      ),
    ).toBe(true);
  });

  it("passes a miss", () => {
    expect(
      segmentIntersectsBox(
        { label: "b", minX: -1, maxX: 1, minZ: -1, maxZ: 1, pad: 0 },
        -2,
        3,
        2,
        3,
      ),
    ).toBe(false);
  });

  it("treats a segment entirely outside with a degenerate axis as a miss", () => {
    expect(
      segmentIntersectsBox(
        { label: "b", minX: -1, maxX: 1, minZ: -1, maxZ: 1, pad: 0 },
        -2,
        -2,
        -2,
        0,
      ),
    ).toBe(false);
  });
});

describe("path planning", () => {
  it("blocks a straight walk through Popi's own desk", () => {
    expect(isPathClear(0.2, 2.4, 0.2, -0.6)).toBe(false);
  });

  it("allows a walk that stays clear of furniture", () => {
    expect(isPathClear(0.2, 2.4, 0.2, 3.6)).toBe(true);
  });

  it("still refuses a destination inside furniture", () => {
    expect(isPathClear(0.2, 2.4, 0.2, -1.2)).toBe(false);
  });
});

describe("steerDirection", () => {
  it("keeps a desired heading that is already walkable", () => {
    expect(steerDirection(0.2, 2.4, 0)).toBeCloseTo(0, 6);
  });

  it("nudges around an obstacle instead of driving into it", () => {
    // Standing next to a worker desk, heading straight at it: the returned
    // heading must clear it on a 0.85 probe.
    const heading = steerDirection(3.4, -1.5, Math.PI);

    expect(Math.abs(heading - Math.PI)).toBeGreaterThan(0);

    const probeX = 3.4 + Math.sin(heading) * 0.85;
    const probeZ = -1.5 + Math.cos(heading) * 0.85;

    expect(isPathClear(3.4, -1.5, probeX, probeZ)).toBe(true);
  });

  it("still returns a finite heading when boxed in entirely", () => {
    // An absurd clearance leaves no usable direction; steering must answer with
    // a number rather than something the renderer cannot use.
    const heading = steerDirection(0, 2.4, 0, { lookahead: 0.85, pad: 3 });

    expect(Number.isFinite(heading)).toBe(true);
  });

  it("uses the character's facing convention", () => {
    // facing 0 walks toward local +z, facing PI/2 toward local +x.
    expect(headingToward(0, 0, 0, 3)).toBeCloseTo(0, 6);
    expect(headingToward(0, 0, 3, 0)).toBeCloseTo(Math.PI / 2, 6);
    expect(headingToward(0, 0, 0, -3)).toBeCloseTo(Math.PI, 6);
  });
});

describe("pickWanderTarget", () => {
  it("always returns a walkable, in-bounds point for any seed", () => {
    for (const seed of SEEDS) {
      const target = pickWanderTarget(seed);

      expect(isWithinWanderLimits(target.x, target.z)).toBe(true);
      expect(isWanderPointSafe(target.x, target.z)).toBe(true);
    }
  });

  it("is deterministic", () => {
    expect(pickWanderTarget(42)).toEqual(pickWanderTarget(42));
  });

  it("does not pick a point on top of itself", () => {
    for (const seed of SEEDS.slice(0, 40)) {
      const from = { x: 2.6, z: 3.4 };
      const target = pickWanderTarget(seed, from);

      expect(Math.hypot(target.x - from.x, target.z - from.z)).toBeGreaterThan(
        POPI_BODY_RADIUS * 2,
      );
    }
  });

  it("moves the character at a sane walking speed", () => {
    expect(POPI_WALK_SPEED).toBeGreaterThan(0.2);
    expect(POPI_WALK_SPEED).toBeLessThan(2);
  });
});

describe("inflateBox", () => {
  it("pads every side without moving the centre", () => {
    const box: NavBox = {
      label: "b",
      minX: 0,
      maxX: 1,
      minZ: 0,
      maxZ: 1,
      pad: 0,
    };

    expect(inflateBox(box, 0.25)).toEqual({
      label: "b",
      minX: -0.25,
      maxX: 1.25,
      minZ: -0.25,
      maxZ: 1.25,
      pad: 0.25,
    });

    // Without an override, the footprint's own clearance is used.
    expect(inflateBox(box)).toEqual({ ...box, pad: 0 });
  });

  it("keeps isPointInside consistent with the padded box", () => {
    const box: NavBox = {
      label: "b",
      minX: 0,
      maxX: 1,
      minZ: 0,
      maxZ: 1,
      pad: 0,
    };

    expect(isPointInside(inflateBox(box, 0.2), -0.1, 0.5)).toBe(true);
    expect(isPointInside(box, -0.1, 0.5)).toBe(false);
  });
});
