"use client";

import { Canvas } from "@react-three/fiber";
import { useEffect, useReducer, useRef, useState } from "react";
import type { AgentStatus } from "@/lib/hermes/types";
import {
  conversationReducer,
  initialConversationState,
} from "@/lib/conversation";
import {
  workersToArray,
  type WorkerState,
} from "@/lib/hermes/workers";
import { getWorkerStatusVisual } from "@/lib/worker-visuals";
import { getBodyColor } from "@/lib/popi";
import { OfficeScene } from "@/components/office/OfficeScene";


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
  const [workers, setWorkers] = useState<WorkerState[]>([]);

  const syncedRef = useRef(false);
  const turnSeqRef = useRef(0);
  const gatewayRef = useRef(false);
  const workersSigRef = useRef("");

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
        dispatchConversation({
          type: "turn-completed",
          turnSeq: nextTurnSeq,
          text: nextResponse,
          fallback: nextRunError,
          failed:
            nextResponseStatus === "error" || nextStatus === "ERROR",
        });
      }

      if (gatewayRef.current && !nextGateway) {
        dispatchConversation({ type: "gateway-lost" });
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

      const nextWorkers = workersToArray(state.workers ?? {});
      const workersSig = nextWorkers
        .map((worker) => `${worker.id}:${worker.updatedAt}:${worker.status}`)
        .join("|");

      if (workersSig !== workersSigRef.current) {
        workersSigRef.current = workersSig;
        setWorkers(nextWorkers);
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
        retryDelay = 1000;
        setConnected(true);
      };

      next.onmessage = (event) => {
        applyState(event.data);
      };

      next.onerror = () => {
        if (disposed) return;

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

        retryTimer = window.setTimeout(() => {
          retryTimer = null;
          open();
        }, retryDelay);

        retryDelay = Math.min(retryDelay * 2, 10000);
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

    setSending(true);
    setSubmitError(null);
    dispatchConversation({ type: "user-submitted", text: clean });

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

  /* =========================================================
     UI
  ========================================================= */

  const busy = sending;
  const canSend = connected && !busy && prompt.trim().length > 0;
  const turnCount = conversation.messages.filter(
    (message) => message.role === "user",
  ).length;

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
              HERMES VIRTUAL OFFICE
            </h1>
            <p className="truncate text-[11px] text-zinc-500">
              MINPOP · observation &amp; control for Hermes
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          <StatusBadge status={status} />
          <LinkBadge label="Gateway" online={gatewayConnected} />
          <LinkBadge label="SSE" online={connected} />
        </div>
      </header>

      {/* WORKSPACE */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 p-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:grid-rows-[minmax(0,1fr)] lg:overflow-hidden">
        {/* LEFT: AGENT + ACTIVITY + EVENTS */}
        <section className="flex min-h-0 flex-col gap-4">
          {/* 3D VIEWPORT */}
          <div className="relative h-[300px] shrink-0 overflow-hidden rounded-xl border border-zinc-800 bg-gradient-to-b from-zinc-900/70 to-zinc-950 lg:h-auto lg:min-h-[220px] lg:flex-[7]">
            <Canvas
              shadows
              dpr={[1, 2]}
              camera={{ position: [5, 4, 6], fov: 50 }}
            >
              <OfficeScene status={status} workers={workers} />
            </Canvas>

            <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-3">
              <StatusBadge status={status} />
              {BUSY_STATUSES.includes(status) ? (
                <span className="rounded-full border border-zinc-700 bg-zinc-950/70 px-2 py-1 text-[10px] uppercase tracking-widest text-zinc-300 backdrop-blur">
                  active
                </span>
              ) : null}
            </div>

            <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-zinc-950 via-zinc-950/70 to-transparent px-3 pb-2 pt-8">
              <p className="truncate text-[11px] text-zinc-500">
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
          </div>

          {/* ACTIVITY */}
          <div
            className={`${PANEL} h-[260px] shrink-0 lg:h-auto lg:min-h-0 lg:flex-[5]`}
          >
            <div className={PANEL_HEADER}>
              <span className="text-[11px] font-semibold uppercase tracking-widest text-zinc-400">
                Activity
              </span>
              {runError ? (
                <span className="text-[10px] uppercase tracking-widest text-red-400">
                  error
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

              {workers.length > 0 ? (
                <div>
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
                    Workers · {workers.length}
                  </div>
                  <ul className="space-y-1.5">
                    {workers.map((worker) => {
                      const visual = getWorkerStatusVisual(worker.status);

                      return (
                        <li
                          key={worker.id}
                          data-worker-id={worker.id}
                          className="rounded-lg border border-zinc-800 bg-zinc-950/50 px-2 py-1.5"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="flex min-w-0 items-center gap-1.5">
                              <span
                                className="h-1.5 w-1.5 shrink-0 rounded-full"
                                style={{
                                  backgroundColor: visual.color,
                                }}
                              />
                              <span
                                className="truncate text-[11px] text-zinc-200"
                                title={worker.goal}
                              >
                                {worker.goal || "untitled task"}
                              </span>
                            </span>
                            <span
                              className="shrink-0 text-[10px] uppercase tracking-wide"
                              style={{ color: visual.color }}
                            >
                              {visual.label}
                              {worker.taskCount > 1
                                ? ` · ${worker.taskIndex + 1}/${worker.taskCount}`
                                : ""}
                            </span>
                          </div>
                          {worker.activity ? (
                            <div
                              className="mt-0.5 truncate text-[10px] text-zinc-500"
                              title={worker.activity}
                            >
                              {worker.activity}
                            </div>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : null}
            </div>
          </div>

          {/* EVENT STREAM */}
          <div
            className={`${PANEL} h-[160px] shrink-0 lg:h-auto lg:min-h-0 lg:flex-[3]`}
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
                  Waiting for Hermes events…
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
                            : "border-emerald-500/30 bg-emerald-500/10"
                        }`}
                      >
                        <div
                          className={`mb-1 text-[10px] font-semibold uppercase tracking-widest ${
                            message.status === "error"
                              ? "text-red-400/80"
                              : "text-emerald-400/80"
                          }`}
                        >
                          Hermes
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
                placeholder="Send a task to Hermes…  (Enter to send, Shift+Enter for newline)"
                className="min-h-[52px] flex-1 resize-none rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-zinc-500"
              />
              <button
                type="button"
                onClick={() => sendPrompt(prompt)}
                disabled={!canSend}
                className="h-[52px] shrink-0 rounded-lg border border-emerald-600/50 bg-emerald-600/20 px-5 text-sm font-semibold text-emerald-300 transition enabled:hover:bg-emerald-600/30 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busy ? "Sending…" : "Send"}
              </button>
            </div>

            <div className="flex items-center justify-between gap-2">
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
