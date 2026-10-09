"use client";

import { useFrame } from "@react-three/fiber";
import { memo, useRef } from "react";
import * as THREE from "three";
import type { AgentStatus } from "@/lib/hermes/types";
import { getScreenColor, getScreenGlow } from "@/lib/popi";
import { OFFICE_PALETTE as C, type WorkstationSpec } from "@/lib/office";
import { PopiAgent } from "./PopiAgent";

const AGENT_OFFSET: [number, number, number] = [0, 0, 1.15];

function Desk() {
  return (
    <group>
      <mesh position={[0, 0.72, -0.2]} castShadow receiveShadow>
        <boxGeometry args={[4, 0.14, 1.6]} />
        <meshStandardMaterial
          color={C.desk}
          roughness={0.55}
          metalness={0.25}
        />
      </mesh>

      <mesh position={[0, 0.72, 0.59]} castShadow>
        <boxGeometry args={[4, 0.14, 0.06]} />
        <meshStandardMaterial
          color={C.deskEdge}
          emissive={C.accent}
          emissiveIntensity={0.18}
          roughness={0.4}
          metalness={0.3}
        />
      </mesh>

      {[-1.8, 1.8].map((x) => (
        <mesh
          key={x}
          position={[x, 0.36, -0.2]}
          castShadow
          receiveShadow
        >
          <boxGeometry args={[0.14, 0.72, 1.4]} />
          <meshStandardMaterial
            color={C.metal}
            roughness={0.6}
            metalness={0.35}
          />
        </mesh>
      ))}

      <mesh position={[0, 0.36, -0.9]} castShadow>
        <boxGeometry args={[3.6, 0.72, 0.08]} />
        <meshStandardMaterial color={C.metal} roughness={0.6} />
      </mesh>
    </group>
  );
}

function Chair() {
  const arms = [0, 1, 2, 3, 4];

  return (
    <group position={[-0.1, 0, 2.05]}>
      <mesh position={[0, 0.5, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.82, 0.12, 0.8]} />
        <meshStandardMaterial color={C.metalLight} roughness={0.7} />
      </mesh>

      <mesh
        position={[0, 0.96, 0.32]}
        rotation={[-0.14, 0, 0]}
        castShadow
      >
        <boxGeometry args={[0.82, 0.9, 0.12]} />
        <meshStandardMaterial color={C.metalLight} roughness={0.7} />
      </mesh>

      <mesh position={[0, 0.28, 0]}>
        <cylinderGeometry args={[0.06, 0.06, 0.46, 12]} />
        <meshStandardMaterial color={C.metal} metalness={0.5} />
      </mesh>

      <mesh position={[0, 0.06, 0]}>
        <cylinderGeometry args={[0.09, 0.09, 0.08, 12]} />
        <meshStandardMaterial color={C.metal} metalness={0.5} />
      </mesh>

      {arms.map((index) => {
        const angle = (index / arms.length) * Math.PI * 2;

        return (
          <mesh
            key={index}
            position={[
              Math.sin(angle) * 0.22,
              0.08,
              Math.cos(angle) * 0.22,
            ]}
            rotation={[0, angle, 0]}
            castShadow
          >
            <boxGeometry args={[0.09, 0.06, 0.44]} />
            <meshStandardMaterial color={C.metalLight} />
          </mesh>
        );
      })}
    </group>
  );
}

const LINE_WIDTHS = [1.5, 0.9, 1.25, 0.7, 1.05];

function TerminalLines({ active }: { active: boolean }) {
  const group = useRef<THREE.Group>(null);

  useFrame((state) => {
    if (!group.current) return;

    group.current.visible = active;

    if (!active) return;

    const t = state.clock.elapsedTime;

    group.current.children.forEach((line, index) => {
      const span = 1.0;
      const raw = index * 0.24 - t * 0.4;
      const wrapped = ((raw % span) + span) % span;
      line.position.y = wrapped - span / 2;
    });
  });

  return (
    <group ref={group} position={[0, 1.15, 0.09]}>
      {LINE_WIDTHS.map((width, index) => (
        <mesh key={index} position={[-1 + width / 2, 0, 0]}>
          <boxGeometry args={[width, 0.05, 0.02]} />
          <meshBasicMaterial color="#4ade80" />
        </mesh>
      ))}
    </group>
  );
}

