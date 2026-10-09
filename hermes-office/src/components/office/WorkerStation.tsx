"use client";

import { useFrame } from "@react-three/fiber";
import { memo, useEffect, useRef } from "react";
import * as THREE from "three";
import {
  isTerminalWorkerStatus,
  type WorkerState,
} from "@/lib/hermes/workers";
import {
  formatWorkerGoal,
  getWorkerStatusVisual,
} from "@/lib/worker-visuals";
import { createWorkerLabelTexture } from "./label-texture";
import { OFFICE_PALETTE as C, type WorkstationSpec } from "@/lib/office";

const BOT_OFFSET: [number, number, number] = [0, 0, 0.95];

function WorkerDesk() {
  return (
    <group>
      <mesh position={[0, 0.7, 0]} castShadow receiveShadow>
        <boxGeometry args={[2.4, 0.1, 1.2]} />
        <meshStandardMaterial
          color={C.desk}
          roughness={0.55}
          metalness={0.25}
        />
      </mesh>

      {[-1.1, 1.1].map((x) => (
        <mesh key={x} position={[x, 0.35, 0]} castShadow>
          <boxGeometry args={[0.1, 0.7, 1.0]} />
          <meshStandardMaterial
            color={C.metal}
            roughness={0.6}
            metalness={0.3}
          />
        </mesh>
      ))}

      <mesh position={[0, 0.76, 0.15]} castShadow>
        <boxGeometry args={[0.6, 0.04, 0.26]} />
        <meshStandardMaterial color={C.metalLight} roughness={0.5} />
      </mesh>
    </group>
  );
}

function WorkerMonitor({ color }: { color: string }) {
  return (
    <group position={[0, 0.7, -0.42]}>
      <mesh position={[0, 0.03, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.5, 0.06, 0.3]} />
        <meshStandardMaterial color={C.metalLight} metalness={0.4} />
      </mesh>
      <mesh position={[0, 0.2, 0]} castShadow>
        <boxGeometry args={[0.08, 0.34, 0.08]} />
        <meshStandardMaterial color={C.metalLight} metalness={0.4} />
      </mesh>
      <mesh position={[0, 0.62, 0]} castShadow>
        <boxGeometry args={[1.1, 0.72, 0.08]} />
        <meshStandardMaterial
          color={C.screenFrame}
          roughness={0.4}
          metalness={0.3}
        />
      </mesh>
      <mesh position={[0, 0.62, 0.045]}>
        <planeGeometry args={[0.98, 0.6]} />
        <meshStandardMaterial
          color={C.screenFrame}
          emissive={color}
          emissiveIntensity={0.55}
          roughness={0.3}
        />
      </mesh>
    </group>
  );
}

function WorkerStool() {
  return (
    <group position={[0, 0, 1.05]}>
      <mesh position={[0, 0.32, 0]} castShadow>
        <cylinderGeometry args={[0.26, 0.26, 0.08, 16]} />
        <meshStandardMaterial color={C.metalLight} roughness={0.7} />
      </mesh>
      <mesh position={[0, 0.16, 0]}>
        <cylinderGeometry args={[0.05, 0.05, 0.32, 12]} />
        <meshStandardMaterial color={C.metal} metalness={0.5} />
      </mesh>
      <mesh position={[0, 0.02, 0]}>
        <cylinderGeometry args={[0.22, 0.22, 0.04, 16]} />
        <meshStandardMaterial color={C.metal} metalness={0.5} />
      </mesh>
    </group>
  );
}

