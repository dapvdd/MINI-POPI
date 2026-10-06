"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";

type AgentStatus =
  | "OFFLINE"
  | "IDLE"
  | "THINKING"
  | "USING_TOOL"
  | "WORKING"
  | "TERMINAL"
  | "ERROR";

type HermesEvent = {
  type: string;
  payload?: Record<string, any>;
};

/* =========================================================
   3D AGENT
========================================================= */

function Agent({ status }: { status: AgentStatus }) {
  const group = useRef<THREE.Group>(null);

const working =
  status === "WORKING" ||
  status === "USING_TOOL" ||
  status === "TERMINAL" ||
  status === "THINKING";

  useFrame((state) => {
    if (!group.current) return;

    const t = state.clock.elapsedTime;

    if (working) {
      group.current.position.y =
        0.05 + Math.sin(t * 10) * 0.12;

      group.current.rotation.z =
        Math.sin(t * 7) * 0.08;

      group.current.rotation.y =
        Math.sin(t * 4) * 0.12;
    } else {
      group.current.position.y = 0.05;
      group.current.rotation.z = 0;
      group.current.rotation.y = 0;
    }
  });

const bodyColor =
  status === "ERROR"
    ? "#ef4444"
    : status === "WORKING" ||
        status === "USING_TOOL" ||
        status === "TERMINAL"
      ? "#f59e0b"
      : status === "THINKING"
        ? "#a78bfa"
        : "#60a5fa";

  return (
    <group ref={group} position={[0, 0.05, 0]}>
      {/* BODY */}
      <mesh position={[0, 0.8, 0]}>
        <capsuleGeometry args={[0.35, 0.7, 8, 16]} />
        <meshStandardMaterial color={bodyColor} />
      </mesh>

      {/* HEAD */}
      <mesh position={[0, 1.65, 0]}>
        <sphereGeometry args={[0.38, 24, 24]} />
        <meshStandardMaterial color="#e5e7eb" />
      </mesh>

      {/* EYES */}
      <mesh position={[-0.13, 1.68, 0.34]}>
        <sphereGeometry args={[0.045, 12, 12]} />
        <meshStandardMaterial color="#111827" />
      </mesh>

      <mesh position={[0.13, 1.68, 0.34]}>
        <sphereGeometry args={[0.045, 12, 12]} />
        <meshStandardMaterial color="#111827" />
      </mesh>

      {/* ARMS */}
      <mesh position={[-0.42, 0.8, 0]}>
        <boxGeometry args={[0.16, 0.55, 0.16]} />
        <meshStandardMaterial color={bodyColor} />
      </mesh>

      <mesh position={[0.42, 0.8, 0]}>
        <boxGeometry args={[0.16, 0.55, 0.16]} />
        <meshStandardMaterial color={bodyColor} />
      </mesh>
    </group>
  );
}

/* =========================================================
   DESK
========================================================= */

function Desk() {
  return (
    <group>
      <mesh position={[0, 0.65, 0]}>
        <boxGeometry args={[4, 0.25, 2]} />
        <meshStandardMaterial color="#3f3f46" />
      </mesh>

      {[
        [-1.7, 0.2, -0.7],
        [1.7, 0.2, -0.7],
        [-1.7, 0.2, 0.7],
        [1.7, 0.2, 0.7],
      ].map((position, index) => (
        <mesh
          key={index}
          position={position as [number, number, number]}
        >
          <boxGeometry args={[0.15, 0.9, 0.15]} />
          <meshStandardMaterial color="#27272a" />
        </mesh>
      ))}
    </group>
  );
}

/* =========================================================
   MONITOR
========================================================= */

function Monitor({ status }: { status: AgentStatus }) {
  const working =
    status === "WORKING" ||
    status === "USING_TOOL" ||
    status === "TERMINAL" ||
    status === "THINKING";

  const screenColor =
    status === "ERROR"
      ? "#ef4444"
      : status === "THINKING"
        ? "#a78bfa"
        : working
          ? "#f59e0b"
          : "#22c55e";

  return (
    <group position={[0, 1.45, -0.55]}>
      <mesh>
        <boxGeometry args={[2.2, 1.3, 0.12]} />
        <meshStandardMaterial
          color="#09090b"
          emissive={screenColor}
          emissiveIntensity={working ? 1.5 : 0.25}
        />
      </mesh>

      <mesh position={[0, -0.8, 0]}>
        <boxGeometry args={[0.12, 0.6, 0.12]} />
        <meshStandardMaterial color="#52525b" />
      </mesh>

      <mesh position={[0, -1.1, 0]}>
        <boxGeometry args={[0.7, 0.08, 0.35]} />
        <meshStandardMaterial color="#52525b" />
      </mesh>
    </group>
  );
}

