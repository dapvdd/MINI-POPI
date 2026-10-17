"use client";

import { Canvas } from "@react-three/fiber";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import * as THREE from "three";
import type { AgentStatus } from "@/lib/hermes/types";
import type { GatewayErrorKind } from "@/lib/hermes/connection";
import {
  conversationReducer,
  initialConversationState,
} from "@/lib/conversation";
import {
  workersToArray,
  type WorkerState,
} from "@/lib/hermes/workers";
import type { RuntimeId, RuntimeEvent, RuntimeWorker } from "@/lib/runtime/types";
import {
  mergeOfficeWorkers,
  officeWorkerKindLabel,
  officeWorkerTitle,
  runtimeAccent,
  runtimeLabel,
} from "@/lib/office-workers";
import {
  describeUnifiedInterruptError as describeInterruptError,
  describeUnifiedInterruptResult as describeInterruptResult,
  resolveUnifiedWorkerInterruptAvailability,
  type InterruptMessage,
} from "@/lib/runtime/interrupt";
import { toFormattedOfficeEvent } from "@/lib/runtime/events";
import { createEventIdTracker, nextRetryDelay } from "@/lib/runtime/sse";
import {
  classifyOpenCodeTurn,
  extractPromptOutcome,
} from "@/lib/opencode/turn";
import { getWorkerStatusVisual } from "@/lib/worker-visuals";
import { getBodyColor } from "@/lib/popi";
import type { VisorMode } from "@/lib/popi-behavior";
import { getComposerState } from "@/lib/composer";
import { OfficeScene, type OfficeSceneCameraControls } from "@/components/office/OfficeScene";
import {
  createPopiAnchorProbe,
  PopiSpeechBubble,
  useSpeechBubble,
} from "@/components/office/PopiSpeechBubble";
import { usePrefersReducedMotion } from "@/components/office/use-prefers-reduced-motion";
import { RuntimeControl } from "@/components/RuntimeControl";


/* =========================================================
   UI HELPERS
========================================================= */

type SseState = {
  status?: string;
  tool?: string | null;
  command?: string | null;
  lastOutput?: string | null;
  lastError?: string | null;
  lastResponse?: string | null;
  turnSeq?: number;
  lastResponseStatus?: string | null;
  gatewayConnected?: boolean;
  connectionError?: GatewayErrorKind | null;
  workers?: Record<string, WorkerState>;
};

const BUSY_STATUSES: AgentStatus[] = [
  "THINKING",
  "WORKING",
  "USING_TOOL",
  "TERMINAL",
];

function StatusBadge({ status }: { status: AgentStatus }) {
  const color = getBodyColor(status);
  const busy = BUSY_STATUSES.includes(status);

  return (
    <span
      className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-wider backdrop-blur"
      style={{
        color,
        borderColor: `${color}66`,
        backgroundColor: `${color}1a`,
      }}
    >
      <span
        className={`h-2 w-2 rounded-full ${busy ? "animate-pulse" : ""}`}
        style={{ backgroundColor: color }}
      />
      {status}
    </span>
  );
}

