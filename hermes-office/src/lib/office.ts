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

export const OFFICE_PALETTE = {
  background: "#0b0b0f",
  floor: "#1b1b21",
  wall: "#212128",
  wallTrim: "#33333d",
  rug: "#181820",
  desk: "#2f2f38",
  deskEdge: "#41414d",
  metal: "#26262e",
  metalLight: "#3c3c47",
  screenFrame: "#0a0a0e",
  accent: "#60a5fa",
  warm: "#f59e0b",
  plant: "#34d399",
  plantDark: "#1f9d6b",
  mug: "#f472b6",
  paper: "#e4e4e7",
} as const;

export const OFFICE_LAYOUT = {
  floor: { width: 24, depth: 16, center: [0, 0, 1] as Vec3 },
  backWallZ: -6,
  leftWallX: -8,
  wallHeight: 4.4,
  wallThickness: 0.3,
  rug: { width: 7.5, depth: 6, center: [0, 0, 1.4] as Vec3 },
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