function Monitor({ status }: { status: AgentStatus }) {
  const screen = useRef<THREE.MeshStandardMaterial>(null);

  useFrame((state) => {
    if (!screen.current) return;

    screen.current.emissiveIntensity = getScreenGlow(
      status,
      state.clock.elapsedTime,
    );
  });

  return (
    <group position={[0, 0.72, -0.85]}>
      <mesh position={[0, 1.15, 0]} castShadow>
        <boxGeometry args={[2.3, 1.36, 0.12]} />
        <meshStandardMaterial
          color={C.screenFrame}
          roughness={0.4}
          metalness={0.3}
        />
      </mesh>

      <mesh position={[0, 1.15, 0.065]}>
        <planeGeometry args={[2.14, 1.2]} />
        <meshStandardMaterial
          ref={screen}
          color={C.screenFrame}
          emissive={getScreenColor(status)}
          emissiveIntensity={0.4}
          roughness={0.3}
        />
      </mesh>

      <TerminalLines active={status === "TERMINAL"} />

      <mesh position={[0, 0.35, 0]} castShadow>
        <boxGeometry args={[0.12, 0.62, 0.12]} />
        <meshStandardMaterial color={C.metalLight} metalness={0.4} />
      </mesh>

      <mesh position={[0, 0.05, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.82, 0.1, 0.46]} />
        <meshStandardMaterial color={C.metalLight} metalness={0.4} />
      </mesh>
    </group>
  );
}

function DeskProps({ status }: { status: AgentStatus }) {
  return (
    <group>
      <mesh position={[0, 0.82, 0.24]} castShadow>
        <boxGeometry args={[1.3, 0.05, 0.46]} />
        <meshStandardMaterial
          color={C.metalLight}
          roughness={0.5}
          metalness={0.3}
        />
      </mesh>

      <mesh position={[0.92, 0.81, 0.28]} castShadow>
        <boxGeometry args={[0.18, 0.05, 0.28]} />
        <meshStandardMaterial color={C.metalLight} />
      </mesh>

      <group position={[-1.35, 0.72, 0.18]}>
        <mesh position={[0, 0.11, 0]} castShadow>
          <cylinderGeometry args={[0.11, 0.09, 0.24, 16]} />
          <meshStandardMaterial color={C.mug} roughness={0.5} />
        </mesh>
        <mesh position={[0.09, 0.13, 0]}>
          <torusGeometry args={[0.05, 0.014, 8, 14]} />
          <meshStandardMaterial color={C.mug} roughness={0.5} />
        </mesh>
      </group>

      <group position={[1.6, 0.72, -0.05]}>
        <mesh position={[0, 0.1, 0]} castShadow>
          <cylinderGeometry args={[0.13, 0.1, 0.2, 12]} />
          <meshStandardMaterial color={C.metalLight} roughness={0.8} />
        </mesh>
        <mesh position={[0, 0.34, 0]} castShadow>
          <icosahedronGeometry args={[0.22, 0]} />
          <meshStandardMaterial
            color={C.plant}
            flatShading
            roughness={0.8}
          />
        </mesh>
        <mesh position={[0.12, 0.24, 0.08]} castShadow>
          <icosahedronGeometry args={[0.12, 0]} />
          <meshStandardMaterial
            color={C.plantDark}
            flatShading
            roughness={0.8}
          />
        </mesh>
      </group>

      <group position={[-1.75, 0.72, -0.42]}>
        <mesh position={[0, 0.03, 0]} castShadow>
          <cylinderGeometry args={[0.18, 0.2, 0.06, 16]} />
          <meshStandardMaterial color={C.metal} metalness={0.5} />
        </mesh>
        <mesh position={[0, 0.42, 0]} rotation={[0.2, 0, 0]} castShadow>
          <cylinderGeometry args={[0.025, 0.025, 0.8, 10]} />
          <meshStandardMaterial color={C.metalLight} metalness={0.5} />
        </mesh>
        <mesh position={[0, 0.82, -0.12]} rotation={[0.5, 0, 0]}>
          <coneGeometry args={[0.16, 0.22, 16, 1, true]} />
          <meshStandardMaterial
            color={C.metalLight}
            side={THREE.DoubleSide}
            roughness={0.6}
          />
        </mesh>
        <pointLight
          position={[0, 0.7, -0.12]}
          color={C.warm}
          intensity={2.2}
          distance={4}
          decay={2}
        />
      </group>

      <group position={[2.55, 0, -0.1]}>
        <mesh position={[0, 0.42, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.48, 0.84, 0.78]} />
          <meshStandardMaterial
            color={C.metal}
            roughness={0.5}
            metalness={0.4}
          />
        </mesh>
        <mesh position={[0, 0.5, 0.395]}>
          <boxGeometry args={[0.06, 0.5, 0.02]} />
          <meshStandardMaterial
            color={C.screenFrame}
            emissive={getScreenColor(status)}
            emissiveIntensity={1.2}
          />
        </mesh>
        <mesh position={[0, 0.14, 0.395]}>
          <boxGeometry args={[0.3, 0.06, 0.02]} />
          <meshStandardMaterial
            color={C.screenFrame}
            emissive={C.accent}
            emissiveIntensity={0.6}
          />
        </mesh>
      </group>
    </group>
  );
}

export const Workstation = memo(function Workstation({
  spec,
  status,
}: {
  spec: WorkstationSpec;
  status: AgentStatus;
}) {
  return (
    <group position={spec.position} rotation={[0, spec.rotationY, 0]}>
      <Desk />
      <Chair />
      <Monitor status={status} />
      <DeskProps status={status} />
      <group position={AGENT_OFFSET}>
        <PopiAgent status={status} />
      </group>
    </group>
  );
});
