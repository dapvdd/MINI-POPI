import { describe, expect, it } from "vitest";
import {
  assignWorkerWorkstations,
  hashWorkerId,
  isWithinOfficeBounds,
  MAX_WORKER_WORKSTATIONS,
  OFFICE_LAYOUT,
  OFFICE_PALETTE,
  POPI_WORKSTATION,
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
