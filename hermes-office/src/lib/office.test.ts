import { describe, expect, it } from "vitest";
import {
  OFFICE_LAYOUT,
  OFFICE_PALETTE,
  POPI_WORKSTATION,
  workerWorkstationSlot,
} from "./office";

function expectFiniteVec3(value: [number, number, number]) {
  expect(value).toHaveLength(3);
  for (const component of value) {
    expect(Number.isFinite(component)).toBe(true);
  }
}

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

  it("reserves deterministic, distinct slots for future workers", () => {
    const slots = [0, 1, 2, 3].map(workerWorkstationSlot);
    const ids = new Set(slots.map((slot) => slot.id));
    const positions = new Set(
      slots.map((slot) => slot.position.join(",")),
    );

    expect(ids.size).toBe(slots.length);
    expect(positions.size).toBe(slots.length);

    for (const slot of slots) {
      expectFiniteVec3(slot.position);
      expect(Number.isFinite(slot.rotationY)).toBe(true);
      expect(slot.position[1]).toBe(0);
      expect(slot.position[0]).not.toBe(0);
    }
  });

  it("exposes a complete color palette", () => {
    for (const color of Object.values(OFFICE_PALETTE)) {
      expect(color).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});