/* =========================================================
   SCENE
========================================================= */

function Scene({ status }: { status: AgentStatus }) {
  return (
    <>
      <ambientLight intensity={1.2} />

      <directionalLight
        position={[5, 8, 5]}
        intensity={2}
      />

      <pointLight
        position={[0, 3, -2]}
        intensity={workingIntensity(status)}
        color={
          status === "ERROR"
            ? "#ef4444"
            : status === "THINKING"
              ? "#a78bfa"
              : "#f59e0b"
        }
      />

      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -0.3, 0]}
      >
        <planeGeometry args={[12, 10]} />
        <meshStandardMaterial color="#18181b" />
      </mesh>

      <Desk />
      <Monitor status={status} />
      <Agent status={status} />

      <OrbitControls
        enablePan={false}
        minDistance={4}
        maxDistance={12}
      />
    </>
  );
}

function workingIntensity(status: AgentStatus) {
  if (status === "WORKING") return 8;
  if (status === "USING_TOOL") return 6;
  if (status === "TERMINAL") return 6;
  if (status === "THINKING") return 4;
  if (status === "ERROR") return 7;

  return 1;
}

/* =========================================================
   MAIN
========================================================= */

export default function Home() {
  const [connected, setConnected] = useState(false);

  const [status, setStatus] =
    useState<AgentStatus>("OFFLINE");

  const [tool, setTool] = useState("-");

  const [command, setCommand] =
    useState("-");

  const [output, setOutput] =
    useState("-");

  const [prompt, setPrompt] =
    useState("");

  const [events, setEvents] =
    useState<string[]>([]);

    useEffect(() => {
  const source = new EventSource("/api/hermes/events");

  source.onopen = () => {
    console.log("📡 Connected to Hermes SSE");
    setConnected(true);
  };

  source.onmessage = (event) => {
    console.log("📡 HERMES STATE:", event.data);

    try {
      const state = JSON.parse(event.data);

      setStatus(state.status ?? "OFFLINE");
      setTool(state.tool ?? "-");
      setCommand(state.command ?? "-");
      setOutput(state.lastOutput ?? "-");

      setEvents((prev) => [
        state.status ?? "UNKNOWN",
        ...prev,
      ].slice(0, 20));
    } catch {
      console.error(
        "❌ Invalid Hermes SSE data:",
        event.data,
      );
    }
  };

  source.onerror = () => {
    console.error("❌ Hermes SSE disconnected");
    setConnected(false);
    setStatus("OFFLINE");
  };

  return () => {
    source.close();
  };
}, []);

  /* =======================================================
     SEND TO BRIDGE
  ======================================================= */

async function sendPrompt(text: string) {
  const clean = text.trim();

  if (!clean) return;

  try {
    console.log("📤 Sending prompt:", clean);

    const sessionResponse = await fetch(
      "/api/hermes/session",
      {
        method: "POST",
      },
    );

    const sessionData = await sessionResponse.json();

    if (!sessionResponse.ok || !sessionData.ok) {
      throw new Error(
        sessionData.error ??
          "Gagal membuat Hermes session",
      );
    }

    const sessionId =
      sessionData.session.session_id;

    console.log("🆕 Hermes session:", sessionId);

    const promptResponse = await fetch(
      "/api/hermes/prompt",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          session_id: sessionId,
          prompt: clean,
        }),
      },
    );

    const promptData = await promptResponse.json();

    if (!promptResponse.ok || !promptData.ok) {
      throw new Error(
        promptData.error ??
          "Gagal mengirim prompt",
      );
    }

    console.log("✅ Prompt submitted");

    setPrompt("");
  } catch (error) {
    console.error(
      "❌ Failed to send prompt:",
      error,
    );

    setStatus("ERROR");
  }
}

