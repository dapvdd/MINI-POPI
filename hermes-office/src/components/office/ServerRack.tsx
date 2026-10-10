"use client";

import { useFrame } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import {
  OFFICE_LAYOUT,
  OFFICE_PALETTE as C,
  SERVER_RACK_UNITS,
  serverRackCells,
} from "@/lib/office";

/**
 * Infrastructure rack in the back corner.
 *
 * This is environment dressing, not telemetry: the LEDs describe hardware that
 * is plugged in (power, network, disk) and blink on fixed structural phases.
 * No LED is bound to worker or agent state, so nothing here can imply activity
 * that the Gateway never reported.
 */

/** Fixed blink phases â€” decorative only, never randomized per frame. */
const LED_PHASES = [0, 1.9, 3.6, 5.2, 0.9, 4.1];
const LED_SPEED = 2.2;

export function ServerRack({ reducedMotion = false }: { reducedMotion?: boolean }) {
  const { position, size } = OFFICE_LAYOUT.serverRack;
  const [width, rackHeight, depth] = size;
  const leds = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const color = useMemo(() => new THREE.Color(), []);

  // Cell placement is derived from the shared rack spec so the chassis and its
  // contents can never drift apart (and is unit-tested in office.test.ts).
  const ledCells = useMemo(
    () =>
      serverRackCells().map((cell, index) => ({
        x: cell.ledX,
        y: cell.y,
        phase: LED_PHASES[index % LED_PHASES.length],
      })),
    [],
  );

  useLayoutEffect(() => {
    const mesh = leds.current;
    if (!mesh) return;

    ledCells.forEach((cell, index) => {
      dummy.position.set(cell.x, cell.y, depth / 2 + 0.005);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }, [ledCells, depth, dummy]);

  useFrame((state) => {
    const mesh = leds.current;
    if (!mesh) return;

    const t = reducedMotion ? 0 : state.clock.elapsedTime;

    ledCells.forEach((cell, index) => {
      // Hardware-style blink: mostly on, with a short dip.
      const wave = Math.sin((t + cell.phase) * LED_SPEED);
      const on = wave > -0.45;
      color.set(on ? C.led : "#0b2b33");
      mesh.setColorAt(index, color);
    });

    if (mesh.instanceColor) {
      mesh.instanceColor.needsUpdate = true;
    }
  });

  return (
    <group position={position}>
      {/* Chassis */}
      <mesh castShadow receiveShadow>
        <boxGeometry args={[width, rackHeight, depth]} />
        <meshStandardMaterial color={C.metal} roughness={0.55} metalness={0.45} />
      </mesh>

      {/* Open front face so the shelves read as equipment, not a solid box. */}
      <mesh position={[0, 0, depth / 2 - 0.03]}>
        <planeGeometry args={[width - 0.12, rackHeight - 0.12]} />
        <meshStandardMaterial color={C.screenFrame} roughness={0.8} />
      </mesh>

      {/* Rack rails */}
      {[-1, 1].map((side) => (
        <mesh
          key={side}
          position={[side * (width / 2 - 0.03), rackHeight / 2, depth / 2 + 0.01]}
          castShadow
        >
          <boxGeometry args={[0.05, rackHeight, 0.06]} />
          <meshStandardMaterial color={C.steel} roughness={0.4} metalness={0.6} />
        </mesh>
      ))}

      {/* Equipment shelves with vent slots and drive bays */}
      {Array.from({ length: SERVER_RACK_UNITS }, (_, unit) => {
        const unitHeight = rackHeight / SERVER_RACK_UNITS;
        const y = (unit + 0.5) * unitHeight;

        return (
          <group key={unit} position={[0, y, 0]}>
            <mesh position={[0, -unitHeight / 2 + 0.02, depth / 2 - 0.08]} receiveShadow>
              <boxGeometry args={[width - 0.14, 0.05, depth - 0.16]} />
              <meshStandardMaterial color={C.wallPanel} roughness={0.62} metalness={0.25} />
            </mesh>

            {/* Vent slots */}
            {[0, 0.05, 0.1].map((offset) => (
              <mesh
                key={offset}
                position={[0.12, offset - 0.02, depth / 2 - 0.02]}
              >
                <boxGeometry args={[0.34, 0.014, 0.02]} />
                <meshStandardMaterial color={C.screenFrame} roughness={0.9} />
              </mesh>
            ))}

            {/* Drive bay front plate */}
            <mesh position={[-0.28, 0.02, depth / 2 - 0.02]} castShadow>
              <boxGeometry args={[0.26, unitHeight - 0.14, 0.03]} />
              <meshStandardMaterial color={C.metalLight} roughness={0.5} metalness={0.35} />
            </mesh>
          </group>
        );
      })}

      {/* Status LEDs â€” one instanced mesh for every indicator. */}
      <instancedMesh
        ref={leds}
        args={[undefined, undefined, ledCells.length]}
      >
        <sphereGeometry args={[0.022, 8, 8]} />
        <meshBasicMaterial />
      </instancedMesh>

      {/* Cable management run down the back */}
      {[0, 1, 2].map((index) => (
        <mesh
          key={index}
          position={[width / 2 + 0.04, rackHeight / 2, -depth / 2 + 0.12 + index * 0.12]}
          castShadow
        >
          <cylinderGeometry args={[0.022, 0.022, rackHeight * 0.9, 6]} />
          <meshStandardMaterial color={C.screenFrame} roughness={0.9} />
        </mesh>
      ))}

      {/* Top-mounted warning beacon strip */}
      <mesh position={[0, rackHeight / 2 + 0.05, 0]} castShadow>
        <boxGeometry args={[width - 0.1, 0.06, depth - 0.1]} />
        <meshStandardMaterial color={C.wallTrim} roughness={0.5} metalness={0.4} />
      </mesh>
      <mesh position={[0, rackHeight / 2 + 0.09, 0]}>
        <boxGeometry args={[width - 0.2, 0.02, 0.04]} />
        <meshStandardMaterial
          color={C.screenFrame}
          emissive={C.warm}
          emissiveIntensity={0.5}
        />
      </mesh>
    </group>
  );
}
