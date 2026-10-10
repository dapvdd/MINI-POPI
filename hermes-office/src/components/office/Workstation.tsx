"use client";

import { useFrame } from "@react-three/fiber";
import { memo, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { AgentStatus } from "@/lib/hermes/types";
import {
  getScreenColor,
  getScreenGlow,
  type PopiPresence,
} from "@/lib/popi";
import type { VisorMode } from "@/lib/popi-behavior";
import {
  OFFICE_PALETTE as C,
  POPI_AGENT_OFFSET,
  POPI_CHAIR_FOOTREST,
  POPI_CHAIR_POSITION,
  type WorkstationSpec,
} from "@/lib/office";
import { PopiAgent } from "./PopiAgent";
import { MonitorScreen } from "./MonitorScreen";
import type { PopiAnchorProbe } from "./PopiSpeechBubble";

const DESK_TOP_Y = 0.79;

/* =========================================================
   DESK
   Warmer, thicker top with a visible edge band and a
   cable-tidy back panel.
======================================================== */

function Desk() {
  return (
    <group>
      <mesh position={[0, DESK_TOP_Y, -0.2]} castShadow receiveShadow>
        <boxGeometry args={[4, 0.14, 1.6]} />
        <meshStandardMaterial color={C.desk} roughness={0.55} metalness={0.25} />
      </mesh>

      <mesh position={[0, DESK_TOP_Y, 0.59]} castShadow>
        <boxGeometry args={[4, 0.14, 0.06]} />
        <meshStandardMaterial
          color={C.deskEdge}
          emissive={C.accent}
          emissiveIntensity={0.22}
          roughness={0.4}
          metalness={0.3}
        />
      </mesh>

      {/* Rounded corner blocks soften the silhouette. */}
      {[
        [-1.93, -0.93],
        [1.93, -0.93],
        [-1.93, 0.53],
        [1.93, 0.53],
      ].map(([x, z]) => (
        <mesh key={`${x}-${z}`} position={[x, DESK_TOP_Y, z]}>
          <cylinderGeometry args={[0.06, 0.06, 0.14, 12]} />
          <meshStandardMaterial color={C.deskEdge} roughness={0.5} />
        </mesh>
      ))}

      {[-1.8, 1.8].map((x) => (
        <mesh
          key={x}
          position={[x, 0.36, -0.2]}
          castShadow
          receiveShadow
        >
          <boxGeometry args={[0.14, 0.72, 1.4]} />
          <meshStandardMaterial color={C.metal} roughness={0.6} metalness={0.35} />
        </mesh>
      ))}

      <mesh position={[0, 0.36, -0.9]} castShadow>
        <boxGeometry args={[3.6, 0.72, 0.08]} />
        <meshStandardMaterial color={C.metal} roughness={0.6} />
      </mesh>

      {/* Modesty panel with a tech grate */}
      <mesh position={[0, 0.36, -0.84]}>
        <boxGeometry args={[1.9, 0.5, 0.03]} />
        <meshStandardMaterial
          color={C.wallPanel}
          emissive={C.accentSoft}
          emissiveIntensity={0.1}
          roughness={0.5}
          metalness={0.3}
        />
      </mesh>
    </group>
  );
}

/**
 * Shallow task chair sized for the character: the seat top sits at y = 0.40,
 * which is the height `POPI_SEAT_ANCHOR` puts her hips on. Its footprint is
 * also what `popi-navigation.ts` uses to keep a wandering Popi off it, so the
 * chair has to stay shallow enough that she can stand in front of it.
 */
function Chair() {
  const arms = [0, 1, 2, 3, 4];
  const [x, , z] = POPI_CHAIR_POSITION;

  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 0.33, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.82, 0.14, 0.6]} />
        <meshStandardMaterial color={C.metalLight} roughness={0.7} />
      </mesh>

      <mesh position={[0, 0.78, 0.4]} rotation={[-0.14, 0, 0]} castShadow>
        <boxGeometry args={[0.8, 0.86, 0.12]} />
        <meshStandardMaterial color={C.metalLight} roughness={0.7} />
      </mesh>
      {/* Back cushion she actually leans against. */}
      <mesh position={[0, 0.78, 0.32]} rotation={[-0.14, 0, 0]}>
        <boxGeometry args={[0.68, 0.7, 0.05]} />
        <meshStandardMaterial color={C.metal} roughness={0.85} />
      </mesh>

      <mesh position={[0, 0.15, 0]}>
        <cylinderGeometry args={[0.06, 0.06, 0.3, 12]} />
        <meshStandardMaterial color={C.metal} metalness={0.5} />
      </mesh>
      <mesh position={[0, 0.04, 0]}>
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

      {/* Footrest */}
      <group
        position={[
          POPI_CHAIR_FOOTREST[0] - x,
          POPI_CHAIR_FOOTREST[1],
          POPI_CHAIR_FOOTREST[2] - z,
        ]}
      >
        <mesh castShadow>
          <boxGeometry args={[0.66, 0.05, 0.12]} />
          <meshStandardMaterial color={C.metalLight} roughness={0.7} />
        </mesh>
        {[-0.24, 0.24].map((offset) => (
          <mesh key={offset} position={[offset, -0.17, 0]}>
            <boxGeometry args={[0.05, 0.34, 0.05]} />
            <meshStandardMaterial color={C.metal} metalness={0.4} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

/* =========================================================
   KEYBOARD
   One instanced mesh for the whole key grid: a full-size
   keyboard costs a single draw call. Keys only move for a
   real tool run, and the amplitude is the typing intensity.
   ======================================================== */

const KEYBOARD_ROWS = [14, 14, 13, 12, 8];
const KEY_W = 0.075;
const KEY_H = 0.075;

function Keyboard({ typing }: { typing: number }) {
  const keys = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const intensity = useRef(typing);

  useLayoutEffect(() => {
    const mesh = keys.current;
    if (!mesh) return;

    let index = 0;
    const totalWidth = 14 * KEY_W;
    let row = 0;

    for (const count of KEYBOARD_ROWS) {
      let x = -totalWidth / 2 + KEY_W / 2 + (row % 2) * KEY_W * 0.35;

      for (let key = 0; key < count; key += 1) {
        dummy.position.set(
          x,
          0,
          row * KEY_H * 1.05 - KEYBOARD_ROWS.length * 0.04,
        );
        dummy.updateMatrix();
        mesh.setMatrixAt(index, dummy.matrix);
        index += 1;
        x += KEY_W;
      }
      row += 1;
    }

    mesh.count = index;
    mesh.instanceMatrix.needsUpdate = true;
  }, [dummy]);

  // A few rows ride up while typing so the keys read as pressed. The step is
  // eased, not switched, so an idle keyboard settles instead of freezing.
  useFrame((state, delta) => {
    const mesh = keys.current;
    if (!mesh) return;

    const target = Math.min(1, Math.max(0, typing));
    intensity.current +=
      (target - intensity.current) * (1 - Math.exp(-8 * Math.min(delta, 0.25)));

    const amount = intensity.current;
    const t = state.clock.elapsedTime;
    let index = 0;

    if (amount > 0.001) {
      KEYBOARD_ROWS.forEach((count, row) => {
        const bob = Math.abs(Math.sin(t * 9 + row * 0.5)) * 0.014 * amount;
        for (let key = 0; key < count; key += 1) {
          dummy.position.y = bob;
          dummy.updateMatrix();
          mesh.setMatrixAt(index, dummy.matrix);
          index += 1;
        }
      });

      mesh.instanceMatrix.needsUpdate = true;
    }
  });

  return (
    <group position={[0, DESK_TOP_Y + 0.08, 0.2]}>
      <mesh receiveShadow castShadow>
        <boxGeometry args={[1.16, 0.035, 0.46]} />
        <meshStandardMaterial color={C.metalLight} roughness={0.6} metalness={0.2} />
      </mesh>

      <instancedMesh ref={keys} args={[undefined, undefined, 64]}>
        <boxGeometry args={[KEY_W * 0.72, 0.022, KEY_H * 0.62]} />
        <meshStandardMaterial color="#0f172a" roughness={0.75} />
      </instancedMesh>
    </group>
  );
}

/* =========================================================
   MONITORS
======================================================== */

function MonitorStand() {
  return (
    <group>
      <mesh position={[0, 0.02, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.36, 0.04, 0.3]} />
        <meshStandardMaterial color={C.metalLight} metalness={0.4} />
      </mesh>
      <mesh position={[0, 0.14, 0]} castShadow>
        <boxGeometry args={[0.08, 0.26, 0.08]} />
        <meshStandardMaterial color={C.metalLight} metalness={0.4} />
      </mesh>
    </group>
  );
}

function MonitorFrame({
  width,
  height,
  children,
  position,
  tilt,
}: {
  width: number;
  height: number;
  children?: React.ReactNode;
  position: [number, number, number];
  tilt?: number;
}) {
  return (
    <group position={position} rotation={[tilt ?? 0, 0, 0]}>
      <mesh castShadow receiveShadow>
        <boxGeometry args={[width, height, 0.09]} />
        <meshStandardMaterial color={C.screenFrame} roughness={0.4} metalness={0.3} />
      </mesh>
      <mesh position={[0, 0, 0.045]}>
        <planeGeometry args={[width - 0.12, height - 0.12]} />
        <meshStandardMaterial color="#02040a" emissive={C.accentSoft} emissiveIntensity={0.05} />
      </mesh>
      {children}
    </group>
  );
}

function MainMonitor({
  status,
  presence,
  tool,
  command,
  reducedMotion,
}: {
  status: AgentStatus;
  presence: PopiPresence;
  tool?: string | null;
  command?: string | null;
  reducedMotion: boolean;
}) {
  const glow = useRef<THREE.MeshStandardMaterial>(null);

  useFrame((state) => {
    if (!glow.current || reducedMotion) return;
    glow.current.emissiveIntensity = getScreenGlow(
      status,
      state.clock.elapsedTime,
      presence,
    );
  });

  const width = 2.34;
  const height = 1.32;

  return (
    <group position={[0, 1.02, -0.92]} rotation={[0, 0, 0]}>
      <MonitorFrame width={width} height={height} position={[0, 0, 0]} tilt={-0.03}>
        <MonitorScreen
          status={status}
          presence={presence}
          tool={tool}
          command={command}
          reducedMotion={reducedMotion}
        />
      </MonitorFrame>
      <MonitorStand />
    </group>
  );
}

function SideMonitor({
  status,
  presence,
}: {
  status: AgentStatus;
  presence: PopiPresence;
}) {
  const width = 1.18;
  const height = 0.84;
  const accent = getScreenColor(status, presence);

  return (
    <group position={[1.62, 0.94, -1.28]} rotation={[0, -0.42, 0]}>
      <MonitorFrame width={width} height={height} position={[0, 0, 0]} tilt={-0.02} />
      {/* Secondary panel: a compact readout, no fabricated values. */}
      <group position={[0, 0.08, 0.055]}>
        {[0, 1, 2].map((row) => (
          <mesh key={row} position={[-0.22 + row * 0.1, row * 0.12 - 0.1, 0]}>
            <boxGeometry args={[0.5, 0.03, 0.01]} />
            <meshStandardMaterial
              color={C.screenFrame}
              emissive={accent}
              emissiveIntensity={0.8 - row * 0.18}
            />
          </mesh>
        ))}
        <mesh position={[0, -0.26, 0]}>
          <boxGeometry args={[0.6, 0.16, 0.01]} />
          <meshStandardMaterial
            color={C.screenFrame}
            emissive={C.warm}
            emissiveIntensity={0.5}
          />
        </mesh>
      </group>
      <MonitorStand />
    </group>
  );
}

/* =========================================================
   DESK PROPS
======================================================== */

function DeskProps({
  status,
  presence,
}: {
  status: AgentStatus;
  presence: PopiPresence;
}) {
  const accent = getScreenColor(status, presence);

  return (
    <group>
      {/* Keyboard plate */}
      <mesh position={[0, DESK_TOP_Y + 0.02, 0.28]} castShadow receiveShadow>
        <boxGeometry args={[1.42, 0.05, 0.56]} />
        <meshStandardMaterial color={C.metalLight} roughness={0.5} metalness={0.3} />
      </mesh>

      {/* Mouse */}
      <group position={[1.05, DESK_TOP_Y + 0.03, 0.3]}>
        <mesh castShadow>
          <boxGeometry args={[0.17, 0.06, 0.26]} />
          <meshStandardMaterial color={C.metalLight} roughness={0.4} metalness={0.2} />
        </mesh>
        <mesh position={[0, 0.035, -0.02]}>
          <boxGeometry args={[0.03, 0.02, 0.18]} />
          <meshStandardMaterial color={C.accent} emissive={C.accent} emissiveIntensity={0.6} />
        </mesh>
      </group>

      {/* Wrist rest */}
      <mesh position={[0, DESK_TOP_Y + 0.015, 0.58]} castShadow>
        <boxGeometry args={[1.3, 0.05, 0.13]} />
        <meshStandardMaterial color={C.plantDark} roughness={0.85} />
      </mesh>

      {/* Mug */}
      <group position={[-1.35, DESK_TOP_Y, 0.18]}>
        <mesh position={[0, 0.11, 0]} castShadow>
          <cylinderGeometry args={[0.11, 0.09, 0.24, 16]} />
          <meshStandardMaterial color={C.mug} roughness={0.5} />
        </mesh>
        <mesh position={[0.09, 0.13, 0]}>
          <torusGeometry args={[0.05, 0.014, 8, 14]} />
          <meshStandardMaterial color={C.mug} roughness={0.5} />
        </mesh>
        <mesh position={[0, 0.235, 0]}>
          <torusGeometry args={[0.085, 0.012, 8, 20]} />
          <meshStandardMaterial color={C.warmSoft} roughness={0.6} />
        </mesh>
      </group>

      {/* Plant */}
      <group position={[1.6, DESK_TOP_Y, -0.05]}>
        <mesh position={[0, 0.1, 0]} castShadow>
          <cylinderGeometry args={[0.13, 0.1, 0.2, 12]} />
          <meshStandardMaterial color={C.metalLight} roughness={0.8} />
        </mesh>
        <mesh position={[0, 0.34, 0]} castShadow>
          <icosahedronGeometry args={[0.22, 0]} />
          <meshStandardMaterial color={C.plant} flatShading roughness={0.8} />
        </mesh>
        <mesh position={[0.12, 0.24, 0.08]} castShadow>
          <icosahedronGeometry args={[0.12, 0]} />
          <meshStandardMaterial color={C.plantDark} flatShading roughness={0.8} />
        </mesh>
      </group>

      {/* Warm desk lamp — the scene's single amber accent */}
      <group position={[-1.78, DESK_TOP_Y, -0.42]}>
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
          <meshStandardMaterial color={C.metalLight} side={THREE.DoubleSide} roughness={0.6} />
        </mesh>
        <pointLight
          position={[0, 0.7, -0.12]}
          color={C.warm}
          intensity={2.4}
          distance={4}
          decay={2}
        />
      </group>

      {/* Notebook + pen */}
      <group position={[-0.72, DESK_TOP_Y + 0.02, -0.68]} rotation={[0, 0.3, 0]}>
        <mesh castShadow receiveShadow>
          <boxGeometry args={[0.52, 0.035, 0.7]} />
          <meshStandardMaterial color={C.paper} roughness={0.9} />
        </mesh>
        <mesh position={[-0.2, 0.03, 0.1]} rotation={[0, 0.5, 0]}>
          <cylinderGeometry args={[0.016, 0.016, 0.3, 8]} />
          <meshStandardMaterial color={C.violet} roughness={0.5} />
        </mesh>
      </group>

      {/* Sticky notes */}
      {(
        [
          [-0.15, 0.24, C.warmSoft],
          [0.16, 0.2, C.accent],
          [0.02, 0.1, C.violet],
        ] as Array<[number, number, string]>
      ).map(([x, z, color], index) => (
        <mesh
          key={index}
          position={[x, DESK_TOP_Y + 0.03, z]}
          rotation={[0, index * 0.7, 0]}
          castShadow
        >
          <boxGeometry args={[0.19, 0.008, 0.19]} />
          <meshStandardMaterial color={color} roughness={0.9} />
        </mesh>
      ))}

      {/* Status glaive — mirrors the agent light, never invents one */}
      <mesh position={[2.5, DESK_TOP_Y + 0.02, 0.12]} castShadow receiveShadow>
        <boxGeometry args={[0.14, 0.04, 0.14]} />
        <meshStandardMaterial color={C.metalLight} roughness={0.5} metalness={0.4} />
      </mesh>
      <mesh position={[2.5, DESK_TOP_Y + 0.09, 0.12]}>
        <sphereGeometry args={[0.055, 12, 12]} />
        <meshStandardMaterial
          color={C.screenFrame}
          emissive={accent}
          emissiveIntensity={1.1}
        />
      </mesh>
    </group>
  );
}

/* =========================================================
   WORKSTATION
======================================================== */

export const Workstation = memo(function Workstation({
  spec,
  status,
  presence = "online",
  reducedMotion = false,
  tool,
  command,
  turnSeq = 0,
  visorMode = "auto",
  probe,
}: {
  spec: WorkstationSpec;
  status: AgentStatus;
  presence?: PopiPresence;
  reducedMotion?: boolean;
  tool?: string | null;
  /** Live command/context string for the active tool, when there is one. */
  command?: string | null;
  turnSeq?: number;
  visorMode?: VisorMode;
  probe?: React.RefObject<PopiAnchorProbe>;
}) {
  // Key feedback only ever runs for a real tool run, and each state has its own
  // intensity so USING_TOOL reads as deliberate rather than as more typing.
  const typingIntensity =
    status === "WORKING" ? 1 : status === "TERMINAL" ? 1 : status === "USING_TOOL" ? 0.6 : 0;

  return (
    <group position={spec.position} rotation={[0, spec.rotationY, 0]}>
      <Desk />
      <Chair />
      <MainMonitor
        status={status}
        presence={presence}
        tool={tool}
        command={command}
        reducedMotion={reducedMotion}
      />
      <SideMonitor status={status} presence={presence} />
      <Keyboard typing={typingIntensity} />
      <DeskProps status={status} presence={presence} />
      <group position={POPI_AGENT_OFFSET}>
        <PopiAgent
          status={status}
          presence={presence}
          reducedMotion={reducedMotion}
          turnSeq={turnSeq}
          visorMode={visorMode}
          probe={probe}
        />
      </group>
    </group>
  );
});
