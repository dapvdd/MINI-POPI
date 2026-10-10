/**
 * World layout for the MINPOP virtual office.
 *
 * This module is intentionally free of Three.js and React: it describes *where*
 * things live, not how they look. Agent state (status colors, animation) stays
 * in `popi.ts` and `worker-visuals.ts`, and worker lifecycle stays in
 * `lib/hermes/workers.ts`, so the environment can host live workers without
 * coupling layout to render or agent data.
 */

export type Vec3 = [number, number, number];

export interface WorkstationSpec {
  id: string;
  label: string;
  position: Vec3;
  rotationY: number;
}

/**
 * Dark navy / charcoal foundation with electric-cyan structure, one violet fill
 * and a single warm amber family for life-like accents. Near-black values are
 * deliberately avoided: every surface must stay readable against the key light.
 */
export const OFFICE_PALETTE = {
  background: "#070b14",
  floor: "#171d2b",
  floorLine: "#22304a",
  wall: "#1e2534",
  wallPanel: "#26304a",
  wallTrim: "#33415e",
  rug: "#232b41",
  desk: "#2a3247",
  deskEdge: "#3b4767",
  metal: "#1f2634",
  metalLight: "#39435c",
  screenFrame: "#080c14",
  accent: "#22d3ee",
  accentSoft: "#38bdf8",
  violet: "#8b5cf6",
  warm: "#fbbf24",
  warmSoft: "#fcd34d",
  plant: "#34d399",
  plantDark: "#1f9d6b",
  mug: "#f472b6",
  paper: "#e4e4e7",
  led: "#22d3ee",
  steel: "#4b5a7a",
  glass: "#0f172a",
} as const;

export type OfficePaletteKey = keyof typeof OFFICE_PALETTE;

export const OFFICE_LAYOUT = {
  floor: { width: 24, depth: 16, center: [0, 0, 1] as Vec3 },
  backWallZ: -6,
  leftWallX: -8,
  /** Enclosing wall on the open camera side, kept inside the floor edge. */
  rightWallX: 11.6,
  wallHeight: 4.4,
  wallThickness: 0.3,
  ceilingY: 4.4,
  rug: { width: 7.5, depth: 6, center: [0, 0, 1.4] as Vec3 },
  /**
   * Infrastructure zone. The rack is a compact unit sitting flush against the
   * back wall in the open pocket left of Popi's desk, clear of every worker
   * station row.
   */
  serverRack: {
    position: [0.8, 0, -5.4] as Vec3,
    size: [0.95, 2.1, 0.6] as Vec3,
  },
  /** Long window band on the left wall, well clear of every desk row. */
  window: {
    position: [-7.7, 2.2, 2.9] as Vec3,
    size: [0.06, 2.6, 3.2] as Vec3,
  },
} as const;

export type OfficeLayout = typeof OFFICE_LAYOUT;

/* =========================================================
   TECH DETAIL PLACEMENT
   Prop positions that used to be scattered magic numbers.
   Keeping them as data means the composition itself is
   testable — a panel or rack shelf can be proven not to
   collide with a workstation instead of being eyeballed.
======================================================== */

/** Decorative equipment bands on the back wall, left-to-right. */
export const WALL_PANELS: ReadonlyArray<{
  x: number;
  y: number;
  width: number;
  height: number;
}> = [
  { x: -2.6, y: 2.5, width: 1.7, height: 1.5 },
  { x: 0.4, y: 2.5, width: 2.4, height: 0.9 },
  { x: 8.4, y: 2.5, width: 1.5, height: 1.1 },
];

/** Ceiling light bands along the room's length. */
export const CEILING_BANDS: readonly number[] = [-3.4, 0.6, 4.6];

/** Rack equipment geometry — mirrors the unit shelves in `ServerRack`. */
export const SERVER_RACK_UNITS = 4;
export const SERVER_RACK_LED_COLUMNS = 3;

export interface ServerRackCell {
  unit: number;
  column: number;
  /** Centre height of the unit shelf. */
  y: number;
  /** Local X of the LED within the rack chassis. */
  ledX: number;
}

/**
 * Equipment cells for the rack, derived from its declared size so the chassis
 * and its contents can never drift apart.
 */
export function serverRackCells(): ServerRackCell[] {
  const { size } = OFFICE_LAYOUT.serverRack;
  const unitHeight = size[1] / SERVER_RACK_UNITS;
  const cells: ServerRackCell[] = [];

  for (let unit = 0; unit < SERVER_RACK_UNITS; unit += 1) {
    for (let column = 0; column < SERVER_RACK_LED_COLUMNS; column += 1) {
      cells.push({
        unit,
        column,
        y: (unit + 0.5) * unitHeight,
        ledX: -size[0] / 2 + 0.14 + column * 0.13,
      });
    }
  }

  return cells;
}

/** Popi's desk footprint, used to keep new props clear of her workspace. */
export const POPI_DESK_BOUNDS = {
  minX: -2,
  maxX: 2,
  minZ: -1,
  maxZ: 0.6,
} as const;

