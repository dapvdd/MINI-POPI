"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { AgentStatus } from "@/lib/hermes/types";
import {
  BASE_Y,
  POPI_SCALE,
  blendPose,
  getBodyColor,
  getPopiBehaviorPose,
  type PopiPose,
  type PopiPresence,
} from "@/lib/popi";
import {
  createPopiRuntime,
  resolveVisor,
  stepPopiRuntime,
  type PopiLiveState,
  type VisorMode,
} from "@/lib/popi-behavior";
import { OFFICE_PALETTE as C } from "@/lib/office";
import { PopiEffects } from "./PopiEffects";
import type { PopiAnchorProbe } from "./PopiSpeechBubble";

/**
 * Largest delta fed to the behaviour machine and the pose blend, so a hidden
 * tab or a long frame cannot make Popi lurch when it resumes.
 */
const MAX_STEP = 0.05;

/** Local height of the head pivot inside the rig, used for the DOM anchor. */
const HEAD_LOCAL_Y = 1.65;

export function PopiAgent({
  status,
  presence = "online",
  reducedMotion = false,
  turnSeq = 0,
  visorMode = "auto",
  probe,
}: {
  status: AgentStatus;
  presence?: PopiPresence;
  reducedMotion?: boolean;
  /** Real completed-turn counter; a new value triggers the celebration. */
  turnSeq?: number;
  visorMode?: VisorMode;
  /** Shared with the DOM speech bubble to anchor it to Popi's head. */
  probe?: React.RefObject<PopiAnchorProbe>;
}) {
  const root = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const armLeft = useRef<THREE.Group>(null);
  const armRight = useRef<THREE.Group>(null);
  const eyeLeft = useRef<THREE.Mesh>(null);
  const eyeRight = useRef<THREE.Mesh>(null);

  const smoothed = useRef<PopiPose | null>(null);
  const runtime = useRef(createPopiRuntime());
  const world = useMemo(() => new THREE.Vector3(), []);

  /**
   * The effect layer and the terminal visor read the behaviour from this object
   * instead of props, so switching state never re-renders the character.
   */
  const live = useRef<PopiLiveState>({
    behavior: "idle",
    activity: "observe",
    t: 0,
    phase: 0,
  });

  const bodyColor = getBodyColor(status, presence);

  /**
   * The DOM bubble's anchor is handed in as a prop, but it is only ever written
   * from the render loop: copy the reference once so the loop mutates a local
   * value instead of a prop.
   */
  const anchor = useRef<PopiAnchorProbe | null>(null);

  useEffect(() => {
    anchor.current = probe ? probe.current : null;
  }, [probe]);

  const eyeMaterialLeft = useRef<THREE.MeshStandardMaterial>(null);
  const eyeMaterialRight = useRef<THREE.MeshStandardMaterial>(null);

  useFrame((state, delta) => {
    const step = Math.min(delta, MAX_STEP);
    const machine = stepPopiRuntime(runtime.current, step, {
      status,
      presence,
      turnSeq,
    });

    live.current = {
      behavior: machine.behavior,
      activity: machine.activity,
      t: state.clock.elapsedTime,
      phase: machine.activityElapsed,
    };

    if (
      !root.current ||
      !body.current ||
      !head.current ||
      !armLeft.current ||
      !armRight.current
    ) {
      return;
    }

    const walking = machine.behavior === "idle" && machine.activity === "wander";

    const poseTarget = getPopiBehaviorPose({
      behavior: machine.behavior,
      activity: machine.activity,
      presence,
      t: live.current.t,
      phase: live.current.phase,
      locomotion: walking
        ? { x: machine.x, z: machine.z, facing: machine.facing }
        : null,
      reducedMotion,
    });

    // First frame and reduced motion land directly on the target; every other
    // frame eases toward it so a state change never snaps.
    const pose =
      reducedMotion || smoothed.current === null
        ? poseTarget
        : blendPose(smoothed.current, poseTarget, step);

    smoothed.current = pose;

    root.current.position.set(
      pose.position[0],
      pose.position[1],
      pose.position[2],
    );
    root.current.rotation.x = pose.rotation[0];
    root.current.rotation.y = pose.facing;
    root.current.rotation.z = pose.rotation[2];

    body.current.scale.setScalar(POPI_SCALE * pose.bodyScale);

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

    // Publish the head's world position for the DOM bubble. The rig is static
    // apart from the transform written above, so one matrix transform is
    // enough; the anchor is never read during render.
    const target = anchor.current;

    if (target) {
      world.set(0, HEAD_LOCAL_Y * body.current.scale.y, 0);
      root.current.updateWorldMatrix(true, false);
      world.applyMatrix4(root.current.matrixWorld);
      target.x = world.x;
      target.y = world.y;
      target.z = world.z;
    }

    const eyeGlow = resolveVisor(machine.behavior, visorMode) ? 2.4 : 0.04;

    if (eyeMaterialLeft.current) {
      eyeMaterialLeft.current.emissiveIntensity = eyeGlow;
    }

    if (eyeMaterialRight.current) {
      eyeMaterialRight.current.emissiveIntensity = eyeGlow;
    }
  });

  return (
    <group ref={root} position={[0, BASE_Y, 0]}>
      <group ref={body}>
        <mesh position={[0, 0.8, 0]} castShadow>
          <capsuleGeometry args={[0.35, 0.7, 8, 16]} />
          <meshStandardMaterial color={bodyColor} roughness={0.42} metalness={0.08} />
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
            <meshStandardMaterial color="#e5e7eb" roughness={0.55} />
          </mesh>

          {/* Soft face plate for a rounder, friendlier read. */}
          <mesh position={[0, -0.04, 0.2]}>
            <sphereGeometry args={[0.26, 18, 18]} />
            <meshStandardMaterial color="#f1f5f9" roughness={0.5} />
          </mesh>

          <mesh ref={eyeLeft} position={[-0.13, 0.03, 0.34]}>
            <sphereGeometry args={[0.058, 12, 12]} />
            <meshStandardMaterial
              ref={eyeMaterialLeft}
              color="#0b1220"
              emissive={C.accent}
              emissiveIntensity={0.04}
              roughness={0.4}
            />
          </mesh>
          <mesh ref={eyeRight} position={[0.13, 0.03, 0.34]}>
            <sphereGeometry args={[0.058, 12, 12]} />
            <meshStandardMaterial
              ref={eyeMaterialRight}
              color="#0b1220"
              emissive={C.accent}
              emissiveIntensity={0.04}
              roughness={0.4}
            />
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

          <PopiEffects
            live={live}
            visorMode={visorMode}
            reducedMotion={reducedMotion}
          />
        </group>

        <group ref={armLeft} position={[-0.42, 1.05, 0]}>
          <mesh position={[0, -0.275, 0]} castShadow>
            <boxGeometry args={[0.16, 0.55, 0.16]} />
            <meshStandardMaterial color={bodyColor} roughness={0.45} />
          </mesh>
          <mesh position={[0, -0.56, 0]} castShadow>
            <sphereGeometry args={[0.1, 12, 12]} />
            <meshStandardMaterial color={bodyColor} roughness={0.5} />
          </mesh>
        </group>
        <group ref={armRight} position={[0.42, 1.05, 0]}>
          <mesh position={[0, -0.275, 0]} castShadow>
            <boxGeometry args={[0.16, 0.55, 0.16]} />
            <meshStandardMaterial color={bodyColor} roughness={0.45} />
          </mesh>
          <mesh position={[0, -0.56, 0]} castShadow>
            <sphereGeometry args={[0.1, 12, 12]} />
            <meshStandardMaterial color={bodyColor} roughness={0.5} />
          </mesh>
        </group>
      </group>
    </group>
  );
}
