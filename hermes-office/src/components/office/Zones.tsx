"use client";

/**
 * Architectural zones for the Phase L office expansion.
 *
 * Everything here is placed from `lib/office.ts` data, so the meeting table,
 * lounge furniture, partitions and walkways are provably inside the room and
 * clear of every workstation rather than being hand-fudged magic numbers. The
 * components are static (no per-frame React state) to keep the scene cheap.
 */
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import {
  COLLABORATION_BOARD,
  COLLABORATION_CHAIRS,
  COLLABORATION_TABLE,
  LOUNGE_FURNITURE,
  OFFICE_LAYOUT,
  OFFICE_PALETTE as C,
  OFFICE_PARTITIONS,
  OFFICE_WALKWAYS,
  OFFICE_ZONES,
} from "@/lib/office";
import { createBadgeTexture } from "./label-texture";

/* =========================================================
   ZONE FLOOR PLATES + SIGNS
======================================================== */

/** Subtle accent plate per zone so the office reads as distinct rooms. */
function ZoneFloors() {
  const zones = useMemo(
    () =>
      OFFICE_ZONES.filter(
        (zone) => zone.id !== "primary" && zone.id !== "infrastructure",
      ).map((zone, index) => ({
        zone,
        y: 0.006 + index * 0.0006,
        edges: new THREE.EdgesGeometry(
          new THREE.PlaneGeometry(zone.size[0], zone.size[1]),
        ),
      })),
    [],
  );

  useEffect(
    () => () => {
      for (const entry of zones) entry.edges.dispose();
    },
    [zones],
  );

  return (
    <group>
      {zones.map(({ zone, y, edges }) => (
        <group
          key={zone.id}
          position={[zone.center[0], y, zone.center[2]]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <mesh receiveShadow>
            <planeGeometry args={[zone.size[0], zone.size[1]]} />
            <meshStandardMaterial
              color={zone.accent}
              transparent
              opacity={0.06}
              roughness={1}
              metalness={0}
            />
          </mesh>
          <lineSegments geometry={edges} position={[0, 0, 0.002]}>
            <lineBasicMaterial color={zone.accent} transparent opacity={0.35} />
          </lineSegments>
        </group>
      ))}
    </group>
  );
}

/** Hanging wayfinding sign above each (non-primary) zone. */
function ZoneSign({
  text,
  color,
  position,
}: {
  text: string;
  color: string;
  position: [number, number, number];
}) {
  const material = useRef<THREE.SpriteMaterial>(null);

  useEffect(() => {
    const texture = createBadgeTexture(text, color);
    const current = material.current;
    if (current) {
      current.map = texture;
      current.needsUpdate = true;
    }
    return () => {
      texture.dispose();
    };
  }, [text, color]);

  return (
    <sprite position={position} scale={[3.4, 0.85, 1]}>
      <spriteMaterial
        ref={material}
        transparent
        depthTest={false}
        depthWrite={false}
        toneMapped={false}
      />
    </sprite>
  );
}

function ZoneSigns() {
  return (
    <group>
      {OFFICE_ZONES.filter((zone) => zone.id !== "primary").map((zone) => (
        <ZoneSign
          key={zone.id}
          text={zone.label}
          color={zone.accent}
          position={[zone.center[0], OFFICE_LAYOUT.wallHeight - 1.0, zone.center[2]]}
        />
      ))}
    </group>
  );
}

/* =========================================================
   COLLABORATION AREA
======================================================== */

function MeetingChair({ position, rotationY }: { position: [number, number, number]; rotationY: number }) {
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <mesh position={[0, 0.46, 0]} castShadow>
        <boxGeometry args={[0.5, 0.08, 0.5]} />
        <meshStandardMaterial color={C.violet} roughness={0.7} />
      </mesh>
      <mesh position={[0, 0.72, -0.24]} castShadow>
        <boxGeometry args={[0.5, 0.5, 0.08]} />
        <meshStandardMaterial color={C.metalLight} roughness={0.6} metalness={0.2} />
      </mesh>
      {[
        [-0.2, -0.2],
        [0.2, -0.2],
        [-0.2, 0.2],
        [0.2, 0.2],
      ].map(([x, z]) => (
        <mesh key={`${x}-${z}`} position={[x, 0.2, z]}>
          <cylinderGeometry args={[0.03, 0.03, 0.4, 8]} />
          <meshStandardMaterial color={C.metal} metalness={0.5} />
        </mesh>
      ))}
    </group>
  );
}

