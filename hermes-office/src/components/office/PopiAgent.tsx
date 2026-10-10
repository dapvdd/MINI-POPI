"use client";

import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";
import type { AgentStatus } from "@/lib/hermes/types";
import {
  BASE_Y,
  blendPose,
  getBodyColor,
  getPopiPose,
  type PopiPose,
  type PopiPresence,
} from "@/lib/popi";
import { OFFICE_PALETTE as C } from "@/lib/office";

/**
 * Largest delta fed to the blend, so a hidden tab or a long frame cannot make
 * Popi lurch when it resumes.
 */
const MAX_STEP = 0.05;

export function PopiAgent({
  status,
  presence = "online",
  reducedMotion = false,
}: {
  status: AgentStatus;
  presence?: PopiPresence;
  reducedMotion?: boolean;
}) {
  const root = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const armLeft = useRef<THREE.Group>(null);
  const armRight = useRef<THREE.Group>(null);
  const eyeLeft = useRef<THREE.Mesh>(null);
  const eyeRight = useRef<THREE.Mesh>(null);
  const smoothed = useRef<PopiPose | null>(null);
  const bodyColor = getBodyColor(status, presence);

  useFrame((state, delta) => {
    if (
      !root.current ||
      !body.current ||
      !head.current ||
      !armLeft.current ||
      !armRight.current
    ) {
      return;
    }

    const target = getPopiPose(status, state.clock.elapsedTime, {
      presence,
      reducedMotion,
    });

    // First frame and reduced motion land directly on the target; every other
    // frame eases toward it so a status change never snaps.
    const pose =
      reducedMotion || smoothed.current === null
        ? target
        : blendPose(smoothed.current, target, Math.min(delta, MAX_STEP));

    smoothed.current = pose;

    root.current.position.set(
      pose.position[0],
      pose.position[1],
      pose.position[2],
    );
    root.current.rotation.x = pose.rotation[0];
    root.current.rotation.y = pose.facing;
    root.current.rotation.z = pose.rotation[2];

    body.current.scale.setScalar(pose.bodyScale);
    head.current.rotation.set(
      pose.headRotation[0],
      pose.headRotation[1],
      pose.headRotation[2],
    );

    armLeft.current.rotation.x = pose.armLeft;
    armLeft.current.rotation.z = pose.armLeftZ;
    armRight.current.rotation.x = pose.armRight;
    armRight.current.rotation.z = pose.armRightZ;

    if (eyeLeft.current) {
      eyeLeft.current.scale.set(1, pose.eyeOpen, 1);
    }

    if (eyeRight.current) {
      eyeRight.current.scale.set(1, pose.eyeOpen, 1);
    }
  });

  return (
    <group ref={root} position={[0, BASE_Y, 0]}>
      <group ref={body}>
        <mesh position={[0, 0.8, 0]} castShadow>
          <capsuleGeometry args={[0.35, 0.7, 8, 16]} />
          <meshStandardMaterial color={bodyColor} roughness={0.5} />
        </mesh>

        {/* Chest core — reads as the agent light from any angle. */}
        <mesh position={[0, 0.86, 0.33]}>
          <sphereGeometry args={[0.1, 14, 14]} />
          <meshStandardMaterial
            color={C.screenFrame}
            emissive={bodyColor}
            emissiveIntensity={1.3}
          />
        </mesh>
        <mesh position={[0, 0.86, 0.37]}>
          <ringGeometry args={[0.13, 0.16, 24]} />
          <meshBasicMaterial color={bodyColor} transparent opacity={0.5} />
        </mesh>

        {/* Feet */}
        {[-0.19, 0.19].map((x) => (
          <mesh key={x} position={[x, 0.07, 0.1]} castShadow>
            <sphereGeometry args={[0.12, 12, 12]} />
            <meshStandardMaterial color={bodyColor} roughness={0.6} />
          </mesh>
        ))}

        <group ref={head} position={[0, 1.65, 0]}>
          {/* Ears — the defining silhouette cue of the character. */}
          {[-0.27, 0.27].map((x) => (
            <mesh key={x} position={[x, 0.33, 0]} castShadow>
              <coneGeometry args={[0.12, 0.3, 12]} />
              <meshStandardMaterial color="#cbd5e1" roughness={0.6} />
            </mesh>
          ))}

          <mesh castShadow>
            <sphereGeometry args={[0.38, 24, 24]} />
            <meshStandardMaterial color="#e5e7eb" roughness={0.6} />
          </mesh>

          {/* Soft face plate for a rounder, friendlier read. */}
          <mesh position={[0, -0.04, 0.2]}>
            <sphereGeometry args={[0.26, 18, 18]} />
            <meshStandardMaterial color="#f1f5f9" roughness={0.55} />
          </mesh>

          <mesh ref={eyeLeft} position={[-0.13, 0.03, 0.34]}>
            <sphereGeometry args={[0.058, 12, 12]} />
            <meshStandardMaterial color="#111827" />
          </mesh>
          <mesh ref={eyeRight} position={[0.13, 0.03, 0.34]}>
            <sphereGeometry args={[0.058, 12, 12]} />
            <meshStandardMaterial color="#111827" />
          </mesh>

          {/* Antenna with a lit tip */}
          <mesh position={[0, 0.42, -0.05]}>
            <cylinderGeometry args={[0.016, 0.016, 0.2, 8]} />
            <meshStandardMaterial color={C.metalLight} metalness={0.5} />
          </mesh>
          <mesh position={[0, 0.55, -0.05]}>
            <sphereGeometry args={[0.045, 12, 12]} />
            <meshStandardMaterial
              color={bodyColor}
              emissive={bodyColor}
              emissiveIntensity={0.9}
            />
          </mesh>
        </group>

        <group ref={armLeft} position={[-0.42, 1.05, 0]}>
          <mesh position={[0, -0.275, 0]} castShadow>
            <boxGeometry args={[0.16, 0.55, 0.16]} />
            <meshStandardMaterial color={bodyColor} roughness={0.5} />
          </mesh>
          <mesh position={[0, -0.56, 0]} castShadow>
            <sphereGeometry args={[0.1, 12, 12]} />
            <meshStandardMaterial color={bodyColor} roughness={0.55} />
          </mesh>
        </group>
        <group ref={armRight} position={[0.42, 1.05, 0]}>
          <mesh position={[0, -0.275, 0]} castShadow>
            <boxGeometry args={[0.16, 0.55, 0.16]} />
            <meshStandardMaterial color={bodyColor} roughness={0.5} />
          </mesh>
          <mesh position={[0, -0.56, 0]} castShadow>
            <sphereGeometry args={[0.1, 12, 12]} />
            <meshStandardMaterial color={bodyColor} roughness={0.55} />
          </mesh>
        </group>
      </group>
    </group>
  );
}
