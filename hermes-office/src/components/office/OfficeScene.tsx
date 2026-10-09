"use client";

import { OrbitControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { AgentStatus } from "@/lib/hermes/types";
import { getPointLightColor, getPointLightIntensity } from "@/lib/popi";
import { OFFICE_PALETTE as C, POPI_WORKSTATION } from "@/lib/office";
import { OfficeRoom } from "./Room";
import { Workstation } from "./Workstation";

const CAMERA_TARGET: [number, number, number] = [0, 1.25, 0.2];

type OrbitLike = {
  target: THREE.Vector3;
  update: () => void;
};

function StatusLight({ status }: { status: AgentStatus }) {
  const light = useRef<THREE.PointLight>(null);

  useFrame((state) => {
    if (!light.current) return;

    light.current.intensity = getPointLightIntensity(
      status,
      state.clock.elapsedTime,
    );
  });

  return (
    <pointLight
      ref={light}
      position={[0, 2.6, -1.6]}
      intensity={1}
      distance={16}
      decay={2}
      color={getPointLightColor(status)}
    />
  );
}

function CameraRig() {
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);
  const controls = useThree((state) => state.controls) as unknown as
    | OrbitLike
    | null;

  useEffect(() => {
    const aspect = size.height > 0 ? size.width / size.height : 1;
    const distance = aspect < 1 ? 11.5 : aspect < 1.5 ? 9.5 : 8;
    const target = new THREE.Vector3(...CAMERA_TARGET);
    const direction = new THREE.Vector3(0.6, 0.45, 1).normalize();

    camera.position.copy(target).addScaledVector(direction, distance);
    camera.lookAt(target);

    if (controls) {
      controls.target.copy(target);
      controls.update();
    }
  }, [camera, size, controls]);

  return null;
}

export function OfficeScene({ status }: { status: AgentStatus }) {
  return (
    <>
      <color attach="background" args={[C.background]} />
      <ambientLight intensity={0.5} />
      <hemisphereLight args={["#3b4a6b", "#0b0b0f", 0.55]} />
      <directionalLight
        castShadow
        position={[6, 10, 5]}
        intensity={1.9}
        color="#dbeafe"
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-near={1}
        shadow-camera-far={40}
        shadow-camera-left={-14}
        shadow-camera-right={14}
        shadow-camera-top={14}
        shadow-camera-bottom={-14}
        shadow-bias={-0.0005}
      />
      <StatusLight status={status} />

      <OfficeRoom />
      <Workstation spec={POPI_WORKSTATION} status={status} />

      <CameraRig />
      <OrbitControls
        makeDefault
        enablePan={false}
        enableDamping
        minDistance={4}
        maxDistance={14}
        maxPolarAngle={Math.PI / 2.05}
        target={CAMERA_TARGET}
      />
    </>
  );
}
