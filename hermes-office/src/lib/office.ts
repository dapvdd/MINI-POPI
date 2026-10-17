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
  background: "#0b1526",
  floor: "#1d2537",
  floorLine: "#2b3c5c",
  wall: "#232c3f",
  wallPanel: "#2c3854",
  wallTrim: "#3d4c6d",
  rug: "#2a3350",
  desk: "#333d57",
  deskEdge: "#47537a",
  metal: "#28304a",
  metalLight: "#4a567a",
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
  /**
   * Phase L expansion: the hall roughly doubles in area so it can host distinct
   * zones (Popi's primary workspace, a large open worker floor, a collaboration
   * room and a lounge) without any desk, character or furniture overlapping.
   */
  floor: { width: 32, depth: 22, center: [0, 0, 2] as Vec3 },
  backWallZ: -9,
  leftWallX: -13,
  /** Enclosing wall on the open camera side, kept inside the floor edge. */
  rightWallX: 15.5,
  wallHeight: 4.8,
  wallThickness: 0.3,
  ceilingY: 4.8,
  rug: { width: 8, depth: 6.4, center: [0, 0, 1.4] as Vec3 },
  /**
   * Infrastructure zone. The rack is a compact unit sitting flush against the
   * back wall in the open pocket left of Popi's desk, clear of every worker
   * station row.
   */
  serverRack: {
    position: [0.8, 0, -8.55] as Vec3,
    size: [0.95, 2.1, 0.6] as Vec3,
  },
  /** Long window band on the left wall, well clear of every desk row. */
  window: {
    position: [-12.85, 2.4, 3.0] as Vec3,
    size: [0.06, 2.8, 3.4] as Vec3,
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
  { x: -5.0, y: 2.6, width: 1.9, height: 1.6 },
  { x: 3.2, y: 2.6, width: 2.6, height: 0.95 },
  { x: 11.6, y: 2.6, width: 1.6, height: 1.2 },
  { x: -9.0, y: 2.6, width: 1.4, height: 1.3 },
];

/** Ceiling light bands along the room's length. */
export const CEILING_BANDS: readonly number[] = [-6.2, -2.2, 1.8, 5.8, 9.8];

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

/**
 * Where the character rig is mounted inside Popi's workstation group. She
 * stands just in front of the desk's front edge with her own chair behind her,
 * so the desk and its monitors read as her workspace from the default camera.
 */
export const POPI_AGENT_OFFSET: Vec3 = [0, 0, 1.3];

/** Shallow task chair at Popi's station; she sits here when a state seats her. */
export const POPI_CHAIR_POSITION: Vec3 = [-0.1, 0, 1.9];

/** Footrest bolted to the chair keeps her feet off the floor while seated. */
export const POPI_CHAIR_FOOTREST: Vec3 = [-0.1, 0.34, 1.9];

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
export const MAX_WORKER_WORKSTATIONS = 18;

/**
 * Reserved in-room desks, ordered nearest-first so small delegations stay close
 * to Popi. Three rows of six flank the main workstation and sit against the
 * back wall; all positions clear Popi's footprint and the left/back walls, and
 * every pair is at least 2.5 units apart so no two desks can overlap.
 */
