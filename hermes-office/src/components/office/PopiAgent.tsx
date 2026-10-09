"use client";

import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";
import type { AgentStatus } from "@/lib/hermes/types";
import { BASE_Y, getBodyColor, getPopiPose } from "@/lib/popi";

export function PopiAgent({ status }: { status: AgentStatus }) {
  const root = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const armLeft = useRef<THREE.Group>(null);
  const armRight = useRef<THREE.Group>(null);
  const eyeLeft = useRef<THREE.Mesh>(null);
  const eyeRight = useRef<THREE.Mesh>(null);
  const bodyColor = getBodyColor(status);

  useFrame((state, delta) => {
    const pose = getPopiPose(status, state.clock.elapsedTime);

    if (!root.current || !body.current || !head.current) {
      return;
    }

    root.current.position.set(
      pose.position[0],
      pose.position[1],
      pose.position[2],
    );
    root.current.rotation.x = pose.rotation[0];
    root.current.rotation.z = pose.rotation[2];
    root.current.rotation.y = THREE.MathUtils.damp(
      root.current.rotation.y,
      pose.facing,
      6,
      delta,
    );
    body.current.scale.setScalar(pose.bodyScale);
    head.current.rotation.set(
      pose.headRotation[0],
      pose.headRotation[1],
      pose.headRotation[2],
    );

    if (armLeft.current) {
      armLeft.current.rotation.x = pose.armLeft;
    }

    if (armRight.current) {
      armRight.current.rotation.x = pose.armRight;
    }

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

        <group ref={head} position={[0, 1.65, 0]}>
          <mesh castShadow>
            <sphereGeometry args={[0.38, 24, 24]} />
            <meshStandardMaterial color="#e5e7eb" roughness={0.6} />
          </mesh>

          <mesh ref={eyeLeft} position={[-0.13, 0.03, 0.34]}>
            <sphereGeometry args={[0.045, 12, 12]} />
            <meshStandardMaterial color="#111827" />
          </mesh>
          <mesh ref={eyeRight} position={[0.13, 0.03, 0.34]}>
            <sphereGeometry args={[0.045, 12, 12]} />
            <meshStandardMaterial color="#111827" />
          </mesh>
        </group>

        <group ref={armLeft} position={[-0.42, 1.05, 0]}>
          <mesh position={[0, -0.275, 0]} castShadow>
            <boxGeometry args={[0.16, 0.55, 0.16]} />
            <meshStandardMaterial color={bodyColor} roughness={0.5} />
          </mesh>
        </group>
        <group ref={armRight} position={[0.42, 1.05, 0]}>
          <mesh position={[0, -0.275, 0]} castShadow>
            <boxGeometry args={[0.16, 0.55, 0.16]} />
            <meshStandardMaterial color={bodyColor} roughness={0.5} />
          </mesh>
        </group>
      </group>
    </group>
  );
}
