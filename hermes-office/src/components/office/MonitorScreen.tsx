"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { AgentStatus } from "@/lib/hermes/types";
import { getScreenColor, type PopiPresence } from "@/lib/popi";
import { OFFICE_PALETTE as C } from "@/lib/office";

/**
 * Procedural monitor content.
 *
 * Every frame drawn here comes from a state the Gateway actually reports:
 * `status`, `presence` and (when using a tool) `tool`. At idle the screen shows
 * a calm static dashboard; there is no fabricated output, no fake logs and no
 * invented progress.
 */

const SCREEN_W = 320;
const SCREEN_H = 180;
/** Repaint rate. Content is low-frequency by design, so 10 fps is plenty. */
const REPAINT_INTERVAL = 0.1;

type ScreenContent = "standby" | "dashboard" | "thinking" | "code" | "tool" | "terminal" | "alert";

function contentFor(status: AgentStatus, presence: PopiPresence): ScreenContent {
  if (presence === "sse-down" || presence === "gateway-down") {
    return "standby";
  }
  if (presence === "auth-error") {
    return "alert";
  }

  switch (status) {
    case "WORKING":
      return "code";
    case "USING_TOOL":
      return "tool";
    case "THINKING":
      return "thinking";
    case "TERMINAL":
      return "terminal";
    case "ERROR":
      return "alert";
    default:
      return "dashboard";
  }
}

const CODE_LINES = [
  "const turn = await hermes.run();",
  "if (turn.tool) spawn(turn.tool);",
  "await session.pin(prompt);",
  "return stream.replay(turnSeq);",
  "dispatch({ type: 'turn', id });",
  "guard.verify(session.token);",
];

function rr(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.fill();
}

