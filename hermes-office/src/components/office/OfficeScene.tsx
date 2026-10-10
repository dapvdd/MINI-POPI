"use client";

import { OrbitControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import {
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";
import * as THREE from "three";
import type { AgentStatus } from "@/lib/hermes/types";
import type { GatewayErrorKind } from "@/lib/hermes/connection";
import type { WorkerState } from "@/lib/hermes/workers";
import {
  getPointLightColor,
  getPointLightIntensity,
  resolvePopiPresence,
  type PopiPresence,
} from "@/lib/popi";
import {
  assignWorkerWorkstations,
  CEILING_BANDS,
  OFFICE_LAYOUT,
  OFFICE_PALETTE as C,
  POPI_WORKSTATION,
} from "@/lib/office";
import { resolveAtmosphere, resolveRoomLighting, atmosphereBreath, type RoomAtmosphere } from "@/lib/environment";
import {
  selectRenderableWorkers,
  WORKER_TERMINAL_TTL_MS,
} from "@/lib/worker-visuals";
import {
  resolvePopiBehavior,
  resolveVisor,
  type VisorMode,
} from "@/lib/popi-behavior";
import { usePrefersReducedMotion } from "./use-prefers-reduced-motion";
import { createBadgeTexture } from "./label-texture";
import { PopiScreenAnchor, type PopiAnchorProbe } from "./PopiSpeechBubble";
import { OfficeRoom } from "./Room";
import { ServerRack } from "./ServerRack";
import { WorkerStation } from "./WorkerStation";
import { Workstation } from "./Workstation";

/**
 * Camera framing. The target sits between Popi and her workstation so both read
 * as the subject, and the direction keeps the asymmetric room (near left wall,
 * far right wall) in frame. `CAMERA_TARGET` is height 1.45 because Popi's head
 * sits around y = 2.2 at the character scale used in `popi.ts`.
 */
const CAMERA_TARGET: [number, number, number] = [0, 1.45, 0.7];
const CAMERA_DIRECTION = new THREE.Vector3(0.6, 0.45, 1).normalize();
const RETENTION_TICK_MS = 2000;

type OrbitLike = {
  target: THREE.Vector3;
  update: () => void;
};

function StatusLight({
  status,
  presence,
  visor,
}: {
  status: AgentStatus;
  presence: PopiPresence;
  /** Phantom mode: the agent light cools to terminal cyan. */
  visor: boolean;
}) {
  const light = useRef<THREE.PointLight>(null);

  useFrame((state) => {
    if (!light.current) return;

    light.current.intensity = getPointLightIntensity(
      status,
      state.clock.elapsedTime,
      presence,
    );
  });

  return (
    <pointLight
      ref={light}
      position={[0, 2.6, -1.6]}
      intensity={1}
      distance={16}
      decay={2}
      color={visor ? "#22d3ee" : getPointLightColor(status, presence)}
    />
  );
}


/**
 * Retention clock. Terminal workers stay visible until their TTL lapses, which
 * needs a low-frequency re-render. `useSyncExternalStore` is the idiomatic way
 * to read an external, time-based value without calling impure functions during
 * render or setting state directly inside an effect.
 */
function subscribeRetentionClock(onStoreChange: () => void): () => void {
  const id = window.setInterval(onStoreChange, RETENTION_TICK_MS);

  return () => window.clearInterval(id);
}

function getRetentionSnapshot(): number {
  return Math.floor(Date.now() / RETENTION_TICK_MS);
}

/**
 * Worker state arrives over SSE after mount, so the server snapshot only needs
 * to be stable; it is never used to render real workers.
 */
function getRetentionServerSnapshot(): number {
  return 0;
}

function useRetentionNow(): number {
  const tick = useSyncExternalStore(
    subscribeRetentionClock,
    getRetentionSnapshot,
    getRetentionServerSnapshot,
  );

  return tick * RETENTION_TICK_MS;
}

function OverflowBadge({ count }: { count: number }) {
  const material = useRef<THREE.SpriteMaterial>(null);
  const text = `+${count} more worker${count === 1 ? "" : "s"}`;

  useEffect(() => {
    const texture = createBadgeTexture(text);
    const current = material.current;

    if (current) {
      current.map = texture;
      current.needsUpdate = true;
    }

    return () => {
      texture.dispose();
    };
  }, [text]);

  return (
    <sprite position={[0, 3.5, -4.5]} scale={[3.2, 0.8, 1]}>
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

/**
 * Cyan rim + violet bounce. Both breathe on the shared atmosphere model, so an
 * IDLE room drifts gently while WORKING/ERROR read as clearly livelier. Under
 * reduced motion they hold a single static value.
 *
 * In Phantom mode the room goes colder: the rim hardens to terminal cyan and
 * the violet bounce drops away.
 */
function StructuralLights({
  atmosphere,
  lighting,
  visor,
  reducedMotion,
}: {
  atmosphere: RoomAtmosphere;
  lighting: { rim: number; fill: number };
  visor: boolean;
  reducedMotion: boolean;
}) {
  const rim = useRef<THREE.PointLight>(null);
  const fill = useRef<THREE.PointLight>(null);

  useFrame((state) => {
    const breath = reducedMotion
      ? 1
      : atmosphereBreath(atmosphere.mood, state.clock.elapsedTime);

    if (rim.current) {
      rim.current.intensity = lighting.rim * breath;
    }

    if (fill.current) {
      fill.current.intensity = lighting.fill * breath * (visor ? 0.45 : 1);
    }
  });

  return (
    <>
      <pointLight
        ref={rim}
        position={[2, 3.4, -4.6]}
        intensity={lighting.rim}
        distance={21}
        decay={2}
        color={visor ? "#67e8f9" : C.accent}
      />
      <pointLight
        ref={fill}
        position={[-6.2, 2.6, 2.4]}
        intensity={lighting.fill}
        distance={17}
        decay={2}
        color={visor ? "#64748b" : C.violet}
      />
    </>
  );
}

/**
 * Ceiling light bands. Without them the room has no overhead source and the
 * walls collapse into the background color, which is exactly what made the
 * office read as nearly black.
 */
function CeilingLights({
  intensity,
  reducedMotion,
}: {
  intensity: number;
  reducedMotion: boolean;
}) {
  const lights = useRef<Array<THREE.PointLight | null>>([]);

  useFrame((state) => {
    const t = reducedMotion ? 0 : state.clock.elapsedTime;

    lights.current.forEach((light, index) => {
      if (!light) return;

      light.intensity = intensity * (1 + Math.sin(t * 0.8 + index * 1.7) * 0.05);
    });
  });

  return (
    <>
      {CEILING_BANDS.map((z, index) => (
        <pointLight
          key={z}
          ref={(light) => {
            lights.current[index] = light;
          }}
          position={[0, OFFICE_LAYOUT.ceilingY - 0.5, z]}
          intensity={intensity}
          distance={15}
          decay={2}
          color="#dbeafe"
        />
      ))}
    </>
  );
}

function CameraRig({ focusDistance }: { focusDistance: number }) {
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);
  const controls = useThree((state) => state.controls) as unknown as
    | OrbitLike
    | null;

  useEffect(() => {
    const aspect = size.height > 0 ? size.width / size.height : 1;
    // Narrow viewports need more distance, not less: the workstation plus the
    // character has to stay inside the shorter axis.
    const aspectDistance = aspect < 1 ? 9.8 : aspect < 1.5 ? 8.6 : 7.2;
    const distance = Math.max(aspectDistance, focusDistance);
    const target = new THREE.Vector3(...CAMERA_TARGET);

    camera.position
      .copy(target)
      .addScaledVector(CAMERA_DIRECTION, distance);
    camera.lookAt(target);

    if (controls) {
      controls.target.copy(target);
      controls.update();
    }
  }, [camera, size, controls, focusDistance]);

  return null;
}

export function OfficeScene({
  status,
  workers,
  sseConnected,
  gatewayConnected,
  connectionError,
  tool,
  command,
  turnSeq = 0,
  visorMode = "auto",
  probe,
}: {
  status: AgentStatus;
  workers: WorkerState[];
  sseConnected: boolean;
  gatewayConnected: boolean;
  connectionError: GatewayErrorKind | null;
  /** Live tool name when the agent is using one; drives the tool monitor. */
  tool?: string | null;
  /** Live command/context string for the active tool, when there is one. */
  command?: string | null;
  turnSeq?: number;
  visorMode?: VisorMode;
  probe?: React.RefObject<PopiAnchorProbe>;
}) {
  const now = useRetentionNow();
  const reducedMotion = usePrefersReducedMotion();

  const presence = useMemo(
    () =>
      resolvePopiPresence({
        sseConnected,
        gatewayConnected,
        connectionError,
      }),
    [sseConnected, gatewayConnected, connectionError],
  );

  const atmosphere = useMemo(
    () => resolveAtmosphere(status, presence),
    [status, presence],
  );

  const lighting = useMemo(() => resolveRoomLighting(atmosphere), [atmosphere]);

  const visor = useMemo(
    () => resolveVisor(resolvePopiBehavior(status, presence), visorMode),
    [status, presence, visorMode],
  );

  const visibleWorkers = useMemo(
    () => selectRenderableWorkers(workers, now, WORKER_TERMINAL_TTL_MS),
    [workers, now],
  );

  const layout = useMemo(
    () => assignWorkerWorkstations(visibleWorkers.map((worker) => worker.id)),
    [visibleWorkers],
  );

  const workersById = useMemo(
    () => new Map(visibleWorkers.map((worker) => [worker.id, worker])),
    [visibleWorkers],
  );

  const focusDistance = useMemo(() => {
    const extent = Math.max(
      2.8,
      ...layout.assignments.map(({ spec }) =>
        Math.hypot(spec.position[0], spec.position[2]),
      ),
    );

    return Math.min(15, extent * 0.85 + 3.4);
  }, [layout]);

  return (
    <>
      <color attach="background" args={[C.background]} />
      {/* Depth haze: keeps the far wall from clipping flat against the sky. */}
      <fog attach="fog" args={[C.background, 11, 32]} />

      <ambientLight intensity={lighting.ambient} />
      <hemisphereLight
        args={["#42598a", "#1b2438", lighting.hemisphere]}
      />

      {/* Key light — the only shadow caster. */}
      <directionalLight
        castShadow
        position={[6, 10, 5]}
        intensity={lighting.key}
        color={visor ? "#8fd7f7" : "#dbeafe"}
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-near={1}
        shadow-camera-far={40}
        shadow-camera-left={-16}
        shadow-camera-right={16}
        shadow-camera-top={16}
        shadow-camera-bottom={-16}
        shadow-bias={-0.0005}
      />

      <CeilingLights intensity={lighting.ceilingPoint} reducedMotion={reducedMotion} />

      <StructuralLights
        atmosphere={atmosphere}
        lighting={lighting}
        visor={visor}
        reducedMotion={reducedMotion}
      />

      {/* Cool fill so the right side never falls to mud. */}
      <directionalLight
        position={[-8, 5, 7]}
        intensity={lighting.coolFill}
        color="#93c5fd"
      />

      <StatusLight status={status} presence={presence} visor={visor} />

      <OfficeRoom
        status={status}
        presence={presence}
        reducedMotion={reducedMotion}
      />
      <ServerRack reducedMotion={reducedMotion} />
      <Workstation
        spec={POPI_WORKSTATION}
        status={status}
        presence={presence}
        reducedMotion={reducedMotion}
        tool={tool}
        command={command}
        turnSeq={turnSeq}
        visorMode={visorMode}
        probe={probe}
      />

      {layout.assignments.map(({ workerId, spec }) => {
        const worker = workersById.get(workerId);

        return worker ? (
          <WorkerStation
            key={workerId}
            spec={spec}
            worker={worker}
            reducedMotion={reducedMotion}
          />
        ) : null;
      })}

      {layout.overflow.length > 0 ? (
        <OverflowBadge count={layout.overflow.length} />
      ) : null}

      {probe ? <PopiScreenAnchor probe={probe} /> : null}

      <CameraRig focusDistance={focusDistance} />
      <OrbitControls
        makeDefault
        enablePan={false}
        enableDamping
        minDistance={4}
        maxDistance={17}
        maxPolarAngle={Math.PI / 2.05}
        target={CAMERA_TARGET}
      />
    </>
  );
}
