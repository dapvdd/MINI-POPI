"use client";

import { useFrame } from "@react-three/fiber";
import { memo, useEffect, useRef } from "react";
import * as THREE from "three";
import type { WorkerState } from "@/lib/hermes/workers";
import {
  formatWorkerGoal,
  getWorkerStatusVisual,
  type WorkerMotion,
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

function WorkerMonitor({
  color,
  active,
}: {
  color: string;
  active: boolean;
}) {
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
          emissiveIntensity={active ? 0.55 : 0.18}
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
  motion,
  reducedMotion,
}: {
  color: string;
  motion: WorkerMotion;
  reducedMotion: boolean;
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

    // Motionless defaults; every mode opts into the motion it truthfully owns.
    let y = 0.05;
    let roll = 0;
    let left = 0;
    let right = 0;
    let glow = 0.45;

    if (!reducedMotion) {
      switch (motion) {
        case "working":
          y = 0.05 + Math.abs(Math.sin(t * 3.2)) * 0.05;
          roll = Math.sin(t * 2.4) * 0.03;
          left = Math.sin(t * 8) * 0.4;
          right = Math.sin(t * 8 + Math.PI) * 0.4;
          glow = 1.3 + Math.sin(t * 7) * 0.7;
          break;

        case "tool":
          y = 0.05 + Math.abs(Math.sin(t * 6)) * 0.04;
          roll = Math.sin(t * 4.5) * 0.02;
          left = Math.sin(t * 13) * 0.6;
          right = Math.sin(t * 13 + Math.PI) * 0.6;
          glow = 1.5 + Math.sin(t * 10) * 0.5;
          break;

        case "thinking":
          y = 0.05 + Math.sin(t * 1.6) * 0.025;
          roll = Math.sin(t * 1.1) * 0.02;
          left = Math.sin(t * 1.6) * 0.06;
          right = -Math.sin(t * 1.6) * 0.06;
          glow = 0.7 + Math.sin(t * 2.4) * 0.3;
          break;

        case "dormant":
          y = 0.05 + Math.sin(t * 1.1) * 0.015;
          glow = 0.35 + Math.sin(t * 1.4) * 0.1;
          break;

        case "failed":
          // Brief attention flicker only; never live-work motion.
          glow = Math.sin(t * 12) > 0.6 ? 1.4 : 0.4;
          break;

        case "settled":
        default:
          break;
      }
    }

    group.position.y = y;
    group.rotation.z = roll;

    if (antenna.current) {
      antenna.current.emissiveIntensity = glow;
    }

    if (armLeft.current) {
      armLeft.current.rotation.x = left;
    }

    if (armRight.current) {
      armRight.current.rotation.x = right;
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
  reducedMotion = false,
}: {
  spec: WorkstationSpec;
  worker: WorkerState;
  reducedMotion?: boolean;
}) {
  const visual = getWorkerStatusVisual(worker.status);

  return (
    <group position={spec.position} rotation={[0, spec.rotationY, 0]}>
      <WorkerDesk />
      <WorkerMonitor color={visual.color} active={visual.active} />
      <WorkerStool />
      <group position={BOT_OFFSET}>
        <WorkerBot
          color={visual.color}
          motion={visual.motion}
          reducedMotion={reducedMotion}
        />
      </group>
      <WorkerLabel worker={worker} color={visual.color} />
    </group>
  );
});
