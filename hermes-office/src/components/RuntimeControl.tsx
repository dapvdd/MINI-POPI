"use client";

/**
 * Compact local runtime control surface (Phase K.3).
 *
 * Shows independent Hermes / OpenCode lifecycle state, lets the operator
 * refresh diagnostics, and offers a start/retry action only where startup has
 * been verified and implemented. Never fabricates health: every value comes
 * from GET /api/runtimes/status, and start is confirmed by
 * POST /api/runtimes/lifecycle which only reports success after a real health
 * check.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { RuntimeDiagnostics, RuntimeLifecycleState } from "@/lib/runtime/lifecycle";

interface StatusResponse {
  runtimes: RuntimeDiagnostics[];
  timestamp: number;
}

const STATE_STYLE: Record<RuntimeLifecycleState, string> = {
  healthy: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
  starting: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  stopped: "border-zinc-600/50 bg-zinc-700/10 text-zinc-400",
  unreachable: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  failed: "border-red-500/40 bg-red-500/10 text-red-400",
  unconfigured: "border-zinc-600/50 bg-zinc-700/10 text-zinc-500",
  unsupported: "border-zinc-600/50 bg-zinc-700/10 text-zinc-500",
};

const DOT_STYLE: Record<RuntimeLifecycleState, string> = {
  healthy: "bg-emerald-400",
  starting: "bg-amber-300 animate-pulse",
  stopped: "bg-zinc-500",
  unreachable: "bg-amber-300",
  failed: "bg-red-400",
  unconfigured: "bg-zinc-600",
  unsupported: "bg-zinc-600",
};

const LABEL: Record<string, string> = { hermes: "Hermes", opencode: "OpenCode" };

function runtimeName(id: string): string {
  return LABEL[id] ?? id;
}

export function RuntimeControl() {
  const [data, setData] = useState<StatusResponse | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/runtimes/status", { cache: "no-store" });
      if (!res.ok) return;
      const json = (await res.json()) as StatusResponse;
      if (mounted.current) setData(json);
    } catch {
      // network hiccup — keep last known state
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    // Defer the initial fetch out of the effect body (avoids synchronous
    // cascading render warnings) and then poll on an interval.
    const initial = setTimeout(() => void refresh(), 0);
    const timer = setInterval(() => void refresh(), 15000);
    return () => {
      mounted.current = false;
      clearTimeout(initial);
      clearInterval(timer);
    };
  }, [refresh]);

  const start = useCallback(
    async (runtime: string) => {
      setBusy(runtime);
      setMessage(null);
      try {
        const res = await fetch("/api/runtimes/lifecycle", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ runtime }),
        });
        const json = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          outcome?: string;
          error?: string | null;
        };
        if (json.ok) {
          setMessage(
            json.outcome === "reused"
              ? `${runtimeName(runtime)} already running.`
              : `${runtimeName(runtime)} started.`,
          );
        } else {
          setMessage(json.error || `${runtimeName(runtime)} start failed.`);
        }
      } catch (e) {
        setMessage(e instanceof Error ? e.message : "Start request failed.");
      } finally {
        await refresh();
        if (mounted.current) setBusy(null);
      }
    },
    [refresh],
  );

  const runtimes = data?.runtimes ?? [];

  return (
    <div className="relative flex flex-wrap items-center justify-end gap-2">
      {runtimes.map((rt) => {
        const startAction = rt.actions.find((a) => a.id === "start");
        const isBusy = busy === rt.runtime || rt.state === "starting";
        return (
          <span key={rt.runtime} className="inline-flex items-center gap-1">
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              title={rt.remediation ?? rt.mechanism ?? undefined}
              className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-wider ${STATE_STYLE[rt.state]}`}
            >
              <span className={`h-2 w-2 rounded-full ${DOT_STYLE[rt.state]}`} />
              {runtimeName(rt.runtime)} {rt.state}
            </button>
            {startAction?.supported ? (
              <button
                type="button"
                disabled={isBusy}
                onClick={() => void start(rt.runtime)}
                className="rounded-full border border-zinc-700 bg-zinc-800/60 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-200 hover:bg-zinc-700/70 disabled:opacity-50"
              >
                {isBusy ? "…" : startAction.label}
              </button>
            ) : null}
          </span>
        );
      })}

      <button
        type="button"
        onClick={() => void refresh()}
        className="rounded-full border border-zinc-700 bg-zinc-800/60 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-300 hover:bg-zinc-700/70"
      >
        Refresh
      </button>

      {open && runtimes.length > 0 ? (
        <div className="pointer-events-auto absolute right-4 top-14 z-50 w-80 rounded-xl border border-zinc-800 bg-zinc-900/95 p-3 text-left text-[11px] shadow-xl backdrop-blur">
          {runtimes.map((rt) => (
            <div key={rt.runtime} className="mb-2 last:mb-0">
              <div className="font-semibold text-zinc-200">
                {runtimeName(rt.runtime)}{" "}
                <span className="font-normal text-zinc-500">— {rt.state}</span>
              </div>
              <div className="text-zinc-500">
                endpoint: {rt.endpoint ?? "unknown"}
              </div>
              <div className="text-zinc-500">
                process:{" "}
                {rt.process.listening === null
                  ? "unknown"
                  : rt.process.listening
                    ? "listening"
                    : "not listening"}
              </div>
              {rt.mechanism ? (
                <div className="text-zinc-500">startup: {rt.mechanism}</div>
              ) : null}
              {rt.error ? (
                <div className="mt-1 break-words text-red-400">{rt.error}</div>
              ) : null}
              {rt.remediation ? (
                <div className="mt-1 break-words text-amber-300/90">{rt.remediation}</div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {message ? (
        <span className="max-w-[16rem] truncate text-[10px] text-zinc-400" title={message}>
          {message}
        </span>
      ) : null}
    </div>
  );
}
