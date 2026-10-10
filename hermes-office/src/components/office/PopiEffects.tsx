"use client";

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef, type RefObject } from "react";
import * as THREE from "three";
import { OFFICE_PALETTE as C } from "@/lib/office";
import type { PopiLiveState, VisorMode } from "@/lib/popi-behavior";
import { resolveVisor } from "@/lib/popi-behavior";

/**
 * Character effects: thought symbols, energy aura, digital particles, the hum
 * cue, celebration sparkles and the terminal visor.
 *
 * Everything is mounted once and driven from refs — the behaviour is read from
 * a shared `PopiLiveState` every frame, so a state change never mounts,
 * unmounts or re-allocates a single mesh. Each effect fades itself in and out
 * and only then sets `visible = false`, so a mode ending cleanly never pops.
 *
 * Geometry and material counts stay tiny: one material per effect family and a
 * single `THREE.Points` per particle field.
 */

function easeFade(
  current: number,
  target: number,
  delta: number,
  speed = 7,
): number {
  return current + (target - current) * (1 - Math.exp(-speed * delta));
}

const FADE_SPEED = {
  visor: 11,
  thought: 5,
  aura: 6,
  particles: 5,
  hum: 8,
  sparkle: 6,
} as const;

/* =========================================================
   THOUGHT SYMBOLS
   ========================================================= */

function ThoughtSymbols({ live }: { live: RefObject<PopiLiveState> }) {
  const group = useRef<THREE.Group>(null);
  const symbols = useRef<Array<THREE.Mesh | null>>([]);
  const material = useRef<THREE.MeshBasicMaterial | null>(null);
  const fade = useRef(0);

  useFrame((state, delta) => {
    const node = group.current;

    if (!node) return;

    fade.current = easeFade(
      fade.current,
      live.current?.behavior === "thinking" ? 1 : 0,
      delta,
      FADE_SPEED.thought,
    );
    node.visible = fade.current > 0.01;

    if (!node.visible) return;

    const t = state.clock.elapsedTime;

    symbols.current.forEach((mesh, index) => {
      if (!mesh) return;

      const offset = (index / symbols.current.length) * Math.PI * 2;

      mesh.position.set(
        Math.cos(t * 0.55 + offset) * 0.46,
        2.34 + Math.sin(t * 1.1 + offset) * 0.09,
        Math.sin(t * 0.55 + offset) * 0.3,
      );
      mesh.rotation.set(t * 0.7 + offset, t * 0.5, t * 0.3);
      mesh.scale.setScalar(0.6 + fade.current * 0.4);
    });

    if (material.current) {
      material.current.opacity = fade.current * 0.85;
    }
  });

  return (
    <group ref={group} visible={false}>
      {[0, 1, 2].map((index) => (
        <mesh
          key={index}
          ref={(mesh) => {
            symbols.current[index] = mesh;
          }}
          position={[0.4, 2.34, 0]}
        >
          <octahedronGeometry args={[0.075, 0]} />
          <meshBasicMaterial
            ref={material}
            color={C.violet}
            transparent
            opacity={0}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      ))}
    </group>
  );
}

/* =========================================================
   ENERGY AURA
   ========================================================= */

