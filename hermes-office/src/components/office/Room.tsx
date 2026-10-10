"use client";

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { PopiPresence } from "@/lib/popi";
import { resolveAtmosphere, type AtmosphereMood } from "@/lib/environment";
import type { AgentStatus } from "@/lib/hermes/types";
import {
  CEILING_BANDS,
  OFFICE_LAYOUT,
  OFFICE_PALETTE as C,
  WALL_PANELS,
} from "@/lib/office";

/* =========================================================
   SHARED MATERIALS
   Created once per component tree so the room, rack and
   workstations all share the same GPU programs.
======================================================== */

const MatteRoughness = 0.92;

function useStructuralMaterials() {
  return useMemo(
    () => ({
      floor: new THREE.MeshStandardMaterial({
        color: C.floor,
        roughness: MatteRoughness,
        metalness: 0.04,
      }),
      floorLine: new THREE.MeshBasicMaterial({ color: C.floorLine }),
      wall: new THREE.MeshStandardMaterial({
        color: C.wall,
        roughness: 0.9,
        metalness: 0.03,
      }),
      panel: new THREE.MeshStandardMaterial({
        color: C.wallPanel,
        roughness: 0.62,
        metalness: 0.24,
      }),
      trim: new THREE.MeshStandardMaterial({
        color: C.wallTrim,
        roughness: 0.6,
        metalness: 0.3,
      }),
      steel: new THREE.MeshStandardMaterial({
        color: C.steel,
        roughness: 0.45,
        metalness: 0.55,
      }),
      rug: new THREE.MeshStandardMaterial({ color: C.rug, roughness: 1 }),
    }),
    [],
  );
}

/* =========================================================
   FLOOR
======================================================== */

