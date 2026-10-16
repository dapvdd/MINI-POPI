import { describe, expect, it } from "vitest";
import {
  COLLABORATION_BOARD,
  COLLABORATION_CHAIRS,
  COLLABORATION_TABLE,
  LOUNGE_FURNITURE,
  MAX_WORKER_WORKSTATIONS,
  OFFICE_LAYOUT,
  OFFICE_PARTITIONS,
  OFFICE_WALKWAYS,
  OFFICE_ZONES,
  POPI_DESK_BOUNDS,
  workerWorkstationSlot,
  zoneBounds,
} from "./office";

interface Rect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

function deskRect(x: number, z: number): Rect {
  return { minX: x - 1.2, maxX: x + 1.2, minZ: z - 0.6, maxZ: z + 0.6 };
}

function workerDesks(): Rect[] {
  const desks: Rect[] = [{ ...POPI_DESK_BOUNDS }];
  for (let i = 0; i < MAX_WORKER_WORKSTATIONS; i += 1) {
    const slot = workerWorkstationSlot(i);
    if (slot) desks.push(deskRect(slot.position[0], slot.position[2]));
  }
  return desks;
}

function separated(a: Rect, b: Rect): boolean {
  return a.maxX <= b.minX || a.minX >= b.maxX || a.maxZ <= b.minZ || a.minZ >= b.maxZ;
}

function pointRect(x: number, z: number, radius: number): Rect {
  return { minX: x - radius, maxX: x + radius, minZ: z - radius, maxZ: z + radius };
}

/** Inner room faces (inside the walls) used for containment checks. */
const ROOM = {
  minX: OFFICE_LAYOUT.leftWallX + OFFICE_LAYOUT.wallThickness,
  maxX: OFFICE_LAYOUT.rightWallX - OFFICE_LAYOUT.wallThickness,
  minZ: OFFICE_LAYOUT.backWallZ + OFFICE_LAYOUT.wallThickness,
  maxZ: OFFICE_LAYOUT.floor.center[2] + OFFICE_LAYOUT.floor.depth / 2,
};

function contains(rect: Rect): boolean {
  return rect.minX >= ROOM.minX && rect.maxX <= ROOM.maxX && rect.minZ >= ROOM.minZ && rect.maxZ <= ROOM.maxZ;
}