function MeetingArea() {
  const table = COLLABORATION_TABLE;

  return (
    <group>
      {/* Round table */}
      <group position={table.position}>
        <mesh position={[0, table.height, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[table.radius, table.radius, 0.08, 32]} />
          <meshStandardMaterial color={C.desk} roughness={0.5} metalness={0.25} />
        </mesh>
        <mesh position={[0, table.height / 2, 0]}>
          <cylinderGeometry args={[0.16, 0.22, table.height, 16]} />
          <meshStandardMaterial color={C.metal} metalness={0.5} />
        </mesh>
        <mesh position={[0, 0.02, 0]}>
          <cylinderGeometry args={[0.5, 0.5, 0.04, 24]} />
          <meshStandardMaterial color={C.metal} metalness={0.4} />
        </mesh>
        {/* Table holo-disc: a quiet accent, not tied to live state. */}
        <mesh position={[0, table.height + 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[table.radius * 0.45, table.radius * 0.5, 40]} />
          <meshBasicMaterial color={C.violet} transparent opacity={0.5} />
        </mesh>
      </group>

      {COLLABORATION_CHAIRS.map((seat, index) => {
        const angle = Math.atan2(
          seat[2] - table.position[2],
          seat[0] - table.position[0],
        );
        return (
          <MeetingChair
            key={index}
            position={seat}
            rotationY={-angle + Math.PI / 2}
          />
        );
      })}

      {/* Whiteboard on the right wall. */}
      <group position={COLLABORATION_BOARD.position}>
        <mesh>
          <boxGeometry args={COLLABORATION_BOARD.size} />
          <meshStandardMaterial color={C.wallTrim} roughness={0.5} metalness={0.3} />
        </mesh>
        <mesh position={[-0.05, 0, 0]} rotation={[0, -Math.PI / 2, 0]}>
          <planeGeometry args={[COLLABORATION_BOARD.size[2] - 0.3, COLLABORATION_BOARD.size[1] - 0.3]} />
          <meshStandardMaterial
            color={C.screenFrame}
            emissive={C.accentSoft}
            emissiveIntensity={0.22}
            roughness={0.3}
          />
        </mesh>
      </group>
    </group>
  );
}

/* =========================================================
   LOUNGE AREA
======================================================== */

function Plant({ position, scale = 1 }: { position: [number, number, number]; scale?: number }) {
  return (
    <group position={position} scale={scale}>
      <mesh position={[0, 0.2, 0]} castShadow>
        <cylinderGeometry args={[0.24, 0.18, 0.4, 12]} />
        <meshStandardMaterial color={C.metal} roughness={0.7} metalness={0.2} />
      </mesh>
      <mesh position={[0, 0.62, 0]} castShadow>
        <sphereGeometry args={[0.36, 12, 12]} />
        <meshStandardMaterial color={C.plant} roughness={0.85} />
      </mesh>
      <mesh position={[0.16, 0.9, 0.06]} castShadow>
        <sphereGeometry args={[0.24, 12, 12]} />
        <meshStandardMaterial color={C.plantDark} roughness={0.85} />
      </mesh>
    </group>
  );
}

function LoungeArea() {
  const { sofa, table, plants, cooler } = LOUNGE_FURNITURE;

  return (
    <group>
      {/* Sofa against the far side of the lounge. */}
      <group position={sofa.position}>
        <mesh position={[0, 0.28, 0]} castShadow receiveShadow>
          <boxGeometry args={[sofa.width, 0.42, 0.95]} />
          <meshStandardMaterial color={C.violet} roughness={0.9} />
        </mesh>
        <mesh position={[0, 0.62, -0.38]} castShadow>
          <boxGeometry args={[sofa.width, 0.66, 0.22]} />
          <meshStandardMaterial color={C.violet} roughness={0.9} />
        </mesh>
        {[-sofa.width / 2 + 0.12, sofa.width / 2 - 0.12].map((x) => (
          <mesh key={x} position={[x, 0.5, 0]} castShadow>
            <boxGeometry args={[0.22, 0.5, 0.95]} />
            <meshStandardMaterial color={C.violet} roughness={0.9} />
          </mesh>
        ))}
      </group>

      {/* Coffee table. */}
      <group position={table.position}>
        <mesh position={[0, 0.42, 0]} castShadow>
          <cylinderGeometry args={[table.radius, table.radius, 0.06, 24]} />
          <meshStandardMaterial color={C.desk} roughness={0.5} metalness={0.3} />
        </mesh>
        <mesh position={[0, 0.21, 0]}>
          <cylinderGeometry args={[0.05, 0.05, 0.42, 12]} />
          <meshStandardMaterial color={C.metal} metalness={0.5} />
        </mesh>
      </group>

      {/* Water cooler. */}
      <group position={cooler.position}>
        <mesh position={[0, 0.55, 0]} castShadow>
          <boxGeometry args={[0.5, 1.1, 0.5]} />
          <meshStandardMaterial color={C.metalLight} roughness={0.5} metalness={0.3} />
        </mesh>
        <mesh position={[0, 1.25, 0]} castShadow>
          <cylinderGeometry args={[0.22, 0.22, 0.5, 16]} />
          <meshStandardMaterial color={C.accentSoft} transparent opacity={0.7} roughness={0.2} />
        </mesh>
      </group>

      {plants.map((p, index) => (
        <Plant key={index} position={p} scale={index === 0 ? 1 : 0.85} />
      ))}
    </group>
  );
}

/* =========================================================
   PARTITIONS + WALKWAYS
======================================================== */

function Partitions() {
  return (
    <group>
      {OFFICE_PARTITIONS.map((part, index) => (
        <group
          key={index}
          position={[part.position[0], part.size[1] / 2, part.position[2]]}
          rotation={[0, part.rotationY, 0]}
        >
          <mesh castShadow receiveShadow>
            <boxGeometry args={part.size} />
            <meshStandardMaterial color={C.wallPanel} roughness={0.7} metalness={0.2} />
          </mesh>
          {/* Accent cap along the top edge. */}
          <mesh position={[0, part.size[1] / 2 - 0.04, 0]}>
            <boxGeometry args={[part.size[0] + 0.06, 0.05, part.size[2] + 0.06]} />
            <meshStandardMaterial
              color={C.accent}
              emissive={C.accent}
              emissiveIntensity={0.35}
            />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function Walkways() {
  return (
    <group>
      {OFFICE_WALKWAYS.map((strip, index) => (
        <mesh
          key={index}
          rotation={[-Math.PI / 2, 0, 0]}
          position={[strip.position[0], 0.02, strip.position[2]]}
        >
          <planeGeometry args={strip.size} />
          <meshBasicMaterial color={C.floorLine} transparent opacity={0.55} />
        </mesh>
      ))}
    </group>
  );
}

/* =========================================================
   EXPORT
======================================================== */

export function OfficeZones() {
  return (
    <group>
      <ZoneFloors />
      <Walkways />
      <Partitions />
      <MeetingArea />
      <LoungeArea />
      <ZoneSigns />
    </group>
  );
}