/** Popi's station sits at the world origin and anchors the scene. */
export const POPI_WORKSTATION: WorkstationSpec = {
  id: "popi",
  label: "Popi",
  position: [0, 0, 0],
  rotationY: 0,
};

/**
 * Maximum number of physical worker workstations. The room can only hold so
 * many desks without overlap, so any live workers beyond this are reported as
 * `overflow` by `assignWorkerWorkstations` and stay represented in the
 * Activity list instead of being placed outside the room.
 */
export const MAX_WORKER_WORKSTATIONS = 10;

/**
 * Reserved in-room desks, ordered nearest-first so small delegations stay close
 * to Popi. Rows flank the main workstation and sit against the back wall; all
 * positions clear Popi's footprint and the left/back walls.
 */
const WORKER_SLOT_LAYOUT: ReadonlyArray<{ x: number; z: number }> = [
  { x: 3.4, z: -1.6 },
  { x: -3.4, z: -1.6 },
  { x: 6.4, z: -1.6 },
  { x: -6.4, z: -1.6 },
  { x: 9.4, z: -1.6 },
  { x: 3.4, z: -4.2 },
  { x: -3.4, z: -4.2 },
  { x: 6.4, z: -4.2 },
  { x: -6.4, z: -4.2 },
  { x: 9.4, z: -4.2 },
];

/**
 * Frozen specs so a slot keeps a stable object identity across renders: React
 * keys and memoized worker stations then never churn on unrelated updates.
 */
const WORKER_SLOT_SPECS: ReadonlyArray<WorkstationSpec> =
  WORKER_SLOT_LAYOUT.map((slot, index) => ({
    id: `worker-${index}`,
    label: `Worker ${index + 1}`,
    position: [slot.x, 0, slot.z],
    rotationY: slot.x > 0 ? 0.22 : -0.22,
  }));

/**
 * Deterministic slot for one worker desk. Returns `null` past capacity so the
 * caller has to make an explicit overflow decision rather than pushing a desk
 * through a wall.
 */
export function workerWorkstationSlot(index: number): WorkstationSpec | null {
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index >= WORKER_SLOT_SPECS.length
  ) {
    return null;
  }

  return WORKER_SLOT_SPECS[index];
}

/** FNV-1a over the stable worker id; used only to derive a deterministic rank. */
export function hashWorkerId(id: string): number {
  let hash = 2166136261;

  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

export interface WorkstationAssignment {
  workerId: string;
  slotIndex: number;
  spec: WorkstationSpec;
}

export interface WorkerLayout {
  /** In-room assignments, ordered by slot position (stable render order). */
  assignments: WorkstationAssignment[];
  /** Live worker ids with no desk (over capacity), in deterministic order. */
  overflow: string[];
}

/**
 * Assign live workers to physical desks.
 *
 * Pure and deterministic: duplicate ids collapse (replayed events cannot create
 * a second desk), the id set is ranked by a stable id hash, and nearest-first
 * slots are handed out from that rank. The result is therefore independent of
 * input order, and two concurrent workers can never share a slot.
 */
export function assignWorkerWorkstations(
  workerIds: readonly string[],
): WorkerLayout {
  const unique = Array.from(new Set(workerIds));

  unique.sort((a, b) => {
    const hashA = hashWorkerId(a);
    const hashB = hashWorkerId(b);

    if (hashA !== hashB) {
      return hashA - hashB;
    }

    return a.localeCompare(b);
  });

  const assignments: WorkstationAssignment[] = [];
  const overflow: string[] = [];

  unique.forEach((workerId, index) => {
    const spec = workerWorkstationSlot(index);

    if (!spec) {
      overflow.push(workerId);
      return;
    }

    assignments.push({ workerId, slotIndex: index, spec });
  });

  assignments.sort((a, b) => a.slotIndex - b.slotIndex);

  return { assignments, overflow };
}

/**
 * True when a station sits inside the room's floor, clear of the back and left
 * walls by `margin`. Used to keep overflow/re-layout changes honest.
 */
export function isWithinOfficeBounds(
  spec: WorkstationSpec,
  margin = 0,
): boolean {
  const [x, , z] = spec.position;
  const halfWidth = OFFICE_LAYOUT.floor.width / 2;
  const halfDepth = OFFICE_LAYOUT.floor.depth / 2;
  const minX =
    OFFICE_LAYOUT.leftWallX + OFFICE_LAYOUT.wallThickness + margin;
  const minZ =
    OFFICE_LAYOUT.backWallZ + OFFICE_LAYOUT.wallThickness + margin;
  const maxX = OFFICE_LAYOUT.floor.center[0] + halfWidth - margin;
  const maxZ = OFFICE_LAYOUT.floor.center[2] + halfDepth - margin;

  return x >= minX && x <= maxX && z >= minZ && z <= maxZ;
}
