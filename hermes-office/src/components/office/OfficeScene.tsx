"use client";

import { OrbitControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
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
  OFFICE_PALETTE as C,
  POPI_WORKSTATION,
} from "@/lib/office";
import { atmosphereBreath, resolveAtmosphere, type RoomAtmosphere } from "@/lib/environment";
import {
  selectRenderableWorkers,
  WORKER_TERMINAL_TTL_MS,
} from "@/lib/worker-visuals";
import { createBadgeTexture } from "./label-texture";
import { OfficeRoom } from "./Room";
import { ServerRack } from "./ServerRack";
import { WorkerStation } from "./WorkerStation";
import { Workstation } from "./Workstation";

const CAMERA_TARGET: [number, number, number] = [0, 1.25, 0.2];
const CAMERA_DIRECTION = new THREE.Vector3(0.6, 0.45, 1).normalize();
const RETENTION_TICK_MS = 2000;

type OrbitLike = {
  target: THREE.Vector3;
  update: () => void;
};

function StatusLight({
  status,
  presence,
}: {
  status: AgentStatus;
  presence: PopiPresence;
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
      color={getPointLightColor(status, presence)}
    />
  );
}

/**
 * One media-query subscription for the whole scene. When the user prefers
 * reduced motion, pose helpers collapse to a single stable frame so no
 * continuous oscillation reaches the render loop.
 */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) {
      return;
    }

    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);

    update();
    query.addEventListener("change", update);

    return () => query.removeEventListener("change", update);
  }, []);

  return reduced;
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
 */
function StructuralLights({
  atmosphere,
  reducedMotion,
}: {
  atmosphere: RoomAtmosphere;
  reducedMotion: boolean;
}) {
  const rim = useRef<THREE.PointLight>(null);
  const fill = useRef<THREE.PointLight>(null);

  useFrame((state) => {
    const breath = reducedMotion
      ? 1
      : atmosphereBreath(atmosphere.mood, state.clock.elapsedTime);

    if (rim.current) {
      rim.current.intensity = atmosphere.rim * 3 * breath;
    }

    if (fill.current) {
      fill.current.intensity = atmosphere.fill * 3.4 * breath;
    }
  });

  return (
    <>
      <pointLight
        ref={rim}
        position={[2, 3.4, -4.6]}
        intensity={atmosphere.rim * 3}
        distance={21}
        decay={2}
        color={C.accent}
      />
      <pointLight
        ref={fill}
        position={[-6.2, 2.6, 2.4]}
        intensity={atmosphere.fill * 3.4}
        distance={17}
        decay={2}
        color={C.violet}
      />
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
    const aspectDistance = aspect < 1 ? 11.5 : aspect < 1.5 ? 9.5 : 8;
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
}: {
  status: AgentStatus;
  workers: WorkerState[];
  sseConnected: boolean;
  gatewayConnected: boolean;
  connectionError: GatewayErrorKind | null;
  /** Live tool name when the agent is using one; drives the tool monitor. */
  tool?: string | null;
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
      2.6,
      ...layout.assignments.map(({ spec }) =>
        Math.hypot(spec.position[0], spec.position[2]),
      ),
    );

    return Math.min(15, extent * 0.95 + 4);
  }, [layout]);

  return (
    <>
      <color attach="background" args={[C.background]} />
      {/* Depth haze: keeps the far wall from clipping flat against the sky. */}
      <fog attach="fog" args={[C.background, 14, 34]} />

      <ambientLight intensity={atmosphere.ambient} />
      <hemisphereLight
        args={["#24365c", "#070b14", atmosphere.hemisphere]}
      />

      {/* Key light — the only shadow caster. */}
      <directionalLight
        castShadow
        position={[6, 10, 5]}
        intensity={1.35}
        color="#dbeafe"
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-near={1}
        shadow-camera-far={40}
        shadow-camera-left={-16}
        shadow-camera-right={16}
        shadow-camera-top={16}
        shadow-camera-bottom={-16}
        shadow-bias={-0.0005}
      />

      <StructuralLights atmosphere={atmosphere} reducedMotion={reducedMotion} />

      {/* Cool fill so the right side never falls to mud. */}
      <directionalLight
        position={[-8, 5, 7]}
        intensity={0.5}
        color="#93c5fd"
      />

      <StatusLight status={status} presence={presence} />

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
