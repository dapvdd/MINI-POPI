/**
 * World layout for the MINPOP virtual office.
 *
 * This module is intentionally free of Three.js and React: it describes *where*
 * things live, not how they look. Agent state (status colors, animation) stays
 * in `popi.ts`, so the environment can grow — e.g. one workstation per live
 * worker — without rewriting the scene or coupling layout to agent data.
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
 * Deterministic slot for a future worker workstation. Nothing renders these
 * yet — live worker visualization is not implemented in this phase — but the
 * office environment already reserves the space so it will not need rewriting.
 */
export function workerWorkstationSlot(index: number): WorkstationSpec {
  const row = Math.floor(index / 2);
  const side = index % 2 === 0 ? -1 : 1;

  return {
    id: `worker-${index}`,
    label: `Worker ${index + 1}`,
    position: [side * (4.6 + row * 4.6), 0, -1.8 + row * 0.4],
    rotationY: side < 0 ? 0.35 : -0.35,
  };
}