describe("office zones (Phase L)", () => {
  it("declares unique, labelled zones", () => {
    expect(OFFICE_ZONES.length).toBeGreaterThanOrEqual(5);
    const ids = new Set(OFFICE_ZONES.map((z) => z.id));
    const labels = new Set(OFFICE_ZONES.map((z) => z.label));
    expect(ids.size).toBe(OFFICE_ZONES.length);
    expect(labels.size).toBe(OFFICE_ZONES.length);
    for (const zone of OFFICE_ZONES) {
      expect(zone.label.length).toBeGreaterThan(0);
      expect(zone.accent).toMatch(/^#[0-9a-f]{6}$/i);
      expect(zone.size[0]).toBeGreaterThan(0);
      expect(zone.size[1]).toBeGreaterThan(0);
    }
  });

  it("keeps every zone footprint inside the room", () => {
    for (const zone of OFFICE_ZONES) {
      const [minX, maxX, minZ, maxZ] = zoneBounds(zone);
      expect({ minX, maxX, minZ, maxZ }).toEqual(
        expect.objectContaining({
          minX: expect.any(Number),
          maxX: expect.any(Number),
        }),
      );
      expect(minX).toBeGreaterThanOrEqual(ROOM.minX - 1e-6);
      expect(maxX).toBeLessThanOrEqual(ROOM.maxX + 1e-6);
      expect(minZ).toBeGreaterThanOrEqual(ROOM.minZ - 1e-6);
      expect(maxZ).toBeLessThanOrEqual(ROOM.maxZ + 1e-6);
    }
  });

  it("keeps the three floor plates mutually non-overlapping", () => {
    const plateIds = ["workspace", "collaboration", "lounge"] as const;
    const rects = plateIds.map((id) => {
      const zone = OFFICE_ZONES.find((z) => z.id === id);
      if (!zone) throw new Error(`missing zone ${id}`);
      const [minX, maxX, minZ, maxZ] = zoneBounds(zone);
      return { id, rect: { minX, maxX, minZ, maxZ } };
    });

    for (let i = 0; i < rects.length; i += 1) {
      for (let j = i + 1; j < rects.length; j += 1) {
        expect(separated(rects[i].rect, rects[j].rect)).toBe(true);
      }
    }
  });

  it("keeps the collaboration table and chairs inside the room and off every desk", () => {
    const table = pointRect(
      COLLABORATION_TABLE.position[0],
      COLLABORATION_TABLE.position[2],
      COLLABORATION_TABLE.radius,
    );
    expect(contains(table)).toBe(true);

    const desks = workerDesks();
    for (const desk of desks) {
      expect(separated(table, desk)).toBe(true);
    }

    expect(COLLABORATION_CHAIRS.length).toBeGreaterThanOrEqual(4);
    for (const seat of COLLABORATION_CHAIRS) {
      const chair = pointRect(seat[0], seat[2], 0.3);
      expect(contains(chair)).toBe(true);
      for (const desk of desks) {
        expect(separated(chair, desk)).toBe(true);
      }
    }
  });

  it("keeps the whiteboard flush with the right wall", () => {
    const { position, size } = COLLABORATION_BOARD;
    expect(position[0] + size[0] / 2).toBeGreaterThanOrEqual(
      OFFICE_LAYOUT.rightWallX - OFFICE_LAYOUT.wallThickness - 1e-6,
    );
    expect(position[2]).toBeGreaterThan(0);
    expect(size[1]).toBeGreaterThan(1);
  });

  it("keeps lounge furniture inside the room and clear of every desk", () => {
    const desks = workerDesks();
    const { sofa, table, plants, cooler } = LOUNGE_FURNITURE;

    const sofaRect: Rect = {
      minX: sofa.position[0] - sofa.width / 2,
      maxX: sofa.position[0] + sofa.width / 2,
      minZ: sofa.position[2] - 0.55,
      maxZ: sofa.position[2] + 0.55,
    };
    const tableRect = pointRect(table.position[0], table.position[2], table.radius);
    const coolerRect = pointRect(cooler.position[0], cooler.position[2], 0.3);

    const items = [sofaRect, tableRect, coolerRect, ...plants.map((p) => pointRect(p[0], p[2], 0.4))];

    for (const item of items) {
      expect(contains(item)).toBe(true);
      for (const desk of desks) {
        expect(separated(item, desk)).toBe(true);
      }
    }
  });

  it("keeps partitions inside the room and clear of Popi and every worker desk", () => {
    expect(OFFICE_PARTITIONS.length).toBeGreaterThanOrEqual(2);
    const desks = workerDesks();

    for (const part of OFFICE_PARTITIONS) {
      const rect: Rect = {
        minX: part.position[0] - part.size[0] / 2,
        maxX: part.position[0] + part.size[0] / 2,
        minZ: part.position[2] - part.size[2] / 2,
        maxZ: part.position[2] + part.size[2] / 2,
      };

      expect(contains(rect)).toBe(true);
      for (const desk of desks) {
        expect(separated(rect, desk)).toBe(true);
      }
      expect(part.size[1]).toBeGreaterThan(0.5);
    }
  });

  it("keeps walkways inside the room", () => {
    for (const strip of OFFICE_WALKWAYS) {
      const rect: Rect = {
        minX: strip.position[0] - strip.size[0] / 2,
        maxX: strip.position[0] + strip.size[0] / 2,
        minZ: strip.position[2] - strip.size[1] / 2,
        maxZ: strip.position[2] + strip.size[1] / 2,
      };
      expect(contains(rect)).toBe(true);
    }
  });
});