function runTest() {
  sendPrompt(
    "Gunakan terminal tool untuk menjalankan perintah berikut: printf 'HERMES OFFICE TEST\n'. Setelah selesai, balas singkat bahwa berhasil.",
  );
}

  /* =======================================================
     UI
  ======================================================= */

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#09090b",
        color: "white",
        fontFamily: "monospace",
      }}
    >
      {/* HEADER */}

      <header
        style={{
          padding: "18px 28px",
          borderBottom:
            "1px solid #27272a",
          display: "flex",
          justifyContent:
            "space-between",
          alignItems: "center",
        }}
      >
        <strong>
          🤖 HERMES VIRTUAL OFFICE
        </strong>

        <span
          style={{
            color: connected
              ? "#4ade80"
              : "#ef4444",
          }}
        >
          {connected
            ? "🟢 CONNECTED"
            : "🔴 OFFLINE"}
        </span>
      </header>

      {/* 3D OFFICE */}

      <section
        style={{
          height: "65vh",
        }}
      >
        <Canvas
          camera={{
            position: [5, 4, 6],
            fov: 50,
          }}
        >
          <Scene status={status} />
        </Canvas>
      </section>

      {/* CONTROL PANEL */}

      <section
        style={{
          padding: "20px 28px",
          borderTop:
            "1px solid #27272a",
          background: "#111113",
        }}
      >
        {/* STATUS */}

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <div
            style={{
              fontSize: 24,
              fontWeight: "bold",
            }}
          >
            {status}
          </div>
        </div>

        {/* TOOL INFO */}

        <div
          style={{
            marginTop: 10,
            color: "#a1a1aa",
          }}
        >
          Tool: {tool}
        </div>

        <div
          style={{
            marginTop: 4,
            color: "#a1a1aa",
          }}
        >
          Command: {command}
        </div>

        <div
          style={{
            marginTop: 4,
            color: "#86efac",
            whiteSpace: "pre-wrap",
          }}
        >
          Output: {output}
        </div>

        {/* BUTTONS */}

        <div
          style={{
            display: "flex",
            gap: 10,
            marginTop: 18,
          }}
        >
          <button
            onClick={runTest}
            disabled={!connected}
            style={{
              padding:
                "10px 18px",
              borderRadius: 8,
              border:
                "1px solid #3f3f46",
              background:
                connected
                  ? "#27272a"
                  : "#18181b",
              color: "white",
              cursor:
                connected
                  ? "pointer"
                  : "not-allowed",
              fontFamily:
                "monospace",
              fontWeight:
                "bold",
            }}
          >
            ▶ RUN TEST
          </button>

          <button
            onClick={() => {
              setEvents([]);
            }}
            style={{
              padding:
                "10px 18px",
              borderRadius: 8,
              border:
                "1px solid #3f3f46",
              background: "#18181b",
              color: "#a1a1aa",
              cursor: "pointer",
              fontFamily:
                "monospace",
            }}
          >
            CLEAR LOG
          </button>
        </div>

        {/* PROMPT */}

        <div
          style={{
            display: "flex",
            gap: 10,
            marginTop: 14,
          }}
        >
          <input
            value={prompt}
            onChange={(e) =>
              setPrompt(e.target.value)
            }
            onKeyDown={(e) => {
              if (
                e.key === "Enter"
              ) {
                sendPrompt(prompt);
              }
            }}
            placeholder="Kirim task ke Hermes..."
            style={{
              flex: 1,
              padding:
                "11px 14px",
              borderRadius: 8,
              border:
                "1px solid #3f3f46",
              background:
                "#09090b",
              color: "white",
              outline: "none",
              fontFamily:
                "monospace",
            }}
          />

          <button
            onClick={() =>
              sendPrompt(prompt)
            }
            disabled={
              !connected ||
              !prompt.trim()
            }
            style={{
              padding:
                "10px 20px",
              borderRadius: 8,
              border:
                "1px solid #3f3f46",
              background:
                "#27272a",
              color: "white",
              cursor:
                connected &&
                prompt.trim()
                  ? "pointer"
                  : "not-allowed",
              fontFamily:
                "monospace",
            }}
          >
            SEND
          </button>
        </div>

        {/* EVENT LOG */}

        <div
          style={{
            marginTop: 20,
            padding: 12,
            border:
              "1px solid #27272a",
            borderRadius: 8,
            background: "#09090b",
            maxHeight: 180,
            overflow: "auto",
          }}
        >
          <div
            style={{
              color: "#71717a",
              marginBottom: 8,
            }}
          >
            EVENT STREAM
          </div>

          {events.length === 0 ? (
            <div
              style={{
                color: "#52525b",
              }}
            >
              Waiting for Hermes events...
            </div>
          ) : (
            events.map(
              (event, index) => (
                <div
                  key={`${event}-${index}`}
                  style={{
                    color:
                      index === 0
                        ? "#facc15"
                        : "#71717a",
                    marginTop: 3,
                  }}
                >
                  {event}
                </div>
              )
            )
          )}
        </div>
      </section>
    </main>
  );
}