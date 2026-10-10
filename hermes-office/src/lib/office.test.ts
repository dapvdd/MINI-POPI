import { describe, expect, it } from "vitest";
import {
  assignWorkerWorkstations,
  CEILING_BANDS,
  hashWorkerId,
  isWithinOfficeBounds,
  MAX_WORKER_WORKSTATIONS,
  OFFICE_LAYOUT,
  OFFICE_PALETTE,
  POPI_WORKSTATION,
  SERVER_RACK_LED_COLUMNS,
  SERVER_RACK_UNITS,
  serverRackCells,
  WALL_PANELS,
  workerWorkstationSlot,
  type WorkstationSpec,
} from "./office";

function expectFiniteVec3(value: [number, number, number]) {
  expect(value).toHaveLength(3);
  for (const component of value) {
    expect(Number.isFinite(component)).toBe(true);
  }
}

const SAMPLE_IDS = Array.from(
  { length: 24 },
  (_, index) => `sa-${index}-${(index * 7919).toString(16)}`,
);

describe("office layout", () => {
  it("anchors Popi's workstation at the origin", () => {
    expect(POPI_WORKSTATION.id).toBe("popi");
    expectFiniteVec3(POPI_WORKSTATION.position);
    expect(POPI_WORKSTATION.position).toEqual([0, 0, 0]);
    expect(Number.isFinite(POPI_WORKSTATION.rotationY)).toBe(true);
  });

  it("keeps the room boundary behind the workstation", () => {
    expect(OFFICE_LAYOUT.backWallZ).toBeLessThan(
      POPI_WORKSTATION.position[2],
    );
    expect(OFFICE_LAYOUT.leftWallX).toBeLessThan(
      POPI_WORKSTATION.position[0],
    );
    expect(OFFICE_LAYOUT.wallHeight).toBeGreaterThan(0);
    expect(OFFICE_LAYOUT.wallThickness).toBeGreaterThan(0);
  });

  it("returns null for out-of-range worker slots", () => {
    expect(workerWorkstationSlot(-1)).toBeNull();
    expect(workerWorkstationSlot(MAX_WORKER_WORKSTATIONS)).toBeNull();
    expect(workerWorkstationSlot(2.5)).toBeNull();
  });

  it("keeps every worker slot inside the room and clear of Popi", () => {
    for (let index = 0; index < MAX_WORKER_WORKSTATIONS; index += 1) {
      const slot = workerWorkstationSlot(index);

      expect(slot).not.toBeNull();

      if (!slot) {
        continue;
      }

      expectFiniteVec3(slot.position);
      expect(Number.isFinite(slot.rotationY)).toBe(true);
      expect(slot.position[1]).toBe(0);
      expect(isWithinOfficeBounds(slot, 0.5)).toBe(true);

      // Worker desks never cross into Popi's central workstation footprint.
      expect(Math.abs(slot.position[0])).toBeGreaterThanOrEqual(2.2);
    }
  });

  it("gives every slot a distinct in-room position", () => {
    const slots = Array.from(
      { length: MAX_WORKER_WORKSTATIONS },
      (_, index) => workerWorkstationSlot(index),
    ).filter((slot): slot is WorkstationSpec => slot !== null);

    expect(slots).toHaveLength(MAX_WORKER_WORKSTATIONS);

    const ids = new Set(slots.map((slot) => slot.id));
    const positions = new Set(slots.map((slot) => slot.position.join(",")));

    expect(ids.size).toBe(slots.length);
    expect(positions.size).toBe(slots.length);

    for (let i = 0; i < slots.length; i += 1) {
      for (let j = i + 1; j < slots.length; j += 1) {
        const distance = Math.hypot(
          slots[i].position[0] - slots[j].position[0],
          slots[i].position[2] - slots[j].position[2],
        );

        expect(distance).toBeGreaterThanOrEqual(2.5);
      }
    }
  });

  it("exposes a complete color palette", () => {
    for (const color of Object.values(OFFICE_PALETTE)) {
      expect(color).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("keeps the palette dark rather than near-black", () => {
    // The room must read as dark navy/charcoal, never as an empty void.
    const channels = ["background", "floor", "wall", "desk"].map((key) => {
      const hex = OFFICE_PALETTE[key as keyof typeof OFFICE_PALETTE];
      return [
        parseInt(hex.slice(1, 3), 16),
        parseInt(hex.slice(3, 5), 16),
        parseInt(hex.slice(5, 7), 16),
      ];
    });

    for (const [r, g, b] of channels) {
      for (const channel of [r, g, b]) {
        expect(channel).toBeGreaterThan(4);
      }
    }

    // Blue must dominate, so the room reads cool and techy.
    for (const [r, , b] of channels) {
      expect(b).toBeGreaterThanOrEqual(r);
    }
  });

  it("sets the server rack flush against the back wall", () => {
    const { position, size } = OFFICE_LAYOUT.serverRack;
    const wallInner =
      OFFICE_LAYOUT.backWallZ + OFFICE_LAYOUT.wallThickness;

    expectFiniteVec3(position);
    expectFiniteVec3(size);
    expect(size[1]).toBeGreaterThan(1.5);

    // Back face sits inside the wall band; the unit reads as wall-mounted.
    const backFace = position[2] - size[2] / 2;
    expect(backFace).toBeGreaterThanOrEqual(OFFICE_LAYOUT.backWallZ - 1e-6);
    expect(backFace).toBeLessThanOrEqual(wallInner);
    // ...but it still protrudes into the room rather than being buried.
    const frontFace = position[2] + size[2] / 2;
    expect(frontFace).toBeGreaterThan(wallInner);
    expect(frontFace).toBeLessThan(OFFICE_LAYOUT.backWallZ + 1.5);
  });

  it("keeps the server rack clear of every workstation footprint", () => {
    const { position, size } = OFFICE_LAYOUT.serverRack;
    const rack = {
      minX: position[0] - size[0] / 2,
      maxX: position[0] + size[0] / 2,
      minZ: position[2] - size[2] / 2,
      maxZ: position[2] + size[2] / 2,
    };

    // Worker desks are 2.4 x 1.2; Popi's is 4 x 1.6. The rack must clear them all.
    const desks = [
      { minX: -2, maxX: 2, minZ: -1, maxZ: 0.6 },
      ...Array.from({ length: MAX_WORKER_WORKSTATIONS }, (_, i) =>
        workerWorkstationSlot(i),
      )
        .filter((slot): slot is NonNullable<typeof slot> => slot !== null)
        .map((slot) => ({
          minX: slot.position[0] - 1.2,
          maxX: slot.position[0] + 1.2,
          minZ: slot.position[2] - 0.6,
          maxZ: slot.position[2] + 0.6,
        })),
    ];

    for (const desk of desks) {
      const separatedX =
        rack.maxX <= desk.minX || rack.minX >= desk.maxX;
      const separatedZ =
        rack.maxZ <= desk.minZ || rack.minZ >= desk.maxZ;

      expect(separatedX || separatedZ).toBe(true);
    }
  });

  it("puts the window on the left wall, clear of every desk row", () => {
    const { position, size } = OFFICE_LAYOUT.window;
    const wallFace = OFFICE_LAYOUT.leftWallX + OFFICE_LAYOUT.wallThickness;

    expect(position[0]).toBeGreaterThan(OFFICE_LAYOUT.leftWallX);
    expect(position[0]).toBeLessThan(wallFace + 0.2);
    expect(position[2]).toBeGreaterThan(0);

    for (let index = 0; index < MAX_WORKER_WORKSTATIONS; index += 1) {
      const slot = workerWorkstationSlot(index);
      if (!slot) continue;
      expect(Math.abs(slot.position[2] - position[2])).toBeGreaterThan(size[2] / 2);
    }
  });

  it("encloses the room on three walls with the camera side left open", () => {
    expect(OFFICE_LAYOUT.leftWallX).toBeLessThan(0);
    expect(OFFICE_LAYOUT.rightWallX).toBeGreaterThan(0);
    expect(OFFICE_LAYOUT.rightWallX).toBeGreaterThan(
      OFFICE_LAYOUT.leftWallX,
    );
    // Asymmetry is intentional: the left wall is near, the right wall is far.
    expect(OFFICE_LAYOUT.rightWallX + OFFICE_LAYOUT.leftWallX).toBeGreaterThan(0);
    expect(OFFICE_LAYOUT.ceilingY).toBe(OFFICE_LAYOUT.wallHeight);
  });

  it("keeps every worker station inside the right wall", () => {
    for (let index = 0; index < MAX_WORKER_WORKSTATIONS; index += 1) {
      const slot = workerWorkstationSlot(index);
      if (!slot) continue;
      expect(slot.position[0] + 1.2).toBeLessThan(OFFICE_LAYOUT.rightWallX);
    }
  });

  it("fills the back wall without any panel overlapping the rack", () => {
    expect(WALL_PANELS.length).toBeGreaterThanOrEqual(3);

    const rack = OFFICE_LAYOUT.serverRack;

    for (const panel of WALL_PANELS) {
      // Every panel sits on the back wall, above desk height.
      expect(panel.y).toBeGreaterThan(1);
      expect(panel.y + panel.height / 2).toBeLessThan(
        OFFICE_LAYOUT.wallHeight,
      );
      expect(panel.width).toBeGreaterThan(0);
      expect(panel.height).toBeGreaterThan(0);

      const panelMinX = panel.x - panel.width / 2;
      const panelMaxX = panel.x + panel.width / 2;
      const rackMinX = rack.position[0] - rack.size[0] / 2;
      const rackMaxX = rack.position[0] + rack.size[0] / 2;

      const clearX = panelMaxX <= rackMinX || panelMinX >= rackMaxX;

      // Panels are wall-mounted at y=2.5, above the rack's 2.1 height, so a
      // shared X band is fine — but never a shared X *and* Z.
      const panelZ = OFFICE_LAYOUT.backWallZ + 0.16;
      const rackMinZ = rack.position[2] - rack.size[2] / 2;
      const rackMaxZ = rack.position[2] + rack.size[2] / 2;
      const clearZ = panelZ <= rackMinZ || panelZ >= rackMaxZ;

      expect(clearX || clearZ).toBe(true);
    }
  });

  it("keeps the ceiling bands inside the room and above the desks", () => {
    expect(CEILING_BANDS.length).toBeGreaterThanOrEqual(3);

    const halfDepth = OFFICE_LAYOUT.floor.depth / 2;

    for (const z of CEILING_BANDS) {
      expect(Math.abs(z - OFFICE_LAYOUT.floor.center[2])).toBeLessThan(
        halfDepth,
      );
    }

    // Bands must be spread out, not stacked: distinct zones read better.
    for (let i = 0; i < CEILING_BANDS.length; i += 1) {
      for (let j = i + 1; j < CEILING_BANDS.length; j += 1) {
        expect(
          Math.abs(CEILING_BANDS[i] - CEILING_BANDS[j]),
        ).toBeGreaterThan(1);
      }
    }
  });
});

describe("server rack detail", () => {
  it("derives cells from the declared rack size", () => {
    const cells = serverRackCells();
    const { size } = OFFICE_LAYOUT.serverRack;

    expect(cells).toHaveLength(
      SERVER_RACK_UNITS * SERVER_RACK_LED_COLUMNS,
    );

    for (const cell of cells) {
      expect(cell.unit).toBeGreaterThanOrEqual(0);
      expect(cell.unit).toBeLessThan(SERVER_RACK_UNITS);
      expect(cell.y).toBeGreaterThan(0);
      expect(cell.y).toBeLessThan(size[1]);
      // LEDs stay inside the chassis footprint.
      expect(Math.abs(cell.ledX)).toBeLessThan(size[0] / 2);
    }
  });

  it("spreads LED cells across distinct units and columns", () => {
    const cells = serverRackCells();
    const positions = new Set(cells.map((c) => `${c.unit}:${c.column}`));

    expect(positions.size).toBe(cells.length);
  });
});

describe("assignWorkerWorkstations", () => {
  it("is deterministic and independent of input order", () => {
    const forward = assignWorkerWorkstations(SAMPLE_IDS.slice(0, 5));
    const reversed = assignWorkerWorkstations(
      [...SAMPLE_IDS.slice(0, 5)].reverse(),
    );

    expect(reversed).toEqual(forward);

    // Re-running with the same ids yields the same mapping.
    expect(assignWorkerWorkstations(SAMPLE_IDS.slice(0, 5))).toEqual(
      forward,
    );
  });

  it("never shares a slot between concurrent workers", () => {
    const { assignments, overflow } = assignWorkerWorkstations(
      SAMPLE_IDS.slice(0, MAX_WORKER_WORKSTATIONS),
    );

    expect(overflow).toEqual([]);
    expect(assignments).toHaveLength(MAX_WORKER_WORKSTATIONS);

    const slots = new Set(assignments.map((entry) => entry.slotIndex));
    const positions = new Set(
      assignments.map((entry) => entry.spec.position.join(",")),
    );

    expect(slots.size).toBe(MAX_WORKER_WORKSTATIONS);
    expect(positions.size).toBe(MAX_WORKER_WORKSTATIONS);
  });

  it("collapses duplicate ids so replayed events reuse one station", () => {
    const id = SAMPLE_IDS[0];
    const { assignments, overflow } = assignWorkerWorkstations([
      id,
      id,
      id,
    ]);

    expect(overflow).toEqual([]);
    expect(assignments).toHaveLength(1);
    expect(assignments[0].workerId).toBe(id);
  });

  it("moves workers beyond capacity into a deterministic overflow list", () => {
    const ids = SAMPLE_IDS.slice(0, MAX_WORKER_WORKSTATIONS + 4);
    const layout = assignWorkerWorkstations(ids);

    expect(layout.assignments).toHaveLength(MAX_WORKER_WORKSTATIONS);
    expect(layout.overflow).toHaveLength(4);

    // Overflow is a stable function of the id set, not the input order.
    const shuffled = assignWorkerWorkstations([...ids].reverse());
    expect(shuffled.overflow).toEqual(layout.overflow);
    expect(shuffled.assignments).toEqual(layout.assignments);

    // Assigned and overflowed ids partition the input exactly.
    const assignedIds = layout.assignments.map((entry) => entry.workerId);
    expect(new Set([...assignedIds, ...layout.overflow])).toEqual(
      new Set(ids),
    );
  });

  it("orders assignments by slot for stable rendering", () => {
    const { assignments } = assignWorkerWorkstations(SAMPLE_IDS);

    const indexes = assignments.map((entry) => entry.slotIndex);
    expect(indexes).toEqual([...indexes].sort((a, b) => a - b));
  });

  it("hashes worker ids deterministically", () => {
    expect(hashWorkerId("sa-0-abcd1234")).toBe(
      hashWorkerId("sa-0-abcd1234"),
    );
    expect(hashWorkerId("sa-0-abcd1234")).not.toBe(
      hashWorkerId("sa-1-abcd1234"),
    );
  });

  it("handles an empty worker set", () => {
    expect(assignWorkerWorkstations([])).toEqual({
      assignments: [],
      overflow: [],
    });
  });
});