const WORKER_SLOT_LAYOUT: ReadonlyArray<{ x: number; z: number }> = [
  { x: 3.4, z: -1.8 },
  { x: -3.4, z: -1.8 },
  { x: 6.6, z: -1.8 },
  { x: -6.6, z: -1.8 },
  { x: 9.8, z: -1.8 },
  { x: -9.8, z: -1.8 },
  { x: 3.4, z: -4.8 },
  { x: -3.4, z: -4.8 },
  { x: 6.6, z: -4.8 },
  { x: -6.6, z: -4.8 },
  { x: 9.8, z: -4.8 },
  { x: -9.8, z: -4.8 },
  { x: 3.4, z: -7.8 },
  { x: -3.4, z: -7.8 },
  { x: 6.6, z: -7.8 },
  { x: -6.6, z: -7.8 },
  { x: 9.8, z: -7.8 },
  { x: -9.8, z: -7.8 },
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

/* =========================================================
   ZONES (Phase L)
   The office is divided into coherent architectural zones.
   Each zone is pure data: a footprint used for its floor plate
   and a label used for its hanging sign, so the composition can
   be tested rather than eyeballed.
======================================================== */

export type OfficeZoneId =
  | "primary"
  | "workspace"
  | "collaboration"
  | "lounge"
  | "infrastructure";

export interface OfficeZone {
  id: OfficeZoneId;
  label: string;
  /** Accent color for the floor plate and zone sign. */
  accent: string;
  center: Vec3;
  /** Footprint [width(x), depth(z)] of the zone's floor plate. */
  size: [number, number];
}

export const OFFICE_ZONES: readonly OfficeZone[] = [
  {
    id: "primary",
    label: "Primary Workspace",
    accent: OFFICE_PALETTE.accent,
    center: [0, 0, 0.8],
    size: [7.4, 6.4],
  },
  {
    id: "workspace",
    label: "Open Workspace",
    accent: OFFICE_PALETTE.accentSoft,
    center: [0, 0, -4.6],
    size: [23.4, 7.2],
  },
  {
    id: "collaboration",
    label: "Collaboration",
    accent: OFFICE_PALETTE.violet,
    center: [12.4, 0, 4.0],
    size: [5.6, 8.4],
  },
  {
    id: "lounge",
    label: "Lounge",
    accent: OFFICE_PALETTE.plant,
    center: [-9.6, 0, 6.6],
    size: [6.0, 8.4],
  },
  {
    id: "infrastructure",
    label: "Infrastructure",
    accent: OFFICE_PALETTE.warm,
    center: [0, 0, -8.2],
    size: [4.4, 1.0],
  },
];

/** Rectangle [minX, maxX, minZ, maxZ] for a zone's floor footprint. */
export function zoneBounds(zone: OfficeZone): [number, number, number, number] {
  const [x, , z] = zone.center;
  const [w, d] = zone.size;
  return [x - w / 2, x + w / 2, z - d / 2, z + d / 2];
}

/* =========================================================
   ZONE FURNITURE (Phase L)
   Data-driven placements for the collaboration and lounge
   zones so props can be proven non-overlapping and inside the
   room rather than positioned by trial and error.
======================================================== */

/** Round collaboration table at the center of the collaboration zone. */
export const COLLABORATION_TABLE = {
  position: [12.4, 0, 4.0] as Vec3,
  radius: 1.35,
  height: 0.74,
} as const;

/** Chairs arranged around the collaboration table (unit offsets). */
export const COLLABORATION_CHAIRS: ReadonlyArray<Vec3> = (() => {
  const seats: Vec3[] = [];
  const count = 6;
  const ring = COLLABORATION_TABLE.radius + 0.85;
  for (let i = 0; i < count; i += 1) {
    const angle = (i / count) * Math.PI * 2;
    seats.push([
      COLLABORATION_TABLE.position[0] + Math.cos(angle) * ring,
      0,
      COLLABORATION_TABLE.position[2] + Math.sin(angle) * ring,
    ]);
  }
  return seats;
})();

/** Whiteboard mounted on the right wall, inside the collaboration zone. */
export const COLLABORATION_BOARD = {
  position: [OFFICE_LAYOUT.rightWallX - 0.2, 2.3, 4.0] as Vec3,
  size: [0.08, 1.5, 3.0] as Vec3,
} as const;

/** Lounge sofa, coffee table and plant placements. */
export const LOUNGE_FURNITURE = {
  sofa: { position: [-9.6, 0, 8.4] as Vec3, width: 3.0 },
  table: { position: [-9.6, 0, 6.6] as Vec3, radius: 0.62 },
  plants: [
    [-12.0, 0, 3.4] as Vec3,
    [-7.4, 0, 9.6] as Vec3,
    [-12.0, 0, 9.6] as Vec3,
  ],
  cooler: { position: [-6.8, 0, 3.2] as Vec3 },
} as const;

/* =========================================================
   PARTITIONS + WALKWAYS (Phase L)
   Low dividers separate the open workspace from the front
   zones while leaving a clear central walkway to Popi.
======================================================== */

export interface PartitionSpec {
  position: Vec3;
  /** Box size [x, y, z]. */
  size: Vec3;
  rotationY: number;
}

export const OFFICE_PARTITIONS: readonly PartitionSpec[] = [
  // Left divider between the open floor and the lounge approach.
  { position: [-7.9, 0, -0.4], size: [7.6, 1.35, 0.16], rotationY: 0 },
  // Right divider between the open floor and the collaboration room.
  { position: [6.9, 0, -0.4], size: [5.6, 1.35, 0.16], rotationY: 0 },
  // Thin spine separating the far-right desk column from the collab room.
  { position: [11.6, 0, -4.85], size: [0.16, 1.35, 6.9], rotationY: 0 },
];

/**
 * Main walkways rendered as subtle emissive strips. The first runs the full
 * width in front of the desks; the second is the central approach to Popi.
 */
export const OFFICE_WALKWAYS: ReadonlyArray<{
  position: Vec3;
  size: [number, number];
}> = [
  // Primary east-west route: sits between the desk rows and the dividers.
  { position: [0, 0, -0.9], size: [25, 0.45] },
  // Central approach toward the lounge, clear of Popi's rug.
  { position: [-5.5, 0, 5.0], size: [0.5, 5.5] },
];

/** True when a point falls inside a zone's floor footprint. */
export function zoneAt(x: number, z: number): OfficeZone | null {
  for (const zone of OFFICE_ZONES) {
    const [minX, maxX, minZ, maxZ] = zoneBounds(zone);
    if (x >= minX && x <= maxX && z >= minZ && z <= maxZ) {
      return zone;
    }
  }
  return null;
}

/**
 * Deterministic workstation assignment zone: worker desks are ordered
 * nearest-first, so a worker's rank maps onto the open workspace zone.
 */
export const WORKSPACE_ZONE_ID: OfficeZoneId = "workspace";

/**
 * Compute optimal camera distance for the Virtual Office overview.
 *
 * Keeps Popi and nearby worker desks prominent on widescreen displays while
 * ensuring the room fits on narrower viewports without unnecessary empty space.
 */
export function computeFramingDistance(aspect: number, extent = 3.4): number {
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1.5;
  const safeExtent = Number.isFinite(extent) && extent > 0 ? extent : 3.4;

  const baseAspectDistance =
    safeAspect < 1.0 ? 11.0 : safeAspect < 1.4 ? 9.2 : 8.0;
  const boundedExtent = Math.min(10.5, Math.max(7.5, safeExtent * 0.45 + 3.8));

  return Math.max(baseAspectDistance, boundedExtent);
}