function EnergyAura({ live }: { live: RefObject<PopiLiveState> }) {
  const high = useRef<THREE.Mesh>(null);
  const low = useRef<THREE.Mesh>(null);
  const materials = useRef<Array<THREE.MeshBasicMaterial | null>>([]);
  const fade = useRef(0);

  useFrame((state, delta) => {
    const behavior = live.current?.behavior;
    const active =
      behavior === "working" ||
      behavior === "tool-use" ||
      behavior === "terminal";

    fade.current = easeFade(fade.current, active ? 1 : 0, delta, FADE_SPEED.aura);

    const visible = fade.current > 0.01;

    if (high.current) high.current.visible = visible;
    if (low.current) low.current.visible = visible;

    if (!visible) return;

    const t = state.clock.elapsedTime;

    if (high.current) {
      high.current.rotation.z = t * 1.6;
      high.current.scale.setScalar(0.94 + Math.sin(t * 6.5) * 0.09 * fade.current);
    }

    if (low.current) {
      low.current.rotation.z = -t * 2.1;
      low.current.scale.setScalar(0.9 + Math.sin(t * 8.3 + 1.2) * 0.07 * fade.current);
    }

    for (const item of materials.current) {
      if (item) {
        item.opacity = fade.current * (0.5 + 0.16 * Math.sin(t * 7));
      }
    }
  });

  return (
    <group>
      <mesh
        ref={high}
        position={[0, 1.02, 0]}
        rotation={[Math.PI / 2, 0, 0]}
        visible={false}
      >
        <torusGeometry args={[0.6, 0.018, 8, 56]} />
        <meshBasicMaterial
          ref={(item) => {
            materials.current[0] = item;
          }}
          color={C.accent}
          transparent
          opacity={0}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      <mesh
        ref={low}
        position={[0, 0.62, 0]}
        rotation={[Math.PI / 2, 0, 0]}
        visible={false}
      >
        <torusGeometry args={[0.5, 0.012, 6, 44]} />
        <meshBasicMaterial
          ref={(item) => {
            materials.current[1] = item;
          }}
          color={C.accentSoft}
          transparent
          opacity={0}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}

/* =========================================================
   DIGITAL PARTICLES (terminal)
   ========================================================= */

const PARTICLE_COUNT = 56;

function DigitalParticles({ live }: { live: RefObject<PopiLiveState> }) {
  const points = useRef<THREE.Points>(null);
  const fade = useRef(0);

  const phase = useMemo(
    () => Float32Array.from({ length: PARTICLE_COUNT }, (_, i) => (i * 37.3) % 1),
    [],
  );

  const positions = useMemo(() => new Float32Array(PARTICLE_COUNT * 3), []);

  useFrame((state, delta) => {
    const node = points.current;

    if (!node) return;

    fade.current = easeFade(
      fade.current,
      live.current?.behavior === "terminal" ? 1 : 0,
      delta,
      FADE_SPEED.particles,
    );
    node.visible = fade.current > 0.01;

    if (!node.visible) return;

    const t = state.clock.elapsedTime;
    const attribute = node.geometry.getAttribute("position");

    for (let i = 0; i < PARTICLE_COUNT; i += 1) {
      const angle = i * 2.399963;
      const radius = 0.44 + ((i * 13) % 7) * 0.055;
      const drift = (t * 0.16 + phase[i]) % 1;

      attribute.setXYZ(
        i,
        Math.cos(angle) * radius,
        0.35 + drift * 1.75,
        Math.sin(angle) * radius,
      );
    }

    attribute.needsUpdate = true;

    (node.material as THREE.PointsMaterial).opacity = fade.current * 0.55;
  });

  return (
    <points ref={points} visible={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        color={C.accent}
        size={0.045}
        transparent
        opacity={0}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        toneMapped={false}
      />
    </points>
  );
}

/* =========================================================
   HUM CUE
   ========================================================= */

function HumRings({ live }: { live: RefObject<PopiLiveState> }) {
  const rings = useRef<Array<THREE.Mesh | null>>([]);
  const materials = useRef<Array<THREE.MeshBasicMaterial | null>>([]);
  const fade = useRef(0);

  useFrame((state, delta) => {
    const active =
      live.current?.behavior === "idle" && live.current?.activity === "hum";

    fade.current = easeFade(fade.current, active ? 1 : 0, delta, FADE_SPEED.hum);

    const visible = fade.current > 0.01;

    for (const ring of rings.current) {
      if (ring) ring.visible = visible;
    }

    if (!visible) return;

    const t = state.clock.elapsedTime;

    rings.current.forEach((ring, index) => {
      if (!ring) return;

      const cycle = (t * 0.85 + index * 0.5) % 1;

      ring.position.z = 0.34 + cycle * 0.55;
      ring.scale.setScalar(0.35 + cycle * 0.75);

      const material = materials.current[index];

      if (material) {
        material.opacity = (1 - cycle) * 0.5 * fade.current;
      }
    });
  });

  return (
    <group position={[0, -0.04, 0.2]}>
      {[0, 1].map((index) => (
        <mesh
          key={index}
          ref={(mesh) => {
            rings.current[index] = mesh;
          }}
          visible={false}
        >
          <ringGeometry args={[0.1, 0.13, 24]} />
          <meshBasicMaterial
            ref={(material) => {
              materials.current[index] = material;
            }}
            color={C.accent}
            transparent
            opacity={0}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      ))}
    </group>
  );
}

/* =========================================================
   CELEBRATION SPARKLES
   ========================================================= */

const SPARKLE_COUNT = 42;

function CelebrationSparkles({
  live,
}: {
  live: RefObject<PopiLiveState>;
}) {
  const points = useRef<THREE.Points>(null);
  const fade = useRef(0);

  const seeds = useMemo(
    () => Float32Array.from({ length: SPARKLE_COUNT }, (_, i) => (i * 17.7) % 1),
    [],
  );

  const positions = useMemo(() => new Float32Array(SPARKLE_COUNT * 3), []);

  useFrame((state, delta) => {
    const node = points.current;

    if (!node) return;

    fade.current = easeFade(
      fade.current,
      live.current?.behavior === "celebrating" ? 1 : 0,
      delta,
      FADE_SPEED.sparkle,
    );
    node.visible = fade.current > 0.01;

    if (!node.visible) return;

    const attribute = node.geometry.getAttribute("position");

    for (let i = 0; i < SPARKLE_COUNT; i += 1) {
      const angle = i * 2.399963;
      const rise = (seeds[i] + state.clock.elapsedTime * 0.5) % 1;
      const spread = 0.35 + rise * 0.85;

      attribute.setXYZ(
        i,
        Math.cos(angle) * spread,
        0.12 + rise * 1.5,
        Math.sin(angle) * spread,
      );
    }

    attribute.needsUpdate = true;

    (node.material as THREE.PointsMaterial).opacity =
      fade.current * (1 - fade.current) * 1.6;
  });

  return (
    <points ref={points} visible={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        color={C.warmSoft}
        size={0.06}
        transparent
        opacity={0}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        toneMapped={false}
      />
    </points>
  );
}

/* =========================================================
   HACKER VISOR
   Detachable terminal chrome. It only ever appears when the
   Gateway really reported a terminal-like tool run (see
   `resolveVisor`), and it fades out rather than popping off.
   ========================================================= */

function HackerVisor({
  live,
  mode,
}: {
  live: RefObject<PopiLiveState>;
  mode: VisorMode;
}) {
  const group = useRef<THREE.Group>(null);
  const band = useRef<THREE.Mesh>(null);
  const lens = useRef<THREE.Mesh>(null);
  const bandMaterial = useRef<THREE.MeshBasicMaterial | null>(null);
  const lensMaterial = useRef<THREE.MeshBasicMaterial | null>(null);
  const fade = useRef(0);

  useFrame((state, delta) => {
    const node = group.current;

    if (!node) return;

    const active = resolveVisor(live.current?.behavior ?? "idle", mode);

    fade.current = easeFade(fade.current, active ? 1 : 0, delta, FADE_SPEED.visor);
    node.visible = fade.current > 0.01;

    if (!node.visible) return;

    const t = state.clock.elapsedTime;
    const pulse = 0.72 + 0.28 * Math.sin(t * 6);

    if (band.current) {
      band.current.position.y = 0.055 + Math.sin(t * 3) * 0.004;
    }

    if (lens.current) {
      lens.current.scale.set(1, 0.85 + 0.15 * pulse, 1);
    }

    if (bandMaterial.current) {
      bandMaterial.current.opacity = fade.current * 0.9;
    }

    if (lensMaterial.current) {
      lensMaterial.current.opacity = fade.current * pulse;
    }
  });

  return (
    <group ref={group} visible={false}>
      {/* Dark band across the brow */}
      <mesh ref={band} position={[0, 0.055, 0.235]}>
        <boxGeometry args={[0.5, 0.16, 0.07]} />
        <meshBasicMaterial
          ref={bandMaterial}
          color="#0b1220"
          transparent
          opacity={0.9}
          toneMapped={false}
        />
      </mesh>
      {/* Glowing cyan lens strip over the eyes */}
      <mesh ref={lens} position={[0, 0.055, 0.275]}>
        <planeGeometry args={[0.42, 0.1]} />
        <meshBasicMaterial
          ref={lensMaterial}
          color={C.accent}
          transparent
          opacity={0}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      {/* Temple light on each side */}
      {[-0.26, 0.26].map((x) => (
        <mesh key={x} position={[x, 0.055, 0.24]}>
          <boxGeometry args={[0.03, 0.05, 0.05]} />
          <meshBasicMaterial
            color={C.accent}
            transparent
            opacity={0.85}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      ))}
    </group>
  );
}

export function PopiEffects({
  live,
  visorMode,
  reducedMotion,
}: {
  live: RefObject<PopiLiveState>;
  visorMode: VisorMode;
  reducedMotion: boolean;
}) {
  return (
    <group>
      <ThoughtSymbols live={live} />
      <EnergyAura live={live} />
      {reducedMotion ? null : <DigitalParticles live={live} />}
      <HumRings live={live} />
      {reducedMotion ? null : <CelebrationSparkles live={live} />}
      <HackerVisor live={live} mode={visorMode} />
    </group>
  );
}
