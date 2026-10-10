"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import {
  initialBubbleState,
  selectBubble,
  type BubbleMessage,
  type BubbleState,
} from "@/lib/speech-bubble";

/**
 * Popi's speech bubble.
 *
 * The bubble is anchored to Popi's projected screen position, not to a guessed
 * pixel: an in-canvas probe publishes her world position every frame, an
 * in-canvas anchor projects it to NDC, and the DOM overlay reads the result
 * inside its own `requestAnimationFrame` loop. Neither loop ever touches React
 * state, so a moving character costs a style write and nothing else.
 *
 * When the projection is unavailable — the character is out of frame, the
 * camera has not produced a matrix yet, or the value is not a number — the
 * bubble falls back to a fixed spot near the top of the 3D viewport instead of
 * rendering at a wrong coordinate.
 */

/** Where Popi currently is, in world space and projected screen space. */
export interface PopiAnchorProbe {
  /** World position of Popi's head. */
  x: number;
  y: number;
  z: number;
  /** Normalised device coordinates, only meaningful while `onScreen`. */
  ndcX: number;
  ndcY: number;
  /** False until the first projection lands, or while she is off-screen. */
  onScreen: boolean;
}

export function createPopiAnchorProbe(): PopiAnchorProbe {
  return { x: 0, y: 0, z: 0, ndcX: 0, ndcY: 0, onScreen: false };
}

/** Lives inside the Canvas: turns the probe's world point into NDC. */
export function PopiScreenAnchor({
  probe,
}: {
  probe: React.RefObject<PopiAnchorProbe>;
}) {
  const camera = useThree((state) => state.camera);
  const vector = useMemo(() => new THREE.Vector3(), []);
  const anchor = useRef<PopiAnchorProbe | null>(null);

  useEffect(() => {
    anchor.current = probe.current;
  }, [probe]);

  useFrame(() => {
    const target = anchor.current;

    if (!target) return;

    vector.set(target.x, target.y, target.z).project(camera);

    target.ndcX = vector.x;
    target.ndcY = vector.y;
    target.onScreen =
      Number.isFinite(vector.x) &&
      Number.isFinite(vector.y) &&
      vector.z < 1 &&
      Math.abs(vector.x) <= 1 &&
      Math.abs(vector.y) <= 1;
  });

  return null;
}

const BUBBLE_TICK_MS = 400;

export interface SpeechBubbleInput {
  sessionId: string | null;
  /** Id of the pending assistant message, or null when nothing is pending. */
  pendingId: number | null;
  turnSeq: number;
  response: string | null;
  responseStatus: "complete" | "error" | "interrupted" | null;
}

/**
 * Resolve *what* the bubble says. Lifecycle rules (dwell, cooldown, de-dup and
 * the session wipe) all live in `lib/speech-bubble.ts` and stay unit-testable.
 */
export function useSpeechBubble(
  input: SpeechBubbleInput,
): BubbleMessage | null {
  const [state, setState] = useState<BubbleState>(() =>
    initialBubbleState(input.sessionId),
  );
  const stateRef = useRef(state);
  const inputRef = useRef(input);

  const evaluate = useCallback(() => {
    const next = selectBubble(stateRef.current, {
      ...inputRef.current,
      now: Date.now(),
    });

    if (next !== stateRef.current) {
      stateRef.current = next;
      setState(next);
    }
  }, []);

  useEffect(() => {
    inputRef.current = input;
    evaluate();
  }, [input, evaluate]);

  useEffect(() => {
    const id = window.setInterval(evaluate, BUBBLE_TICK_MS);

    return () => window.clearInterval(id);
  }, [evaluate]);

  return state.message;
}

/** Keeps the bubble clear of the viewport's own chrome. */
const TOP_MARGIN = 62;
const BOTTOM_MARGIN = 54;
const SIDE_MARGIN = 10;
const DEFAULT_BUBBLE_WIDTH = 210;
const DEFAULT_BUBBLE_HEIGHT = 58;

function ThinkingDots({ reducedMotion }: { reducedMotion: boolean }) {
  return (
    <span className="flex items-center gap-1.5" aria-hidden>
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          className={`h-1.5 w-1.5 rounded-full bg-cyan-300 ${
            reducedMotion ? "" : "animate-pulse"
          }`}
          style={{ animationDelay: `${index * 160}ms` }}
        />
      ))}
      <span className="ml-1 text-[12px] text-cyan-100/80">thinking</span>
    </span>
  );
}

