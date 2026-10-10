/**
 * Pure presentation logic for the worker-interrupt control.
 *
 * Kept out of `page.tsx` so it is unit-testable without a DOM (this repo has no
 * jsdom / React Testing Library setup). The state model (`workers.ts`) and the
 * Gateway contract (`interruptSubagent` -> `subagent.interrupt`) stay untouched;
 * this module only decides whether the control is usable and how to phrase the
 * outcome.
 */

import type { GatewayErrorKind } from "./connection";
import {
  isTerminalWorkerStatus,
  type WorkerStatus,
} from "./workers";

export type InterruptTone = "success" | "error" | "stale";

export interface InterruptMessage {
  tone: InterruptTone;
  text: string;
}

export interface InterruptAvailabilityInput {
  /** True once a live Hermes session id is known. */
  hasSession: boolean;
  status: WorkerStatus;
  gatewayConnected: boolean;
  connectionError: GatewayErrorKind | null;
  interrupting: boolean;
}

export interface InterruptAvailability {
  enabled: boolean;
  /**
   * Why the control is disabled. `null` both when it is enabled and while an
   * interrupt is already in flight (the button renders its own loading label).
   */
  reason: string | null;
}

/**
 * Decide whether the selected worker can be interrupted right now. Every
 * disabled branch is intentional: the Gateway's `subagent.interrupt` only acts
 * on a live child owned by the *live* session/transport, so we refuse calls we
 * know cannot succeed and tell the user why instead of firing a doomed RPC.
 */
export function resolveInterruptAvailability(
  input: InterruptAvailabilityInput,
): InterruptAvailability {
  if (input.interrupting) {
    return { enabled: false, reason: null };
  }

  if (!input.hasSession) {
    return {
      enabled: false,
      reason:
        "No live session. Start a task before interrupting a worker.",
    };
  }

  if (isTerminalWorkerStatus(input.status)) {
    return {
      enabled: false,
      reason: "This worker already finished.",
    };
  }

  if (input.connectionError === "auth") {
    return {
      enabled: false,
      reason:
        "Gateway rejected the session token; reconnect the Gateway to interrupt.",
    };
  }

  if (!input.gatewayConnected) {
    return {
      enabled: false,
      reason: "Gateway offline; interrupt is unavailable.",
    };
  }

  return { enabled: true, reason: null };
}

/**
 * Official `subagent.interrupt` result shape:
 * `{ found: boolean, subagent_id: string }`. `found: false` is not an error —
 * the child simply finished first, so the message is informational and the real
 * status is reconciled from the `subagent.complete` SSE frame.
 */
export function describeInterruptResult(result: {
  found: boolean;
  subagent_id: string;
}): InterruptMessage {
  if (result.found) {
    return {
      tone: "success",
      text: `Interrupt sent to ${result.subagent_id}; waiting for Hermes to confirm.`,
    };
  }

  return {
    tone: "stale",
    text: `Worker ${result.subagent_id} is no longer running. Its status will refresh from Hermes.`,
  };
}

export function describeInterruptError(raw: unknown): InterruptMessage {
  const message =
    raw instanceof Error
      ? raw.message
      : typeof raw === "string" && raw.length > 0
        ? raw
        : "Unknown error";

  return {
    tone: "error",
    text: `Interrupt failed: ${message}`,
  };
}
