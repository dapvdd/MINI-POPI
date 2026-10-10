/**
 * Wander navigation for Popi.
 *
 * Everything here is pure geometry in the character's own local frame — the
 * frame of her workstation mount anchor — so the office layout only has to be
 * converted once. No Three.js, no React, no randomness: a target is derived
 * from an integer seed, and steering samples a fixed set of candidate angles,
 * so the exact same wander behaviour is reproducible in a unit test.
 *
 * Clearance is per footprint rather than global: desks and the rack are tall
 * enough to need a full body radius, while her own shallow task chair only
 * needs to keep her feet clear of it. Popi stands directly in front of that
 * chair — a chair you stand in front of is not an obstacle — so treating it
 * like a desk would trap her at her own workstation.
 */

import {
  MAX_WORKER_WORKSTATIONS,
  OFFICE_LAYOUT,
  POPI_AGENT_OFFSET,
  POPI_CHAIR_POSITION,
  POPI_DESK_BOUNDS,
  workerWorkstationSlot,
  type Vec3,
} from "./office";

/** Footprint with the air kept clear around it, in the character's frame. */
export interface NavBox {
  label: string;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  /** Air kept between Popi and this footprint. */
  pad: number;
}

/** Default clearance: roughly half the character's body width. */
export const POPI_BODY_RADIUS = 0.38;

/** Horizontal cruise speed, world units per second. */
export const POPI_WALK_SPEED = 0.92;

/** Steer lookahead: far enough to react, short enough to hug furniture. */
export const POPI_LOOKAHEAD = 0.85;

const ANCHOR_X = POPI_AGENT_OFFSET[0];
const ANCHOR_Z = POPI_AGENT_OFFSET[2];

function localBox(
  label: string,
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
  pad: number = POPI_BODY_RADIUS,
): NavBox {
  return {
    label,
    minX: minX - ANCHOR_X,
    maxX: maxX - ANCHOR_X,
    minZ: minZ - ANCHOR_Z,
    maxZ: maxZ - ANCHOR_Z,
    pad,
  };
}

function workerDeskBoxes(): NavBox[] {
  const boxes: NavBox[] = [];

  for (let index = 0; index < MAX_WORKER_WORKSTATIONS; index += 1) {
    const slot = workerWorkstationSlot(index);

    if (!slot) {
      continue;
    }

    const [x, , z] = slot.position;

    boxes.push(localBox(`worker-${slot.id}`, x - 1.2, x + 1.2, z - 0.6, z + 0.6));
  }

  return boxes;
}

const popiDeskBox = localBox(
  "popi-desk",
  POPI_DESK_BOUNDS.minX,
  POPI_DESK_BOUNDS.maxX,
  POPI_DESK_BOUNDS.minZ,
  POPI_DESK_BOUNDS.maxZ,
);

/**
 * Popi's own chair. Sized from the geometry `Workstation` draws — seat,
 * backrest, footrest and star base — with only foot clearance, because she
 * stands in front of it and sits on it.
 */
const chairBox = localBox(
  "popi-chair",
  POPI_CHAIR_POSITION[0] - 0.42,
  POPI_CHAIR_POSITION[0] + 0.42,
  POPI_CHAIR_POSITION[2] - 0.3,
  POPI_CHAIR_POSITION[2] + 0.7,
  0.16,
);

const serverRackBox = (() => {
  const { position, size } = OFFICE_LAYOUT.serverRack;

  return localBox(
    "server-rack",
    position[0] - size[0] / 2,
    position[0] + size[0] / 2,
    position[2] - size[2] / 2,
    position[2] + size[2] / 2,
  );
})();

/**
 * Bounded area Popi may roam in. She stays on the camera side of the room and
 * clear of the walls, so an autonomous wander never walks her out of frame or
 * into architecture.
 */
export const POPI_WANDER_LIMITS = {
  minX: -4.6,
  maxX: 4.6,
  minZ: -3.2,
  maxZ: 5.4,
} as const;

/** Every obstacle she has to walk around, in her local frame. */
export const POPI_OBSTACLES: readonly NavBox[] = Object.freeze([
  popiDeskBox,
  chairBox,
  serverRackBox,
  ...workerDeskBoxes(),
]);

export function inflateBox(box: NavBox, pad: number = box.pad): NavBox {
  return {
    label: box.label,
    minX: box.minX - pad,
    maxX: box.maxX + pad,
    minZ: box.minZ - pad,
    maxZ: box.maxZ + pad,
    pad,
  };
}

export function isPointInside(
  box: NavBox,
  x: number,
  z: number,
): boolean {
  return x >= box.minX && x <= box.maxX && z >= box.minZ && z <= box.maxZ;
}

export function isWithinWanderLimits(x: number, z: number): boolean {
  return (
    x >= POPI_WANDER_LIMITS.minX &&
    x <= POPI_WANDER_LIMITS.maxX &&
    z >= POPI_WANDER_LIMITS.minZ &&
    z <= POPI_WANDER_LIMITS.maxZ
  );
}

/**
 * True when a standing character centred on (x, z) keeps every footprint's own
 * clearance. This is the single question the wander step asks before moving.
 */
export function isWanderPointSafe(
  x: number,
  z: number,
  pad?: number,
): boolean {
  if (!isWithinWanderLimits(x, z)) {
    return false;
  }

  return isClearOfFurniture(x, z, pad);
}

/** True when (x, z) is outside every inflated footprint. */
export function isClearOfFurniture(
  x: number,
  z: number,
  pad?: number,
): boolean {
  for (const box of POPI_OBSTACLES) {
    if (isPointInside(inflateBox(box, pad), x, z)) {
      return false;
    }
  }

  return true;
}