function FloorGrid() {
  const { floor } = OFFICE_LAYOUT;

  // Static geometry built once; the grid pitch and extents never change.
  const geometry = useMemo(() => {
    const points: number[] = [];

    // Sparse structural grid on the floor: reads as a tech floor without
    // turning into visual noise, at a fixed 2-unit pitch.
    const step = 2;
    const halfW = floor.width / 2;
    const halfD = floor.depth / 2;

    for (let x = -halfW; x <= halfW; x += step) {
      points.push(x, 0.015, floor.center[2] - halfD, x, 0.015, floor.center[2] + halfD);
    }
    for (let z = -halfD; z <= halfD; z += step) {
      points.push(-halfW, 0.015, z, halfW, 0.015, z);
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
    return g;
  }, [floor]);

  return (
    <lineSegments geometry={geometry}>
      <lineBasicMaterial color={C.floorLine} transparent opacity={0.5} />
    </lineSegments>
  );
}

/* =========================================================
   CEILING LIGHT BANDS
======================================================== */

/**
 * Structural ceiling strips. Their emissive strength is the only part driven by
 * state, so an idle room glows calmly and a busy room reads brighter.
 */
function CeilingBands({
  mood,
  presence,
  reducedMotion,
}: {
  mood: AtmosphereMood;
  presence: PopiPresence;
  reducedMotion: boolean;
}) {
  const group = useRef<THREE.Group>(null);
  const bands = useRef<Array<THREE.MeshStandardMaterial | null>>([]);

  const base = resolveAtmosphere(mood === "down" ? "OFFLINE" : "IDLE", presence);

  useFrame((state) => {
    const t = reducedMotion ? 0 : state.clock.elapsedTime;
    const strength = reducedMotion
      ? 1
      : 1 +
        Math.sin(t * 0.8) *
          (mood === "busy" || mood === "tool"
            ? 0.12
            : mood === "critical"
              ? 0.3
              : 0.04);

    for (const material of bands.current) {
      if (material) {
        material.emissiveIntensity = base.ceiling * strength;
      }
    }
  });

  return (
    <group ref={group} position={[0, OFFICE_LAYOUT.ceilingY - 0.12, 0]}>
      {CEILING_BANDS.map((z, index) => (
        <group key={z} position={[0, 0, z]}>
          <mesh>
            <boxGeometry args={[8.4, 0.1, 0.34]} />
            <meshStandardMaterial
              color={C.metal}
              roughness={0.5}
              metalness={0.4}
            />
          </mesh>
          <mesh position={[0, -0.075, 0]}>
            <boxGeometry args={[7.9, 0.03, 0.16]} />
            <meshStandardMaterial
              ref={(material) => {
                bands.current[index] = material;
              }}
              color={C.screenFrame}
              emissive={C.accent}
              emissiveIntensity={base.ceiling}
            />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/* =========================================================
   WALL DETAIL
======================================================== */

function WallPanels({ ceiling }: { ceiling: number }) {
  return (
    <group>
      {WALL_PANELS.map((panel) => (
        <group
          key={`${panel.x}-${panel.width}`}
          position={[panel.x, panel.y, OFFICE_LAYOUT.backWallZ + 0.16]}
        >
          <mesh>
            <boxGeometry args={[panel.width, panel.height, 0.1]} />
            <meshStandardMaterial
              color={C.wallPanel}
              roughness={0.6}
              metalness={0.25}
            />
          </mesh>
          <mesh position={[0, 0, 0.055]}>
            <planeGeometry args={[panel.width - 0.24, panel.height - 0.24]} />
            <meshStandardMaterial
              color={C.screenFrame}
              emissive={C.accentSoft}
              emissiveIntensity={ceiling * 0.5}
              roughness={0.4}
            />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/** Tech shelf under the back wall, loaded with crates and a cable tray. */
function BackShelf() {
  const crates = [
    { x: -1.15, w: 0.7, h: 0.34 },
    { x: -0.3, w: 0.5, h: 0.5 },
    { x: 0.45, w: 0.85, h: 0.4 },
    { x: 1.5, w: 0.45, h: 0.6 },
  ];

  return (
    <group position={[-3.6, 1.35, OFFICE_LAYOUT.backWallZ + 0.55]}>
      <mesh castShadow receiveShadow>
        <boxGeometry args={[4.6, 0.08, 0.55]} />
        <meshStandardMaterial color={C.wallTrim} roughness={0.6} metalness={0.3} />
      </mesh>

      {crates.map((crate) => (
        <mesh
          key={crate.x}
          position={[crate.x, crate.h / 2 + 0.04, 0]}
          castShadow
        >
          <boxGeometry args={[crate.w, crate.h, 0.42]} />
          <meshStandardMaterial
            color={crate.h > 0.45 ? C.wallPanel : C.metalLight}
            roughness={0.7}
            metalness={0.2}
          />
        </mesh>
      ))}

      <mesh position={[0, 0.62, 0]} castShadow>
        <boxGeometry args={[4.2, 0.05, 0.3]} />
        <meshStandardMaterial
          color={C.metal}
          emissive={C.accent}
          emissiveIntensity={0.25}
          roughness={0.5}
        />
      </mesh>
    </group>
  );
}

/**
 * Window band on the left wall. A dark glazed pane plus an emissive sky strip
 * gives the room an outside without any HDR asset.
 */
function WindowBay() {
  const { position, size } = OFFICE_LAYOUT.window;

  return (
    <group position={position}>
      <mesh position={[0, 0, 0]}>
        <boxGeometry args={[size[0], size[1], size[2]]} />
        <meshStandardMaterial
          color={C.glass}
          emissive={C.accentSoft}
          emissiveIntensity={0.16}
          roughness={0.15}
          metalness={0.1}
        />
      </mesh>
      {/* Mullions */}
      {[-0.38, 0, 0.38].map((z) => (
        <mesh key={z} position={[0, 0, z * 1.6]}>
          <boxGeometry args={[size[0] + 0.06, size[1] + 0.06, 0.05]} />
          <meshStandardMaterial color={C.wallTrim} roughness={0.5} metalness={0.4} />
        </mesh>
      ))}
      <mesh position={[0, 0, 0]}>
        <boxGeometry args={[size[0] + 0.1, 0.08, size[2] + 0.1]} />
        <meshStandardMaterial color={C.wallTrim} roughness={0.5} metalness={0.4} />
      </mesh>
      <mesh position={[0, -size[1] / 2 - 0.05, 0]}>
        <boxGeometry args={[size[0] + 0.1, 0.1, size[2] + 0.1]} />
        <meshStandardMaterial color={C.wallTrim} roughness={0.5} metalness={0.4} />
      </mesh>
    </group>
  );
}

/* =========================================================
   ROOM
======================================================== */

export function OfficeRoom({
  status,
  presence,
  reducedMotion,
}: {
  status: AgentStatus;
  presence: PopiPresence;
  reducedMotion: boolean;
}) {
  const materials = useStructuralMaterials();
  const atmosphere = resolveAtmosphere(status, presence);
  const {
    floor,
    backWallZ,
    leftWallX,
    rightWallX,
    wallHeight,
    wallThickness,
    ceilingY,
    rug,
  } = OFFICE_LAYOUT;

  const floorCenter = floor.center;
  const rugCenter = rug.center;
  const backZ = backWallZ + wallThickness / 2;
  const leftX = leftWallX + wallThickness / 2;
  const rightX = rightWallX - wallThickness / 2;

  return (
    <group>
      {/* FLOOR */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={floorCenter} receiveShadow>
        <planeGeometry args={[floor.width, floor.depth]} />
        <primitive object={materials.floor} attach="material" />
      </mesh>

      <FloorGrid />

      {/* RUG â€” grounds Popi's zone and breaks up the floor plane. */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[rugCenter[0], 0.012, rugCenter[2]]}
        receiveShadow
      >
        <planeGeometry args={[rug.width, rug.depth]} />
        <primitive object={materials.rug} attach="material" />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[rugCenter[0], 0.014, rugCenter[2]]}>
        <ringGeometry args={[2.2, 2.32, 48]} />
        <meshBasicMaterial color={C.wallTrim} transparent opacity={0.5} />
      </mesh>

      {/* WALLS */}
      <mesh position={[floorCenter[0], wallHeight / 2, backZ]} receiveShadow>
        <boxGeometry args={[24, wallHeight, wallThickness]} />
        <primitive object={materials.wall} attach="material" />
      </mesh>
      <mesh position={[leftX, wallHeight / 2, floorCenter[2]]} receiveShadow>
        <boxGeometry args={[wallThickness, wallHeight, floor.depth]} />
        <primitive object={materials.wall} attach="material" />
      </mesh>
      <mesh position={[rightX, wallHeight / 2, floorCenter[2]]} receiveShadow>
        <boxGeometry args={[wallThickness, wallHeight, floor.depth]} />
        <primitive object={materials.wall} attach="material" />
      </mesh>

      {/* CEILING */}
      <mesh position={[floorCenter[0], ceilingY, floorCenter[2]]}>
        <boxGeometry args={[24, 0.2, floor.depth]} />
        <primitive object={materials.panel} attach="material" />
      </mesh>

      {/* BASEBOARDS + CORNER TRIM */}
      <mesh position={[floorCenter[0], 0.14, backZ + wallThickness / 2]} receiveShadow>
        <boxGeometry args={[24, 0.28, 0.1]} />
        <primitive object={materials.trim} attach="material" />
      </mesh>
      <mesh position={[leftX + wallThickness / 2, 0.14, floorCenter[2]]} receiveShadow>
        <boxGeometry args={[0.1, 0.28, floor.depth]} />
        <primitive object={materials.trim} attach="material" />
      </mesh>
      <mesh position={[rightX - wallThickness / 2, 0.14, floorCenter[2]]} receiveShadow>
        <boxGeometry args={[0.1, 0.28, floor.depth]} />
        <primitive object={materials.trim} attach="material" />
      </mesh>

      {/* Corner pillars â€” asymmetric anchors that break the long walls. */}
      {[
        [leftX + wallThickness, -4.6],
        [rightX - wallThickness, -4.6],
        [rightX - wallThickness, 6.2],
      ].map(([x, z]) => (
        <mesh key={`${x}-${z}`} position={[x, wallHeight / 2, z]} castShadow receiveShadow>
          <boxGeometry args={[0.34, wallHeight, 0.34]} />
          <primitive object={materials.trim} attach="material" />
        </mesh>
      ))}

      {/* Emissive crown line where wall meets ceiling. */}
      <mesh position={[floorCenter[0], ceilingY - 0.16, backZ + wallThickness / 2]}>
        <boxGeometry args={[23.6, 0.06, 0.05]} />
        <meshStandardMaterial
          color={C.wallTrim}
          emissive={C.accent}
          emissiveIntensity={atmosphere.rim}
        />
      </mesh>
      <mesh position={[leftX + wallThickness / 2, ceilingY - 0.16, floorCenter[2]]}>
        <boxGeometry args={[0.05, 0.06, floor.depth - 0.6]} />
        <meshStandardMaterial
          color={C.wallTrim}
          emissive={C.accent}
          emissiveIntensity={atmosphere.rim}
        />
      </mesh>

      <CeilingBands
        mood={atmosphere.mood}
        presence={presence}
        reducedMotion={reducedMotion}
      />
      <WallPanels ceiling={atmosphere.ceiling} />
      <BackShelf />
      <WindowBay />
    </group>
  );
}
