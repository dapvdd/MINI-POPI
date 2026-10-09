"use client";

import { OFFICE_LAYOUT, OFFICE_PALETTE as C } from "@/lib/office";

export function OfficeRoom() {
  const { floor, backWallZ, leftWallX, wallHeight, wallThickness, rug } =
    OFFICE_LAYOUT;

  const floorCenter = floor.center;
  const rugCenter = rug.center;

  return (
    <group>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={floorCenter}
        receiveShadow
      >
        <planeGeometry args={[floor.width, floor.depth]} />
        <meshStandardMaterial
          color={C.floor}
          roughness={0.95}
          metalness={0.05}
        />
      </mesh>

      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[rugCenter[0], 0.01, rugCenter[2]]}
        receiveShadow
      >
        <planeGeometry args={[rug.width, rug.depth]} />
        <meshStandardMaterial color={C.rug} roughness={1} />
      </mesh>

      <mesh
        position={[floorCenter[0], wallHeight / 2, backWallZ]}
        receiveShadow
      >
        <boxGeometry args={[floor.width, wallHeight, wallThickness]} />
        <meshStandardMaterial color={C.wall} roughness={0.9} />
      </mesh>

      <mesh
        position={[leftWallX, wallHeight / 2, floorCenter[2]]}
        receiveShadow
      >
        <boxGeometry args={[wallThickness, wallHeight, floor.depth]} />
        <meshStandardMaterial color={C.wall} roughness={0.9} />
      </mesh>

      <mesh
        position={[floorCenter[0], 0.14, backWallZ + wallThickness]}
        receiveShadow
      >
        <boxGeometry args={[floor.width, 0.28, 0.12]} />
        <meshStandardMaterial color={C.wallTrim} roughness={0.8} />
      </mesh>

      <mesh
        position={[leftWallX + wallThickness, 0.14, floorCenter[2]]}
        receiveShadow
      >
        <boxGeometry args={[0.12, 0.28, floor.depth]} />
        <meshStandardMaterial color={C.wallTrim} roughness={0.8} />
      </mesh>

      <mesh
        position={[floorCenter[0], 3.3, backWallZ + wallThickness + 0.02]}
      >
        <boxGeometry args={[floor.width - 0.6, 0.06, 0.04]} />
        <meshStandardMaterial
          color={C.wallTrim}
          emissive={C.accent}
          emissiveIntensity={0.9}
        />
      </mesh>

      <mesh
        position={[leftWallX + wallThickness + 0.02, 3.3, floorCenter[2]]}
      >
        <boxGeometry args={[0.04, 0.06, floor.depth - 0.6]} />
        <meshStandardMaterial
          color={C.wallTrim}
          emissive={C.accent}
          emissiveIntensity={0.9}
        />
      </mesh>

      {[-3, 0, 3].map((x) => (
        <mesh key={x} position={[x, 4.15, -1.5]}>
          <boxGeometry args={[2.4, 0.08, 0.5]} />
          <meshStandardMaterial
            color={C.wallTrim}
            emissive="#dbeafe"
            emissiveIntensity={0.8}
          />
        </mesh>
      ))}
    </group>
  );
}