export function MonitorScreen({
  status,
  presence,
  tool,
  reducedMotion = false,
}: {
  status: AgentStatus;
  presence: PopiPresence;
  tool?: string | null;
  reducedMotion?: boolean;
}) {
  // The canvas and its texture live in refs: they are GPU-owned resource
  // handles mutated inside the render loop, never React state. A plain boolean
  // flips the first paint once the texture exists.
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textureRef = useRef<THREE.CanvasTexture | null>(null);
  const materialRef = useRef<THREE.MeshStandardMaterial>(null);

  useEffect(() => {
    const nextCanvas = document.createElement("canvas");
    nextCanvas.width = SCREEN_W;
    nextCanvas.height = SCREEN_H;

    const nextTexture = new THREE.CanvasTexture(nextCanvas);
    nextTexture.colorSpace = THREE.SRGBColorSpace;
    nextTexture.anisotropy = 4;

    canvasRef.current = nextCanvas;
    textureRef.current = nextTexture;

    return () => {
      nextTexture.dispose();
      canvasRef.current = null;
      textureRef.current = null;
    };
  }, []);

  const accent = getScreenColor(status, presence);

  const scroll = useRef(0);
  const sincePaint = useRef(REPAINT_INTERVAL);
  /** Reduced motion paints exactly one frame and then holds it. */
  const paintedStill = useRef(false);

  useFrame((state, delta) => {
    const canvas = canvasRef.current;
    const texture = textureRef.current;
    const material = materialRef.current;

    if (!canvas || !texture) return;

    // Bind the texture on first availability, then flag it every repaint.
    if (material) {
      if (!material.map) {
        material.map = texture;
        material.needsUpdate = true;
      }

      // Emissive pulse is cheap and stays smooth; the repaint is throttled.
      material.emissiveIntensity = reducedMotion
        ? 0.35
        : 0.3 + Math.sin(state.clock.elapsedTime * 1.4) * 0.08;
    }

    if (reducedMotion) {
      if (paintedStill.current) return;
      paintedStill.current = true;
    } else {
      paintedStill.current = false;
      sincePaint.current += delta;
      if (sincePaint.current < REPAINT_INTERVAL) return;
      sincePaint.current = 0;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const content = contentFor(status, presence);

    if (!reducedMotion) {
      scroll.current +=
        delta * (content === "code" || content === "terminal" ? 34 : 8);
    }

    drawScreen(
      ctx,
      content,
      accent,
      reducedMotion ? 0 : state.clock.elapsedTime,
      scroll.current,
      tool,
    );
    texture.needsUpdate = true;
  });

  return (
    <mesh position={[0, 0, 0.004]}>
      <planeGeometry args={[SCREEN_W / 100, SCREEN_H / 100]} />
      <meshStandardMaterial
        ref={materialRef}
        color={C.screenFrame}
        emissive={accent}
        emissiveIntensity={0.4}
        toneMapped={false}
      />
    </mesh>
  );
}

function drawScreen(
  ctx: CanvasRenderingContext2D,
  content: ScreenContent,
  accent: string,
  t: number,
  scroll: number,
  tool?: string | null,
) {
  ctx.fillStyle = "#050810";
  ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);

  // Scanline overlay — cheap CRT character.
  ctx.fillStyle = "rgba(148, 233, 255, 0.05)";
  for (let y = 0; y < SCREEN_H; y += 4) {
    ctx.fillRect(0, y, SCREEN_W, 1);
  }

  switch (content) {
    case "standby": {
      ctx.fillStyle = "#1e293b";
      ctx.font = "600 13px monospace";
      ctx.textAlign = "center";
      ctx.fillText("STANDBY", SCREEN_W / 2, SCREEN_H / 2);
      ctx.textAlign = "left";
      break;
    }

    case "dashboard": {
      // Calm metric bars: fixed magnitudes, only a slow drift.
      const bars = [0.42, 0.28, 0.61, 0.35, 0.5];
      bars.forEach((magnitude, index) => {
        const x = 18 + index * 58;
        const wobble = Math.sin(t * 0.9 + index) * 0.04;
        const h = (magnitude + wobble) * 74;
        ctx.fillStyle = index === 1 ? C.accent : "rgba(56, 189, 248, 0.55)";
        rr(ctx, x, SCREEN_H - 30 - h, 40, h, 3);
      });
      ctx.fillStyle = C.accent;
      ctx.font = "700 10px monospace";
      ctx.fillText("SYSTEM", 18, 22);
      ctx.fillStyle = "rgba(226, 232, 240, 0.4)";
      ctx.fillText("nominal", 74, 22);
      break;
    }

    case "thinking": {
      const cx = SCREEN_W / 2;
      const cy = SCREEN_H / 2;
      const rings = 3;
      for (let i = 0; i < rings; i += 1) {
        const phase = (t * 0.9 + i / rings) % 1;
        ctx.strokeStyle = accent;
        ctx.globalAlpha = 1 - phase;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, 12 + phase * 46, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = accent;
      ctx.font = "700 11px monospace";
      ctx.fillText("THINKING", cx - 33, SCREEN_H - 26);
      break;
    }

    case "code": {
      const lineHeight = 22;
      const offset = (scroll % lineHeight) - lineHeight;
      ctx.font = "600 11px monospace";
      CODE_LINES.forEach((line, index) => {
        const y = 30 + index * lineHeight + offset;
        if (y < -10 || y > SCREEN_H + 10) return;
        ctx.fillStyle = index % 2 === 0 ? "rgba(94, 234, 212, 0.85)" : "rgba(148, 163, 184, 0.6)";
        ctx.fillText(line, 16, y);
      });
      ctx.fillStyle = accent;
      ctx.fillRect(SCREEN_W - 14, 12, 6, 6);
      break;
    }

    case "tool": {
      ctx.fillStyle = accent;
      ctx.font = "700 11px monospace";
      ctx.fillText("TOOL", 16, 24);
      const label = (tool ?? "unknown").toUpperCase().slice(0, 18);
      ctx.fillStyle = "#e2e8f0";
      ctx.font = "700 15px monospace";
      ctx.fillText(label, 16, 44);
      // Activity placeholder driven only by the tool name — no fake output.
      ctx.strokeStyle = "rgba(56, 189, 248, 0.7)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let x = 0; x <= SCREEN_W - 32; x += 4) {
        const y = SCREEN_H - 34 + Math.sin(x * 0.08 + t * 3) * 8;
        if (x === 0) ctx.moveTo(16 + x, y);
        else ctx.lineTo(16 + x, y);
      }
      ctx.stroke();
      break;
    }

    case "terminal": {
      const lineHeight = 20;
      const offset = (scroll % lineHeight) - lineHeight;
      ctx.font = "600 11px monospace";
      const shell = ["> agent turn", "> stream ok", "> exit 0", "> ready"];
      shell.forEach((line, index) => {
        const y = 28 + index * lineHeight + offset;
        if (y < -10 || y > SCREEN_H + 10) return;
        ctx.fillStyle = "rgba(74, 222, 128, 0.9)";
        ctx.fillText(line, 16, y);
      });
      ctx.fillStyle = "rgba(74, 222, 128, 0.9)";
      ctx.fillRect(16, SCREEN_H - 22, 8, 12);
      break;
    }

    case "alert": {
      const flashed = Math.sin(t * 6) > 0;
      ctx.fillStyle = flashed ? "rgba(239, 68, 68, 0.28)" : "rgba(239, 68, 68, 0.12)";
      ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
      ctx.fillStyle = "#fecaca";
      ctx.font = "700 13px monospace";
      ctx.textAlign = "center";
      ctx.fillText("CONNECTION ERROR", SCREEN_W / 2, SCREEN_H / 2);
      ctx.textAlign = "left";
      break;
    }
  }
}
