/**
 * Pure logic for cross-runtime worker & session interruption (Phase M).
 *
 * Supports both Hermes subagents (subagent.interrupt RPC) and OpenCode
 * running sessions (/api/session/:id/interrupt) through the common runtime contract.
 * Pure and unit-testable without a DOM or network dependencies.
 */

import { isTerminalRuntimeStatus } from "./workers";
import type { RuntimeId, RuntimeWorker } from "./types";
import { runtimeLabel } from "../office-workers";

export type InterruptTone = "success" | "error" | "stale";

export interface InterruptMessage {
  tone: InterruptTone;
  text: string;
}

export interface UnifiedInterruptAvailabilityInput {
  worker: RuntimeWorker | null;
  runtimeOnline: boolean;
  interrupting: boolean;
  hasSession?: boolean;
}

export interface UnifiedInterruptAvailability {
  enabled: boolean;
  reason: string | null;
}

/**
 * Determine if a runtime worker or session is interruptible right now.
 * Truthful: only enables interrupt if the runtime is online, the worker is
 * actively running, and the runtime supports interruption for this kind of entity.
 */
export function resolveUnifiedWorkerInterruptAvailability(
  input: UnifiedInterruptAvailabilityInput,
): UnifiedInterruptAvailability {
  const { worker, runtimeOnline, interrupting } = input;

  if (interrupting) {
    return { enabled: false, reason: null };
  }

  if (!worker) {
    return { enabled: false, reason: "No worker selected." };
  }

  if (isTerminalRuntimeStatus(worker.status)) {
    return {
      enabled: false,
      reason: `This ${officeWorkerKind(worker)} already finished.`,
    };
  }

  if (worker.stale) {
    return {
      enabled: false,
      reason: `This ${officeWorkerKind(worker)} is stale; cancellation is unavailable.`,
    };
  }

  if (!runtimeOnline) {
    return {
      enabled: false,
      reason: `${runtimeLabel(worker.runtime)} is offline; interrupt is unavailable.`,
    };
  }

  if (worker.runtime === "hermes") {
    if (worker.kind === "session") {
      return {
        enabled: false,
        reason: "Hermes session interrupt is not supported via subagent control.",
      };
    }
    if (input.hasSession === false) {
      return {
        enabled: false,
        reason: "No live Hermes session. Start a task before interrupting a worker.",
      };
    }
    return { enabled: true, reason: null };
  }

  if (worker.runtime === "opencode") {
    // OpenCode running session interrupt is supported via /api/session/:id/interrupt
    return { enabled: true, reason: null };
  }

  return {
    enabled: false,
    reason: `Interrupt is unavailable for runtime ${worker.runtime}.`,
  };
}

function officeWorkerKind(worker: RuntimeWorker): string {
  if (worker.kind === "session") return "session";
  if (worker.role === "subagent") return "subagent";
  return "worker";
}

export interface UnifiedInterruptResult {
  ok: boolean;
  runtime: RuntimeId;
  found?: boolean;
  interrupted?: boolean;
  sourceId?: string;
}

/**
 * Human-friendly presentation for unified interrupt results across runtimes.
 */
export function describeUnifiedInterruptResult(
  result: UnifiedInterruptResult,
): InterruptMessage {
  const label = runtimeLabel(result.runtime);
  const targetId = result.sourceId ? ` (${result.sourceId})` : "";

  if (result.ok && (result.interrupted || result.found)) {
    return {
      tone: "success",
      text: `Interrupt dispatched to ${label}${targetId}; awaiting runtime confirmation.`,
    };
  }

  if (result.ok && result.found === false) {
    return {
      tone: "stale",
      text: `${label} worker${targetId} is no longer running. Its status will refresh.`,
    };
  }

  return {
    tone: "stale",
    text: `Interrupt request acknowledged by ${label}${targetId}.`,
  };
}

export function describeUnifiedInterruptError(
  raw: unknown,
  runtime?: RuntimeId,
): InterruptMessage {
  const message =
    raw instanceof Error
      ? raw.message
      : typeof raw === "string" && raw.length > 0
        ? raw
        : "Unknown error";

  const prefix = runtime ? `${runtimeLabel(runtime)}: ` : "";

  return {
    tone: "error",
    text: `Interrupt failed: ${prefix}${message}`,
  };
}