/** Slab test: does the segment a->b cross `box` at all? */
export function segmentIntersectsBox(
  box: NavBox,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): boolean {
  let tMin = 0;
  let tMax = 1;
  const dx = bx - ax;
  const dz = bz - az;

  const spans: Array<[number, number, number]> = [
    [ax, dx, 0],
    [az, dz, 1],
  ];

  for (const [origin, delta, axis] of spans) {
    const min = axis === 0 ? box.minX : box.minZ;
    const max = axis === 0 ? box.maxX : box.maxZ;

    if (Math.abs(delta) < 1e-9) {
      if (origin < min || origin > max) {
        return false;
      }

      continue;
    }

    let t1 = (min - origin) / delta;
    let t2 = (max - origin) / delta;

    if (t1 > t2) {
      [t1, t2] = [t2, t1];
    }

    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);

    if (tMin > tMax) {
      return false;
    }
  }

  return true;
}

/**
 * True when walking from a to b stays clear of every footprint. A start point
 * that is already inside a footprint is not a collision: the way out is
 * progress in exactly the direction she wants to go.
 */
export function isPathClear(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  pad?: number,
): boolean {
  if (!isWanderPointSafe(bx, bz, pad)) {
    return false;
  }

  for (const box of POPI_OBSTACLES) {
    const inflated = inflateBox(box, pad);

    if (isPointInside(inflated, ax, az)) {
      continue;
    }

    if (segmentIntersectsBox(inflated, ax, az, bx, bz)) {
      return false;
    }
  }

  return true;
}

/**
 * Candidate headings, closest-to-desired first. Bounded on purpose: the wanders
 * never spray the character into a corner, they nudge her around furniture.
 */
const STEER_OFFSETS_DEG = [0, 18, -18, 36, -36, 55, -55, 75, -75, 90, -90];

/**
 * Pick a heading near `desired` whose short probe ahead is walkable. `desired`
 * and the result use the character's facing convention: forward is
 * (sin(a), cos(a)) in the (x, z) plane, so 0 faces local +z.
 *
 * When a target is supplied the walkable candidate that closes the most ground
 * on it wins, which is what lets her walk *out* of a footprint she is standing
 * in instead of stalling against it.
 */
export function steerDirection(
  x: number,
  z: number,
  desired: number,
  options: {
    targetX?: number;
    targetZ?: number;
    lookahead?: number;
    pad?: number;
  } = {},
): number {
  const lookahead = options.lookahead ?? POPI_LOOKAHEAD;
  const pad = options.pad;
  const hasTarget =
    typeof options.targetX === "number" && typeof options.targetZ === "number";

  let bestAngle = desired + Math.PI;
  let bestCost = Number.POSITIVE_INFINITY;

  for (const offsetDeg of STEER_OFFSETS_DEG) {
    const angle = desired + (offsetDeg * Math.PI) / 180;
    const probeX = x + Math.sin(angle) * lookahead;
    const probeZ = z + Math.cos(angle) * lookahead;

    if (!isPathClear(x, z, probeX, probeZ, pad)) {
      continue;
    }

    let cost = Math.abs(offsetDeg) * 0.01;

    if (hasTarget) {
      cost += Math.hypot(
        options.targetX as number - probeX,
        options.targetZ as number - probeZ,
      );
    }

    if (cost < bestCost) {
      bestCost = cost;
      bestAngle = angle;
    }
  }

  return bestAngle;
}

/** Deterministic pseudo-random value in [0, 1) from an integer seed. */
function hash01(seed: number): number {
  const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453;

  return value - Math.floor(value);
}

/** Open floor beside Popi's desk, clear of her own furniture. */
export const POPI_HOME_POSITION: Vec3 = [1.7, 0, 0.6];

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/**
 * Deterministic wander target. The seed decides the spot; unsafe spots and
 * points too close to `from` are skipped, and a long safe fallback list keeps
 * the function total — it can never return an unwalkable point.
 */
export function pickWanderTarget(
  seed: number,
  from?: { x: number; z: number },
): { x: number; z: number } {
  const fallbacks: Array<{ x: number; z: number }> = [
    { x: 2.6, z: 3.4 },
    { x: -2.8, z: 3.0 },
    { x: 3.4, z: 1.2 },
    { x: -3.2, z: 0.2 },
    { x: 0.6, z: 4.2 },
    { x: -0.4, z: 3.6 },
  ];

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const index = seed + attempt * 7;
    const x = clamp(
      POPI_WANDER_LIMITS.minX +
        hash01(index * 2.13) *
          (POPI_WANDER_LIMITS.maxX - POPI_WANDER_LIMITS.minX),
      POPI_WANDER_LIMITS.minX,
      POPI_WANDER_LIMITS.maxX,
    );
    const z = clamp(
      POPI_WANDER_LIMITS.minZ +
        hash01(index * 5.71 + 9.4) *
          (POPI_WANDER_LIMITS.maxZ - POPI_WANDER_LIMITS.minZ),
      POPI_WANDER_LIMITS.minZ,
      POPI_WANDER_LIMITS.maxZ,
    );

    const farEnough =
      !from || Math.hypot(x - from.x, z - from.z) >= POPI_BODY_RADIUS * 3;

    if (farEnough && isWanderPointSafe(x, z)) {
      return { x, z };
    }
  }

  for (const candidate of fallbacks) {
    if (isWanderPointSafe(candidate.x, candidate.z)) {
      return candidate;
    }
  }

  return { x: POPI_HOME_POSITION[0], z: POPI_HOME_POSITION[2] };
}

/** Heading from (x, z) toward a target, in the character's facing convention. */
export function headingToward(
  x: number,
  z: number,
  targetX: number,
  targetZ: number,
): number {
  return Math.atan2(targetX - x, targetZ - z);
}