function LinkBadge({
  label,
  online,
}: {
  label: string;
  online: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-wider ${
        online
          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
          : "border-red-500/40 bg-red-500/10 text-red-400"
      }`}
    >
      <span
        className={`h-2 w-2 rounded-full ${
          online ? "bg-emerald-400" : "bg-red-400"
        }`}
      />
      {label} {online ? "up" : "down"}
    </span>
  );
}

function TextBlock({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className: string;
}) {
  return (
    <div>
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
        {label}
      </div>
      <pre
        className={`m-0 overflow-x-auto whitespace-pre-wrap break-words rounded-lg border border-zinc-800 bg-zinc-950/70 px-3 py-2 text-xs leading-relaxed ${className}`}
      >
        {value}
      </pre>
    </div>
  );
}

const PANEL =
  "flex flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/40";
const PANEL_HEADER =
  "flex shrink-0 items-center justify-between gap-2 border-b border-zinc-800 px-4 py-2.5";

/* =========================================================
   MAIN
========================================================= */

export default function Home() {
  const [connected, setConnected] = useState(false);
  const [gatewayConnected, setGatewayConnected] = useState(false);
  const [connectionError, setConnectionError] =
    useState<GatewayErrorKind | null>(null);
  const [status, setStatus] = useState<AgentStatus>("OFFLINE");
  const [tool, setTool] = useState("-");
  const [command, setCommand] = useState("-");
  const [output, setOutput] = useState("-");
  const [lastResponse, setLastResponse] = useState("-");
  const [prompt, setPrompt] = useState("");
  const [events, setEvents] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [conversation, dispatchConversation] = useReducer(
    conversationReducer,
    initialConversationState,
  );
  const [hermesWorkers, setHermesWorkers] = useState<WorkerState[]>([]);
  const [runtimeWorkers, setRuntimeWorkers] = useState<RuntimeWorker[]>([]);
  const [runtimeLive, setRuntimeLive] = useState<Record<string, boolean>>({});
  const [officeWorkers, setOfficeWorkers] = useState<RuntimeWorker[]>([]);
  const [selectedWorkerId, setSelectedWorkerId] = useState<string | null>(null);
  const [targetRuntime, setTargetRuntime] = useState<RuntimeId>("hermes");
  const [opencodeSessionId, setOpencodeSessionId] = useState<string | null>(null);
  const [interrupting, setInterrupting] = useState(false);
  const [interruptMsg, setInterruptMsg] =
    useState<InterruptMessage | null>(null);
  const [visorMode, setVisorMode] = useState<VisorMode>("auto");
  /**
   * Monotonic counter for turns this page actually saw finish (either runtime).
   * Drives the celebration and the speech bubble so each real completed turn
   * has a unique identity without reusing any runtime's server `turnSeq`.
   */
  const [celebrationKey, setCelebrationKey] = useState(0);

  /** Popi's screen-space anchor, published from inside the Canvas. */
  const popiProbe = useRef(createPopiAnchorProbe());
  /** Ref to the 3D viewport box, used to keep the bubble inside it. */
  const viewportRef = useRef<HTMLDivElement>(null);
  const [wheelZoomEnabled, setWheelZoomEnabled] = useState(false);
  const cameraControlsRef = useRef<OfficeSceneCameraControls | null>(null);
  const reducedMotion = usePrefersReducedMotion();

  const syncedRef = useRef(false);
  const turnSeqRef = useRef(0);
  const gatewayRef = useRef(false);
  const workersSigRef = useRef("");
  const officeWorkersRef = useRef<RuntimeWorker[]>([]);
  /**
   * OpenCode turn bookkeeping. `target` is the source session id whose turn is
   * in flight; text is accumulated from the real event stream so the resolved
   * reply is never fabricated. Kept in refs because the unified SSE effect owns
   * a stable listener and must not close over stale state.
   */
  const opencodeTargetRef = useRef<string | null>(null);
  const opencodeAwaitingRef = useRef(false);
  const opencodeTextRef = useRef("");
  const seenEventIdsRef = useRef(createEventIdTracker());

  useEffect(() => {
    const el = document.getElementById("conversation-panel");
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [conversation]);

  useEffect(() => {
    let source: EventSource | null = null;
    let retryTimer: number | null = null;
    let retryDelay = 1000;
    let disposed = false;

    function applyState(raw: string) {
      let state: SseState;

      try {
        state = JSON.parse(raw);
      } catch {
        console.error("❌ Invalid Hermes SSE data:", raw);
        return;
      }

      const nextStatus = (state.status as AgentStatus) ?? "OFFLINE";
      const nextTool = state.tool ?? "-";
      const nextCommand = state.command ?? "-";
      const nextOutput = state.lastOutput ?? "-";
      const nextRunError = state.lastError ?? null;
      const nextResponse = state.lastResponse ?? "-";
      const nextTurnSeq = state.turnSeq ?? 0;
      const nextResponseStatus = state.lastResponseStatus ?? null;
      const nextGateway = state.gatewayConnected ?? false;
      const nextConnectionError = state.connectionError ?? null;

      /*
       * Conversation sync: the first frame fixes the baseline turnSeq so a
       * reconnect does not replay history; every later increment attaches the
       * finished response to the matching pending prompt exactly once.
       */
      if (!syncedRef.current) {
        syncedRef.current = true;
        turnSeqRef.current = nextTurnSeq;
        gatewayRef.current = nextGateway;
        dispatchConversation({
          type: "sync-turn-seq",
          turnSeq: nextTurnSeq,
        });
      } else if (nextTurnSeq > turnSeqRef.current) {
        turnSeqRef.current = nextTurnSeq;
        // Only a turn this session actually watched finish may celebrate.
        setCelebrationKey((previous) => previous + 1);
        dispatchConversation({
          type: "turn-completed",
          runtime: "hermes",
          turnSeq: nextTurnSeq,
          text: nextResponse,
          fallback: nextRunError,
          failed:
            nextResponseStatus === "error" || nextStatus === "ERROR",
        });
      }

      if (gatewayRef.current && !nextGateway) {
        dispatchConversation({ type: "gateway-lost", runtime: "hermes" });
      }
      gatewayRef.current = nextGateway;

      setStatus((prev) => (prev === nextStatus ? prev : nextStatus));
      setTool((prev) => (prev === nextTool ? prev : nextTool));
      setCommand((prev) =>
        prev === nextCommand ? prev : nextCommand,
      );
      setOutput((prev) =>
        prev === nextOutput ? prev : nextOutput,
      );
      setLastResponse((prev) =>
        prev === nextResponse ? prev : nextResponse,
      );
      setRunError((prev) =>
        prev === nextRunError ? prev : nextRunError,
      );
      setGatewayConnected((prev) =>
        prev === nextGateway ? prev : nextGateway,
      );
      setConnectionError((prev) =>
        prev === nextConnectionError ? prev : nextConnectionError,
      );

      const nextWorkers = workersToArray(state.workers ?? {});
      const workersSig = nextWorkers
        .map((worker) => `${worker.id}:${worker.updatedAt}:${worker.status}`)
        .join("|");

      if (workersSig !== workersSigRef.current) {
        workersSigRef.current = workersSig;
        setHermesWorkers(nextWorkers);
      }

      const line =
        nextTool === "-"
          ? nextStatus
          : `${nextStatus} · ${nextTool}`;

      setEvents((prev) =>
        prev[0] === line
          ? prev
          : [line, ...prev].slice(0, 20),
      );
    }

    function open() {
      if (disposed) return;

      source?.close();

      const next = new EventSource("/api/hermes/events");
      source = next;

      next.onopen = () => {
        if (disposed || source !== next) return;
        retryDelay = 1000;
        setConnected(true);
      };

      next.onmessage = (event) => {
        if (disposed || source !== next) return;
        applyState(event.data);
      };

      next.onerror = () => {
        if (disposed || source !== next) return;

        setConnected(false);

        /*
         * While CONNECTING, EventSource retries on its own.
         * Only rebuild it once the browser has given up.
         */
        if (next.readyState !== EventSource.CLOSED) {
          return;
        }

        next.close();

        if (source === next) {
          source = null;
        }

        setStatus((prev) =>
          prev === "OFFLINE" ? prev : "OFFLINE",
        );

        if (retryTimer !== null) return;

        retryTimer = window.setTimeout(() => {
          retryTimer = null;
          open();
        }, retryDelay);

        retryDelay = nextRetryDelay(retryDelay, 10000);
      };
    }

    open();

    return () => {
      disposed = true;

      if (retryTimer !== null) {
        window.clearTimeout(retryTimer);
        retryTimer = null;
      }

      source?.close();
      source = null;
    };
  }, []);

  /* =========================================================
     RUNTIME WORKERS (Phase L)
     OpenCode active sessions (and, for reconciliation, Hermes) are polled
     from /api/runtimes/workers. Each runtime stays independent: a failing
     poll marks that runtime's workers stale instead of dropping them or
     disturbing the other runtime.
  ========================================================= */
  useEffect(() => {
    let disposed = false;

    async function load() {
      try {
        const res = await fetch("/api/runtimes/workers", { cache: "no-store" });
        if (!res.ok) {
          if (!disposed) setRuntimeWorkers([]);
          return;
        }
        const json = (await res.json()) as {
          workers?: RuntimeWorker[];
          runtimes?: Record<string, { ok?: boolean }>;
        };
        if (disposed) return;
        setRuntimeWorkers(Array.isArray(json.workers) ? json.workers : []);
        setRuntimeLive({
          hermes: Boolean(json.runtimes?.hermes?.ok),
          opencode: Boolean(json.runtimes?.opencode?.ok),
        });
      } catch {
        if (!disposed) setRuntimeWorkers([]);
      }
    }

    const initial = window.setTimeout(() => void load(), 0);
    const timer = window.setInterval(() => void load(), 5000);
    return () => {
      disposed = true;
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const now = Date.now();
    const reconcile: Array<"hermes" | "opencode"> = [];
    // Only reconcile a runtime we actually have a fresh snapshot for. An SSE
    // disconnect must not stale Hermes workers from a poll we never got.
    if (connected) reconcile.push("hermes");
    if (runtimeLive.opencode) reconcile.push("opencode");

    const next = mergeOfficeWorkers({
      previous: officeWorkersRef.current,
      hermesWorkers,
      runtimeWorkers,
      reconcile,
      now,
    });

    officeWorkersRef.current = next;

    // Defer out of the effect body (mirrors RuntimeControl) so consumers never
    // see a synchronous cascading render from this derived-state merge.
    const handle = window.setTimeout(() => setOfficeWorkers(next), 0);
    return () => window.clearTimeout(handle);
  }, [hermesWorkers, runtimeWorkers, runtimeLive, connected]);

  /* =========================================================
     MULTI-RUNTIME EVENT STREAM (Phase M)
     Subscribes to /api/runtimes/events to display unified
     events from both Hermes and OpenCode.
  ========================================================= */
  useEffect(() => {
    let source: EventSource | null = null;
    let disposed = false;
    let retryTimer: number | null = null;
    let retryDelay = 2000;

    /**
     * Resolve an in-flight OpenCode turn from real runtime events. The prompt
     * POST only proves *submission*; completion comes from the stream, and the
     * reply text is whatever the runtime actually sent.
     */
    function handleOpenCodeTurn(ev: RuntimeEvent) {
      const target = opencodeTargetRef.current;

      // Only the session we dispatched to, and only while it is in flight: a
      // late frame after completion can never create a second reply.
      if (!target || !opencodeAwaitingRef.current || ev.sourceId !== target) {
        return;
      }

      const update = classifyOpenCodeTurn(ev.type, ev.payload);
      if (!update) return;

      if (update.delta) opencodeTextRef.current += update.delta;
      if (update.text) opencodeTextRef.current = update.text;

      if (update.phase !== "completed" && update.phase !== "failed") {
        return;
      }

      opencodeAwaitingRef.current = false;
      const text = opencodeTextRef.current.trim();
      opencodeTextRef.current = "";

      dispatchConversation({
        type: "turn-completed",
        runtime: "opencode",
        turnId: `opencode:${target}:${ev.id ?? ev.at}`,
        text: text || null,
        fallback: update.error,
        failed: update.phase === "failed",
      });
      setCelebrationKey((previous) => previous + 1);
    }

    function open() {
      if (disposed) return;
      source?.close();

      const es = new EventSource("/api/runtimes/events");
      source = es;

      es.onopen = () => {
        if (disposed || source !== es) return;
        retryDelay = 2000;
      };

      es.onmessage = (event) => {
        if (disposed || source !== es) return;
        try {
          const envelope = JSON.parse(event.data) as {
            type?: string;
            payload?: RuntimeEvent;
          };
          if (envelope.type !== "runtime.event" || !envelope.payload) return;

          const ev = envelope.payload;
          const formatted = toFormattedOfficeEvent(ev);

          // A reconnect can replay a frame; never double-count it.
          if (!seenEventIdsRef.current.accept(formatted.id)) return;

          setEvents((prev) => [formatted.text, ...prev].slice(0, 30));

          if (ev.runtime === "opencode") {
            handleOpenCodeTurn(ev);
          }
        } catch {
          // ignore heartbeat / unparseable
        }
      };

      es.onerror = () => {
        if (disposed || source !== es) return;
        es.close();
        if (source === es) source = null;

        // Guard against overlapping error events scheduling duplicate reconnects.
        if (retryTimer !== null) return;

        retryTimer = window.setTimeout(() => {
          retryTimer = null;
          open();
        }, retryDelay);
        retryDelay = nextRetryDelay(retryDelay);
      };
    }

    open();

    return () => {
      disposed = true;
      if (retryTimer !== null) {
        window.clearTimeout(retryTimer);
        retryTimer = null;
      }
      source?.close();
      source = null;
    };
  }, []);

  /* =========================================================
     SEND TO BRIDGE
  ========================================================= */

  async function readJson(response: Response) {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }

  async function ensureSession() {
    if (sessionId) return sessionId;

    const sessionResponse = await fetch("/api/hermes/session", {
      method: "POST",
    });
    const sessionData = await readJson(sessionResponse);

    if (!sessionResponse.ok || !sessionData?.ok) {
      throw new Error(
        sessionData?.error ?? "Gagal membuat Hermes session",
      );
    }

    const newSessionId = sessionData?.session?.session_id;

    if (!newSessionId || typeof newSessionId !== "string") {
      throw new Error("Hermes session tidak valid");
    }

    setSessionId(newSessionId);
    return newSessionId;
  }

  async function sendPrompt(text: string) {
    const clean = text.trim();
    if (!clean || sending) return;

    if (targetRuntime === "opencode") {
      setSending(true);
      setSubmitError(null);
      dispatchConversation({ type: "user-submitted", text: clean, runtime: "opencode" });

      try {
        let ocSessionId = opencodeSessionId;
        if (!ocSessionId) {
          if (selectedWorker?.runtime === "opencode") {
            ocSessionId = selectedWorker.sourceId;
          } else {
            const listRes = await fetch("/api/runtimes/sessions?runtime=opencode", { cache: "no-store" });
            const listJson = await readJson(listRes);
            const first = listJson?.sessions?.[0]?.sourceId;
            if (first) {
              ocSessionId = String(first);
            } else {
              throw new Error("No active OpenCode session found. Start a session in OpenCode first.");
            }
          }
          setOpencodeSessionId(ocSessionId);
        }

        // Track this turn before the POST so events that arrive while the
        // request is in flight are attributed to the right session.
        opencodeTargetRef.current = ocSessionId;
        opencodeAwaitingRef.current = true;
        opencodeTextRef.current = "";

        const promptRes = await fetch(
          `/api/runtimes/sessions/opencode/${encodeURIComponent(ocSessionId)}/prompt`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: clean }),
          },
        );
        const promptJson = await readJson(promptRes);
        if (!promptRes.ok || !promptJson?.ok) {
          throw new Error(promptJson?.error ?? "Failed to send prompt to OpenCode");
        }

        /*
         * A successful POST only proves the task was *accepted*. If — and only
         * if — the runtime returned a real assistant payload do we complete the
         * turn now; otherwise it stays pending until the event stream reports
         * completion. We never fabricate a reply.
         */
        const outcome = extractPromptOutcome(promptJson?.result);
        if (outcome) {
          opencodeAwaitingRef.current = false;
          opencodeTextRef.current = "";
          dispatchConversation({
            type: "turn-completed",
            runtime: "opencode",
            turnId: `opencode:${ocSessionId}:result:${Date.now()}`,
            text: outcome.text,
            fallback: outcome.error,
            failed: Boolean(outcome.error) && !outcome.text,
          });
          setCelebrationKey((previous) => previous + 1);
        }

        setPrompt("");
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to send prompt to OpenCode";
        console.error("Failed to send prompt to OpenCode:", error);
        opencodeAwaitingRef.current = false;
        opencodeTextRef.current = "";
        dispatchConversation({ type: "submit-failed", message, runtime: "opencode" });
        setSubmitError(message);
      } finally {
        setSending(false);
      }
      return;
    }

    if (!connected || !gatewayConnected) return;

    setSending(true);
    setSubmitError(null);
    dispatchConversation({ type: "user-submitted", text: clean, runtime: "hermes" });

    try {
      let currentSessionId = await ensureSession();
      let promptResponse = await fetch("/api/hermes/prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: currentSessionId,
          prompt: clean,
        }),
      });
      let promptData = await readJson(promptResponse);

      if (!promptResponse.ok || !promptData?.ok) {
        if (
          promptResponse.status === 404 ||
          promptResponse.status === 410
        ) {
          setSessionId(null);
          currentSessionId = await ensureSession();
          promptResponse = await fetch("/api/hermes/prompt", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              session_id: currentSessionId,
              prompt: clean,
            }),
          });
          promptData = await readJson(promptResponse);

          if (!promptResponse.ok || !promptData?.ok) {
            throw new Error(
              promptData?.error ?? "Gagal mengirim prompt",
            );
          }
        } else {
          throw new Error(
            promptData?.error ?? "Gagal mengirim prompt",
          );
        }
      }

      setPrompt("");
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Gagal mengirim prompt";
      console.error("Failed to send prompt:", error);
      dispatchConversation({
        type: "submit-failed",
        message,
        runtime: "hermes",
      });
      setSubmitError(message);
    } finally {
      setSending(false);
    }
  }

  function runTest() {
    sendPrompt(
      "Gunakan terminal tool untuk menjalankan perintah berikut: printf 'HERMES OFFICE TEST\\n'. Setelah selesai, balas singkat bahwa berhasil.",
    );
  }

  const selectedWorker = selectedWorkerId
    ? officeWorkers.find((worker) => worker.id === selectedWorkerId) ?? null
    : null;

  /*
   * Unified cross-runtime interrupt (Phase M).
   * Dispatches via /api/runtimes/interrupt for both Hermes subagents
   * and OpenCode running sessions.
   */
  async function interruptWorker() {
    if (!selectedWorker || interrupting) {
      return;
    }

    setInterrupting(true);
    setInterruptMsg(null);

    try {
      const response = await fetch("/api/runtimes/interrupt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: selectedWorker.id,
          runtime: selectedWorker.runtime,
          sessionId:
            selectedWorker.sessionId ??
            (selectedWorker.runtime === "hermes" ? sessionId : selectedWorker.sourceId),
          workerId: selectedWorker.sourceId,
        }),
      });
      const data = await readJson(response);

      if (!response.ok || !data?.ok) {
        throw new Error(data?.error ?? "Failed to interrupt worker");
      }

      setInterruptMsg(
        describeInterruptResult({
          ok: true,
          runtime: selectedWorker.runtime,
          found: typeof data.found === "boolean" ? data.found : true,
          interrupted: typeof data.interrupted === "boolean" ? data.interrupted : true,
          sourceId: selectedWorker.sourceId,
        }),
      );
    } catch (error) {
      console.error("Failed to interrupt worker:", error);
      setInterruptMsg(describeInterruptError(error, selectedWorker.runtime));
    } finally {
      setInterrupting(false);
    }
  }

  /* =========================================================
     UI
  ========================================================= */

  const busy = sending;
  const composerState = getComposerState({
    connected,
    gatewayConnected,
    sending: busy,
    hasPrompt: prompt.trim().length > 0,
    runtime: targetRuntime,
    opencodeOnline: Boolean(runtimeLive.opencode),
  });
  const turnCount = conversation.messages.filter(
    (message) => message.role === "user",
  ).length;

  /* =========================================================
     SPEECH BUBBLE INPUT
     Derived from the live conversation only: a pending assistant
     message means a response is genuinely in flight, and the last
     finished reply is the only text Popi is allowed to say. The
     full text always stays in the Conversation panel.
     ========================================================= */
  const pendingMessage =
    conversation.messages.find((message) => message.status === "pending") ??
    null;

  const latestReply = useMemo(() => {
    for (let index = conversation.messages.length - 1; index >= 0; index -= 1) {
      const message = conversation.messages[index];

      if (message.role === "assistant" && message.status !== "pending") {
        return message;
      }
    }

    return null;
  }, [conversation.messages]);

  const bubbleInput = useMemo(() => {
    // `pending` is filtered out above, so this is null unless a real result
    // status exists for the last finished reply.
    const status = latestReply && latestReply.status !== "pending" ? latestReply.status : null;

    return {
      sessionId,
      pendingId: pendingMessage ? pendingMessage.id : null,
      turnSeq: celebrationKey,
      response: latestReply ? latestReply.text : null,
      responseStatus: status,
    };
  }, [sessionId, pendingMessage, celebrationKey, latestReply]);

  const bubbleMessage = useSpeechBubble(bubbleInput);

  const interruptAvailability = selectedWorker
    ? resolveUnifiedWorkerInterruptAvailability({
        worker: selectedWorker,
        runtimeOnline:
          selectedWorker.runtime === "hermes"
            ? gatewayConnected
            : Boolean(runtimeLive.opencode),
        interrupting,
        hasSession: sessionId !== null,
      })
    : { enabled: false, reason: null };

  return (
    <main className="flex min-h-dvh flex-col overflow-x-hidden bg-zinc-950 font-mono text-zinc-100 lg:h-dvh lg:overflow-hidden">
      {/* HEADER */}
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-zinc-800 bg-zinc-900/60 px-5 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <span aria-hidden className="text-xl leading-none">
            🤖
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-bold tracking-wide">
              LIVING AI OFFICE
            </h1>
            <p className="truncate text-[11px] text-zinc-500">
              MINPOP · multi-runtime observation &amp; control
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          <StatusBadge status={status} />
          <LinkBadge label="Gateway" online={gatewayConnected} />
          <LinkBadge label="SSE" online={connected} />
          <RuntimeControl />
        </div>
      </header>

      {/* WORKSPACE */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 p-4 lg:grid-cols-[minmax(0,7fr)_minmax(320px,5fr)] xl:grid-cols-[minmax(0,8fr)_minmax(360px,4fr)] lg:grid-rows-[minmax(0,1fr)] lg:overflow-hidden">
        {/* LEFT: AGENT + ACTIVITY + EVENTS */}
        <section className="flex min-h-0 flex-col gap-4">
          {/* 3D VIEWPORT */}
          <div
            ref={viewportRef}
            className="relative h-[380px] shrink-0 overflow-hidden rounded-xl border border-zinc-800 bg-gradient-to-b from-zinc-900/70 to-zinc-950 lg:h-auto lg:min-h-[340px] lg:flex-[62]"
          >
            <Canvas
              shadows
              dpr={[1, 2]}
              gl={{
                toneMapping: THREE.ACESFilmicToneMapping,
                toneMappingExposure: 1.2,
              }}
              camera={{ position: [5, 4, 6], fov: 50 }}
            >
              <OfficeScene
                status={status}
                workers={officeWorkers}
                tool={tool === "-" ? null : tool}
                command={command === "-" ? null : command}
                turnSeq={celebrationKey}
                visorMode={visorMode}
                probe={popiProbe}
                sseConnected={connected}
                gatewayConnected={gatewayConnected}
                connectionError={connectionError}
                selectedWorkerId={selectedWorkerId}
                onSelectWorker={setSelectedWorkerId}
                wheelZoomEnabled={wheelZoomEnabled}
                cameraControlsRef={cameraControlsRef}
              />
            </Canvas>

            <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-3">
              <StatusBadge status={status} />
              {BUSY_STATUSES.includes(status) ? (
                <span className="rounded-full border border-zinc-700 bg-zinc-950/70 px-2 py-1 text-[10px] uppercase tracking-widest text-zinc-300 backdrop-blur">
                  active
                </span>
              ) : null}
            </div>

            <PopiSpeechBubble
              message={bubbleMessage}
              probe={popiProbe}
              viewportRef={viewportRef}
              reducedMotion={reducedMotion}
            />

            {/* Phantom visor toggle: opt out of the terminal effect. */}
            <div className="absolute right-3 top-[52px] flex items-center gap-1.5">
              <span className="text-[9px] uppercase tracking-widest text-zinc-600">
                visor
              </span>
              {(["auto", "off"] as VisorMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setVisorMode(mode)}
                  aria-pressed={visorMode === mode}
                  data-visor-mode={mode}
                  className={`rounded-full border px-2 py-0.5 text-[9px] uppercase tracking-widest transition ${
                    visorMode === mode
                      ? "border-cyan-400/60 bg-cyan-400/15 text-cyan-200"
                      : "border-zinc-700 bg-zinc-950/60 text-zinc-500 hover:border-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  {mode}
                </button>
              ))}
            </div>

            <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-zinc-950 via-zinc-950/70 to-transparent px-3 pb-2 pt-8">
              <p className="max-w-[calc(100%-240px)] truncate text-[11px] text-zinc-500">
                {tool !== "-" ? (
                  <>
                    Tool{" "}
                    <span className="text-zinc-300">{tool}</span>
                    {command !== "-" ? (
                      <>
                        {" · "}
                        <span className="text-zinc-400">
                          {command}
                        </span>
                      </>
                    ) : null}
                  </>
                ) : (
                  "No active tool"
                )}
              </p>
            </div>

            {/* Camera Controls Floating Toolbar */}
            <div
              className="absolute bottom-2.5 right-2.5 z-10 flex items-center gap-1 rounded-lg border border-zinc-800/80 bg-zinc-950/85 p-1 backdrop-blur-md shadow-lg"
              role="toolbar"
              aria-label="3D Camera Controls"
            >
              <button
                type="button"
                onClick={() => cameraControlsRef.current?.zoomIn()}
                title="Zoom in (or Ctrl + Scroll)"
                className="flex h-6 w-6 items-center justify-center rounded border border-zinc-800 bg-zinc-900/90 text-xs font-bold text-zinc-300 transition hover:border-cyan-400/60 hover:bg-zinc-800 hover:text-cyan-200 active:scale-95"
                aria-label="Zoom in"
              >
                +
              </button>
              <button
                type="button"
                onClick={() => cameraControlsRef.current?.zoomOut()}
                title="Zoom out (or Ctrl + Scroll)"
                className="flex h-6 w-6 items-center justify-center rounded border border-zinc-800 bg-zinc-900/90 text-xs font-bold text-zinc-300 transition hover:border-cyan-400/60 hover:bg-zinc-800 hover:text-cyan-200 active:scale-95"
                aria-label="Zoom out"
              >
                −
              </button>
              <button
                type="button"
                onClick={() => {
                  setSelectedWorkerId(null);
                  cameraControlsRef.current?.resetView();
                }}
                title="Reset camera framing and clear worker focus"
                className="rounded border border-zinc-800 bg-zinc-900/90 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-400 transition hover:border-cyan-400/60 hover:bg-zinc-800 hover:text-cyan-200 active:scale-95"
              >
                Reset
              </button>
              <button
                type="button"
                onClick={() => setWheelZoomEnabled((prev) => !prev)}
                aria-pressed={wheelZoomEnabled}
                title={
                  wheelZoomEnabled
                    ? "Wheel Zoom Active: scrolling on canvas zooms camera. Click to restore page scrolling."
                    : "Page Scroll Active: mouse wheel scrolls the page normally. Hold Ctrl/Cmd or toggle to zoom."
                }
                className={`rounded border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider transition active:scale-95 ${
                  wheelZoomEnabled
                    ? "border-cyan-400/70 bg-cyan-400/20 text-cyan-200"
                    : "border-zinc-800 bg-zinc-900/90 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200"
                }`}
              >
                {wheelZoomEnabled ? "Wheel: Zoom" : "Wheel: Scroll"}
              </button>
            </div>
          </div>

          {/* TELEMETRY ROW: ACTIVITY + EVENT STREAM */}
          <div className="grid min-h-0 grid-cols-1 gap-4 lg:flex-[38] md:grid-cols-2">
            {/* ACTIVITY */}
            <div
              className={`${PANEL} h-[240px] shrink-0 md:h-auto md:min-h-0`}
            >
            <div className={PANEL_HEADER}>
              <span className="text-[11px] font-semibold uppercase tracking-widest text-zinc-400">
                Activity
              </span>
              {runError ? (
                <span className="text-[10px] uppercase tracking-widest text-red-400">
                  error
                </span>
              ) : connectionError === "auth" ? (
                <span className="text-[10px] uppercase tracking-widest text-red-400">
                  token rejected
                </span>
              ) : connected && !gatewayConnected ? (
                <span className="text-[10px] uppercase tracking-widest text-amber-400">
                  gateway offline
                </span>
              ) : (
                <span className="text-[10px] uppercase tracking-widest text-zinc-600">
                  live
                </span>
              )}
            </div>

            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
              {runError ? (
                <div className="whitespace-pre-wrap break-words rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs text-red-300">
                  {runError}
                </div>
              ) : null}

              {connectionError === "auth" ? (
                <div className="whitespace-pre-wrap break-words rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs text-red-300">
                  Gateway rejected the session token. Refresh
                  HERMES_SESSION_TOKEN in .env.local from the Gateway root
                  HTML, then restart the dev server.
                </div>
              ) : null}

              <dl className="grid grid-cols-[84px_minmax(0,1fr)] gap-x-3 gap-y-2 text-xs">
                <dt className="text-zinc-500">Gateway</dt>
                <dd
                  className={
                    gatewayConnected
                      ? "text-emerald-400"
                      : "text-red-400"
                  }
                >
                  {gatewayConnected
                    ? "connected"
                    : "offline"}
                </dd>

                <dt className="text-zinc-500">Tool</dt>
                <dd
                  className="truncate text-zinc-200"
                  title={tool}
                >
                  {tool}
                </dd>

                <dt className="text-zinc-500">Command</dt>
                <dd className="break-words text-zinc-200">
                  {command}
                </dd>
              </dl>

              <TextBlock
                label="Output"
                value={output}
                className="text-emerald-300"
              />
              <TextBlock
                label="Latest response"
                value={lastResponse}
                className="text-indigo-300"
              />

              {officeWorkers.length > 0 ? (
                <div>
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
                      Workers · {officeWorkers.length}
                    </span>
                    <span className="text-[10px] uppercase tracking-widest text-zinc-600">
                      hermes · opencode
                    </span>
                  </div>
                  <ul className="space-y-1.5">
                    {officeWorkers.map((worker) => {
                      const visual = getWorkerStatusVisual(worker.status);
                      const selected = worker.id === selectedWorkerId;
                      const stale = worker.stale === true;
                      const title = officeWorkerTitle(worker);
                      const accent = runtimeAccent(worker.runtime);
                      const kind = officeWorkerKindLabel(worker);

                      return (
                        <li
                          key={worker.id}
                          data-worker-id={worker.id}
                          data-runtime={worker.runtime}
                          data-stale={stale}
                        >
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedWorkerId(worker.id);
                              setInterruptMsg(null);
                            }}
                            aria-pressed={selected}
                            data-selected={selected}
                            className={`w-full rounded-lg border px-2 py-1.5 text-left transition ${
                              selected
                                ? "border-zinc-500 bg-zinc-800/70"
                                : "border-zinc-800 bg-zinc-950/50 hover:border-zinc-600"
                            }`}
                          >
                            <span className="flex items-center justify-between gap-2">
                              <span className="flex min-w-0 items-center gap-1.5">
                                <span
                                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                                  style={{
                                    backgroundColor: stale ? "#71717a" : visual.color,
                                  }}
                                />
                                <span
                                  className="truncate text-[11px] text-zinc-200"
                                  title={title}
                                >
                                  {title}
                                </span>
                              </span>
                              <span
                                className="shrink-0 text-[10px] uppercase tracking-wide"
                                style={{ color: stale ? "#71717a" : visual.color }}
                              >
                                {visual.label}
                                {stale ? " · stale" : ""}
                              </span>
                            </span>
                            <span className="mt-0.5 flex items-center gap-1.5 text-[10px]">
                              <span
                                className="rounded border px-1 uppercase tracking-wider"
                                style={{
                                  borderColor: `${accent}66`,
                                  color: accent,
                                }}
                              >
                                {runtimeLabel(worker.runtime)}
                              </span>
                              <span className="text-zinc-600">{kind}</span>
                              {worker.activity ? (
                                <span
                                  className="truncate text-zinc-500"
                                  title={worker.activity}
                                >
                                  · {worker.activity}
                                </span>
                              ) : null}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>

                  {selectedWorker
                    ? (() => {
                        const visual = getWorkerStatusVisual(
                          selectedWorker.status,
                        );

                        return (
                          <div
                            data-selected-worker-panel
                            className="mt-2 rounded-lg border border-zinc-700 bg-zinc-900/60 p-2.5"
                          >
                            <div className="mb-1 flex items-center justify-between gap-2">
                              <span className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400">
                                Selected worker
                              </span>
                              <span
                                className="shrink-0 text-[10px] uppercase tracking-wide"
                                style={{ color: visual.color }}
                              >
                                {visual.label}
                              </span>
                            </div>

                            <p
                              className="truncate text-[11px] text-zinc-200"
                              title={officeWorkerTitle(selectedWorker)}
                            >
                              {officeWorkerTitle(selectedWorker)}
                            </p>

                            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px]">
                              <span
                                className="rounded border px-1 uppercase tracking-wider"
                                style={{
                                  borderColor: `${runtimeAccent(selectedWorker.runtime)}66`,
                                  color: runtimeAccent(selectedWorker.runtime),
                                }}
                                title={`Runtime: ${runtimeLabel(selectedWorker.runtime)}`}
                              >
                                {runtimeLabel(selectedWorker.runtime)}
                              </span>
                              <span className="text-zinc-500">
                                {officeWorkerKindLabel(selectedWorker)}
                              </span>
                              {selectedWorker.stale ? (
                                <span className="rounded border border-amber-500/40 bg-amber-500/10 px-1 uppercase tracking-wider text-amber-300">
                                  stale
                                </span>
                              ) : null}
                              {selectedWorker.kind === "session" ? (
                                <span className="text-zinc-600">
                                  session-level · no subagent events
                                </span>
                              ) : null}
                            </div>

                            <dl className="mt-1.5 grid grid-cols-[58px_minmax(0,1fr)] gap-x-2 gap-y-1 text-[10px]">
                              <dt className="text-zinc-500">Session</dt>
                              <dd
                                className="truncate text-zinc-300"
                                title={selectedWorker.sessionId ?? selectedWorker.id}
                              >
                                {selectedWorker.sessionId ?? selectedWorker.id}
                              </dd>

                              <dt className="text-zinc-500">Task</dt>
                              <dd className="break-words text-zinc-300">
                                {selectedWorker.activity ??
                                  (selectedWorker.taskCount &&
                                  selectedWorker.taskCount > 1
                                    ? `step ${(selectedWorker.taskIndex ?? 0) + 1} of ${selectedWorker.taskCount}`
                                    : "—")}
                              </dd>

                              <dt className="text-zinc-500">Worker</dt>
                              <dd
                                className="truncate text-zinc-500"
                                title={selectedWorker.id}
                              >
                                {selectedWorker.id}
                              </dd>
                            </dl>

                            {selectedWorker.runtime === "opencode" ? (
                              <button
                                type="button"
                                onClick={() => {
                                  setTargetRuntime("opencode");
                                  setOpencodeSessionId(selectedWorker.sourceId);
                                }}
                                className="mt-2 w-full rounded-lg border border-purple-500/40 bg-purple-500/15 px-3 py-1 text-xs font-semibold text-purple-300 transition hover:bg-purple-500/25"
                              >
                                Target session in Composer
                              </button>
                            ) : null}

                            <button
                              type="button"
                              onClick={interruptWorker}
                              disabled={!interruptAvailability.enabled}
                              data-interrupt-button
                              className="mt-2 w-full rounded-lg border border-red-600/50 bg-red-600/20 px-3 py-1.5 text-xs font-semibold text-red-300 transition enabled:hover:bg-red-600/30 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              {interrupting
                                ? "Interrupting…"
                                : "Interrupt worker"}
                            </button>

                            {!interrupting &&
                            interruptAvailability.reason ? (
                              <p className="mt-1.5 text-[10px] leading-relaxed text-amber-400/90">
                                {interruptAvailability.reason}
                              </p>
                            ) : null}

                            {interruptMsg ? (
                              <p
                                data-interrupt-message
                                data-tone={interruptMsg.tone}
                                className={`mt-1.5 whitespace-pre-wrap break-words text-[10px] leading-relaxed ${
                                  interruptMsg.tone === "error"
                                    ? "text-red-300"
                                    : interruptMsg.tone === "stale"
                                      ? "text-amber-300"
                                      : "text-emerald-300"
                                }`}
                              >
                                {interruptMsg.text}
                              </p>
                            ) : null}
                          </div>
                        );
                      })()
                    : selectedWorkerId ? (
                      <div
                        data-stale-selected-worker
                        className="mt-2 flex items-center justify-between gap-2 rounded-lg border border-amber-900/60 bg-amber-950/30 px-2.5 py-2 text-[10px] text-amber-300"
                      >
                        <span className="truncate" title={selectedWorkerId}>
                          Selected worker {selectedWorkerId} left the roster.
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedWorkerId(null);
                            setInterruptMsg(null);
                          }}
                          className="shrink-0 rounded border border-amber-800/60 px-2 py-0.5 uppercase tracking-widest text-amber-200 transition hover:border-amber-600"
                        >
                          Clear
                        </button>
                      </div>
                    ) : null}
                </div>
              ) : null}
            </div>
          </div>

          {/* EVENT STREAM */}
          <div
            className={`${PANEL} h-[180px] shrink-0 md:h-auto md:min-h-0`}
          >
            <div className={PANEL_HEADER}>
              <span className="text-[11px] font-semibold uppercase tracking-widest text-zinc-400">
                Event stream
              </span>
              <button
                type="button"
                onClick={() => setEvents([])}
                className="rounded border border-zinc-700 px-2 py-1 text-[10px] uppercase tracking-widest text-zinc-400 transition hover:border-zinc-500 hover:text-zinc-100"
              >
                Clear log
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-2 text-xs">
              {events.length === 0 ? (
                <p className="text-zinc-600">
                  Waiting for runtime events…
                </p>
              ) : (
                events.map((event, index) => (
                  <div
                    key={`${event}-${index}`}
                    className={`flex items-baseline gap-2 py-0.5 ${
                      index === 0 ? "text-amber-300" : "text-zinc-500"
                    }`}
                  >
                    <span
                      aria-hidden
                      className={`shrink-0 ${
                        index === 0
                          ? "text-amber-400"
                          : "text-zinc-700"
                      }`}
                    >
                      ›
                    </span>
                    <span className="break-words">{event}</span>
                  </div>
                ))
              )}
            </div>
          </div>
          </div>
        </section>

        {/* RIGHT: CONVERSATION + COMPOSER */}
        <section
          className={`${PANEL} min-h-0`}
        >
          <div className={PANEL_HEADER}>
            <span className="text-[11px] font-semibold uppercase tracking-widest text-zinc-400">
              Conversation
            </span>
            <span className="text-[10px] uppercase tracking-widest text-zinc-600">
              {turnCount} {turnCount === 1 ? "turn" : "turns"}
            </span>
          </div>

          {/* CONVERSATION SCROLL AREA */}
          <div
            id="conversation-panel"
            className="h-[360px] min-h-0 overflow-y-auto p-4 lg:h-auto lg:flex-1"
          >
            {conversation.messages.length === 0 ? (
              <div className="flex h-full items-center justify-center text-center text-xs text-zinc-600">
                <p>
                  No conversation yet.
                  <br />
                  Send a prompt below to start.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {conversation.messages.map((message) =>
                  message.role === "user" ? (
                    <div
                      key={message.id}
                      data-role="user"
                      className="flex justify-end"
                    >
                      <div className="max-w-[85%] rounded-2xl rounded-br-sm border border-amber-500/30 bg-amber-500/10 px-3 py-2">
                        <div className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-amber-400/80">
                          You
                        </div>
                        <div className="whitespace-pre-wrap break-words text-sm leading-relaxed text-amber-100">
                          {message.text}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div
                      key={message.id}
                      data-role="assistant"
                      data-status={message.status}
                      className="flex justify-start"
                    >
                      <div
                        className={`max-w-[85%] rounded-2xl rounded-bl-sm border px-3 py-2 ${
                          message.status === "error"
                            ? "border-red-500/40 bg-red-500/10"
                            : message.runtime === "opencode"
                              ? "border-purple-500/40 bg-purple-500/10"
                              : "border-emerald-500/30 bg-emerald-500/10"
                        }`}
                      >
                        <div
                          className={`mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest ${
                            message.status === "error"
                              ? "text-red-400/80"
                              : message.runtime === "opencode"
                                ? "text-purple-400"
                                : "text-emerald-400/80"
                          }`}
                        >
                          <span>{message.runtime === "opencode" ? "OpenCode" : "Hermes"}</span>
                        </div>
                        {message.status === "pending" ? (
                          <div className="flex items-center gap-2 text-sm italic text-zinc-500">
                            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-zinc-500" />
                            Waiting for response…
                          </div>
                        ) : (
                          <div
                            className={`whitespace-pre-wrap break-words text-sm leading-relaxed ${
                              message.status === "error"
                                ? "text-red-200"
                                : message.runtime === "opencode"
                                  ? "text-purple-100"
                                  : "text-emerald-100"
                            }`}
                          >
                            {message.text}
                          </div>
                        )}
                      </div>
                    </div>
                  ),
                )}
              </div>
            )}
          </div>

          {/* COMPOSER */}
          <div className="shrink-0 space-y-3 border-t border-zinc-800 bg-zinc-950/60 p-4">
            {submitError ? (
              <div className="whitespace-pre-wrap break-words rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs text-red-300">
                {submitError}
              </div>
            ) : null}

            {/* RUNTIME TARGET SELECTOR (Phase M) */}
            <div className="flex items-center justify-between gap-2 text-[10px]">
              <div className="flex items-center gap-1.5">
                <span className="uppercase tracking-widest text-zinc-500">Target:</span>
                <button
                  type="button"
                  onClick={() => setTargetRuntime("hermes")}
                  data-runtime-target="hermes"
                  className={`rounded px-2 py-0.5 uppercase tracking-wider transition ${
                    targetRuntime === "hermes"
                      ? "border border-cyan-400/60 bg-cyan-400/15 text-cyan-200"
                      : "border border-zinc-800 bg-zinc-900 text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  Hermes
                </button>
                <button
                  type="button"
                  onClick={() => setTargetRuntime("opencode")}
                  data-runtime-target="opencode"
                  className={`rounded px-2 py-0.5 uppercase tracking-wider transition ${
                    targetRuntime === "opencode"
                      ? "border border-purple-400/60 bg-purple-400/15 text-purple-200"
                      : "border border-zinc-800 bg-zinc-900 text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  OpenCode
                </button>
              </div>
              {targetRuntime === "opencode" && opencodeSessionId ? (
                <span className="truncate text-zinc-400">
                  Session: {opencodeSessionId.slice(0, 8)}
                </span>
              ) : null}
            </div>

            <div className="flex items-end gap-2">
              <textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    sendPrompt(prompt);
                  }
                }}
                rows={2}
                placeholder={
                  targetRuntime === "opencode"
                    ? "Send a task to OpenCode…  (Enter to send, Shift+Enter for newline)"
                    : "Send a task to Hermes…  (Enter to send, Shift+Enter for newline)"
                }
                className="min-h-[52px] flex-1 resize-none rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-zinc-500"
              />
              <button
                type="button"
                onClick={() => sendPrompt(prompt)}
                disabled={!composerState.canSend}
                className={`h-[52px] shrink-0 rounded-lg border px-5 text-sm font-semibold transition enabled:hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 ${
                  targetRuntime === "opencode"
                    ? "border-purple-600/50 bg-purple-600/20 text-purple-300"
                    : "border-emerald-600/50 bg-emerald-600/20 text-emerald-300"
                }`}
              >
                {busy ? "Sending..." : "Send"}
              </button>
            </div>

            <div className="flex items-center justify-between gap-2">
              <span
                aria-live="polite"
                className={`truncate text-[10px] ${
                  composerState.canSend ? "text-zinc-600" : "text-amber-400/80"
                }`}
              >
                {composerState.hint}
              </span>
              <button
                type="button"
                onClick={runTest}
                disabled={!connected || busy}
                className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-300 transition enabled:hover:border-zinc-500 enabled:hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                Run test
              </button>
              <span className="truncate text-[10px] uppercase tracking-widest text-zinc-600">
                {sessionId ? `Session ${sessionId.slice(0, 8)}` : "No session"}
              </span>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