function WorkerBot({
  color,
  active,
  terminal,
}: {
  color: string;
  active: boolean;
  terminal: boolean;
}) {
  const root = useRef<THREE.Group>(null);
  const antenna = useRef<THREE.MeshStandardMaterial>(null);
  const armLeft = useRef<THREE.Group>(null);
  const armRight = useRef<THREE.Group>(null);

  useFrame((state) => {
    const group = root.current;

    if (!group) {
      return;
    }

    const t = state.clock.elapsedTime;

    if (active) {
      group.position.y = 0.05 + Math.abs(Math.sin(t * 3.2)) * 0.05;
      group.rotation.z = Math.sin(t * 2.4) * 0.03;

      if (antenna.current) {
        antenna.current.emissiveIntensity =
          1.3 + Math.sin(t * 7) * 0.7;
      }

      if (armLeft.current) {
        armLeft.current.rotation.x = Math.sin(t * 9) * 0.55;
      }

      if (armRight.current) {
        armRight.current.rotation.x =
          Math.sin(t * 9 + Math.PI) * 0.55;
      }

      return;
    }

    group.position.y = terminal ? 0.05 : 0.05 + Math.sin(t * 1.6) * 0.02;
    group.rotation.z = terminal ? 0 : Math.sin(t) * 0.02;

    if (antenna.current) {
      antenna.current.emissiveIntensity = terminal
        ? 0.5
        : 0.6 + Math.sin(t * 2) * 0.15;
    }

    if (armLeft.current) {
      armLeft.current.rotation.x = 0;
    }

    if (armRight.current) {
      armRight.current.rotation.x = 0;
    }
  });

  return (
    <group ref={root} position={[0, 0.05, 0]}>
      <mesh position={[0, 0.05, 0]} castShadow>
        <cylinderGeometry args={[0.2, 0.24, 0.1, 16]} />
        <meshStandardMaterial
          color={C.metal}
          metalness={0.5}
          roughness={0.5}
        />
      </mesh>

      <mesh position={[0, 0.5, 0]} castShadow>
        <boxGeometry args={[0.52, 0.62, 0.42]} />
        <meshStandardMaterial
          color={color}
          roughness={0.45}
          metalness={0.15}
        />
      </mesh>

      <mesh position={[0, 0.52, -0.215]}>
        <boxGeometry args={[0.26, 0.08, 0.02]} />
        <meshStandardMaterial
          color={C.screenFrame}
          emissive={color}
          emissiveIntensity={1.1}
        />
      </mesh>

      <mesh position={[0, 0.98, 0]} castShadow>
        <boxGeometry args={[0.46, 0.34, 0.38]} />
        <meshStandardMaterial
          color={C.metalLight}
          roughness={0.5}
          metalness={0.2}
        />
      </mesh>

      <mesh position={[0, 0.99, -0.2]}>
        <boxGeometry args={[0.34, 0.12, 0.04]} />
        <meshStandardMaterial
          color={C.screenFrame}
          emissive={color}
          emissiveIntensity={1.4}
        />
      </mesh>

      <mesh position={[0, 1.26, 0]}>
        <cylinderGeometry args={[0.016, 0.016, 0.2, 8]} />
        <meshStandardMaterial color={C.metalLight} metalness={0.5} />
      </mesh>

      <mesh position={[0, 1.4, 0]}>
        <sphereGeometry args={[0.05, 12, 12]} />
        <meshStandardMaterial
          ref={antenna}
          color={color}
          emissive={color}
          emissiveIntensity={0.6}
        />
      </mesh>

      <group ref={armLeft} position={[-0.32, 0.72, 0]}>
        <mesh position={[0, -0.17, 0]} castShadow>
          <boxGeometry args={[0.1, 0.34, 0.1]} />
          <meshStandardMaterial color={C.metalLight} roughness={0.5} />
        </mesh>
      </group>
      <group ref={armRight} position={[0.32, 0.72, 0]}>
        <mesh position={[0, -0.17, 0]} castShadow>
          <boxGeometry args={[0.1, 0.34, 0.1]} />
          <meshStandardMaterial color={C.metalLight} roughness={0.5} />
        </mesh>
      </group>
    </group>
  );
}

function WorkerLabel({ worker, color }: { worker: WorkerState; color: string }) {
  const material = useRef<THREE.SpriteMaterial>(null);
  const visual = getWorkerStatusVisual(worker.status);
  const goal = formatWorkerGoal(worker.goal);

  useEffect(() => {
    const texture = createWorkerLabelTexture({
      statusLabel: visual.label,
      statusColor: color,
      goal,
    });
    const current = material.current;

    if (current) {
      current.map = texture;
      current.needsUpdate = true;
    }

    return () => {
      texture.dispose();
    };
  }, [color, visual.label, goal]);

  return (
    <sprite position={[0, 2.02, 0.35]} scale={[2.6, 0.975, 1]}>
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

export const WorkerStation = memo(function WorkerStation({
  spec,
  worker,
}: {
  spec: WorkstationSpec;
  worker: WorkerState;
}) {
  const visual = getWorkerStatusVisual(worker.status);
  const terminal = isTerminalWorkerStatus(worker.status);

  return (
    <group position={spec.position} rotation={[0, spec.rotationY, 0]}>
      <WorkerDesk />
      <WorkerMonitor color={visual.color} />
      <WorkerStool />
      <group position={BOT_OFFSET}>
        <WorkerBot
          color={visual.color}
          active={visual.active}
          terminal={terminal}
        />
      </group>
      <WorkerLabel worker={worker} color={visual.color} />
    </group>
  );
});