export function PopiSpeechBubble({
  message,
  probe,
  viewportRef,
  reducedMotion,
}: {
  message: BubbleMessage | null;
  probe: React.RefObject<PopiAnchorProbe>;
  viewportRef: React.RefObject<HTMLDivElement | null>;
  reducedMotion: boolean;
}) {
  const bubbleRef = useRef<HTMLDivElement>(null);
  const viewportSize = useRef({ width: 0, height: 0 });
  const bubbleSize = useRef({
    width: DEFAULT_BUBBLE_WIDTH,
    height: DEFAULT_BUBBLE_HEIGHT,
  });

  // Cache the viewport box; the placement loop must not read layout itself.
  useEffect(() => {
    const node = viewportRef.current;

    if (!node) return;

    const measure = () => {
      const rect = node.getBoundingClientRect();

      viewportSize.current = { width: rect.width, height: rect.height };
    };

    measure();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);

      return () => window.removeEventListener("resize", measure);
    }

    const observer = new ResizeObserver(measure);
    observer.observe(node);

    return () => observer.disconnect();
  }, [viewportRef]);

  // The bubble's own size only changes when its content does.
  useEffect(() => {
    const node = bubbleRef.current;

    if (!node) return;

    bubbleSize.current = {
      width: node.offsetWidth || DEFAULT_BUBBLE_WIDTH,
      height: node.offsetHeight || DEFAULT_BUBBLE_HEIGHT,
    };
  }, [message]);

  useEffect(() => {
    let frame = 0;

    const place = () => {
      frame = requestAnimationFrame(place);

      const node = bubbleRef.current;
      const target = probe.current;

      if (!node) return;

      const { width, height } = viewportSize.current;

      if (width <= 0 || height <= 0) return;

      const bubbleWidth = bubbleSize.current.width;
      const bubbleHeight = bubbleSize.current.height;

      let anchorX: number;
      let anchorY: number;

      if (target.onScreen) {
        anchorX = (target.ndcX * 0.5 + 0.5) * width;
        anchorY = (1 - (target.ndcY * 0.5 + 0.5)) * height;
      } else {
        anchorX = width / 2;
        anchorY = TOP_MARGIN + bubbleHeight;
      }

      const halfWidth = bubbleWidth / 2;
      const rawLeft = anchorX - halfWidth;
      const left = Math.min(
        Math.max(rawLeft, SIDE_MARGIN),
        Math.max(SIDE_MARGIN, width - bubbleWidth - SIDE_MARGIN),
      );
      const y = Math.min(
        Math.max(anchorY - bubbleHeight - 26, TOP_MARGIN),
        Math.max(TOP_MARGIN, height - bubbleHeight - BOTTOM_MARGIN),
      );

      node.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(y)}px, 0)`;
    };

    frame = requestAnimationFrame(place);

    return () => cancelAnimationFrame(frame);
  }, [probe]);

  if (!message) return null;

  return (
    <div
      ref={bubbleRef}
      data-popi-bubble={message.id}
      data-bubble-kind={message.kind}
      className="pointer-events-none absolute left-0 top-0 z-20 w-max max-w-[min(280px,72%)]"
    >
      <div
        role="status"
        aria-live="polite"
        className="relative rounded-2xl border border-cyan-300/40 bg-slate-950/90 px-3 py-2 shadow-[0_10px_30px_-12px_rgba(8,145,178,0.7)] backdrop-blur"
      >
        <div className="mb-1 flex items-center gap-2 text-[9px] font-semibold uppercase tracking-widest">
          <span className="text-cyan-300/90">Popi</span>
          {message.kind === "response" ? (
            <span
              className={
                message.tone === "error"
                  ? "text-rose-300/90"
                  : "text-emerald-300/90"
              }
            >
              {message.tone === "error" ? "failed" : "complete"}
            </span>
          ) : null}
        </div>

        {message.kind === "thinking" ? (
          <ThinkingDots reducedMotion={reducedMotion} />
        ) : (
          <p className="m-0 text-[12px] leading-snug text-slate-100">
            {message.text}
          </p>
        )}

        {/* Tail, always pointing down at Popi. */}
        <span
          aria-hidden
          className="absolute -bottom-1 left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 border-b border-r border-cyan-300/40 bg-slate-950/90"
        />
      </div>
    </div>
  );
}
