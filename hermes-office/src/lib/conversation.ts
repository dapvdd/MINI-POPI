/**
 * Canonical conversation history for the workspace.
 *
 * The reducer is intentionally pure: the streaming bridge (SSE) and the
 * prompt submission flow both feed it discrete actions, so message order,
 * pending responses and de-duplication are all verifiable without a browser.
 *
 * Root cause this fixes: the previous implementation captured the *previous*
 * `lastResponse` at submit time and paired it with the new user turn, so every
 * assistant reply rendered one turn late. Here a user turn appends a pending
 * assistant bubble immediately, and the reply is attached when a turn actually
 * completes (`turnSeq`), independent of how many prompts are queued.
 *
 * Phase M follow-up: Hermes and OpenCode can complete turns concurrently, so a
 * single global `turnSeq` is not safe. Turn identity is now scoped per runtime:
 * Hermes carries a server-issued monotonic `turnSeq`, OpenCode carries an
 * explicit `turnId` (its short-lived server seq never collides with Hermes).
 * Pending responses are matched to the completion of their *own* runtime, so a
 * late/replayed Hermes frame can never consume an OpenCode pending reply or
 * vice versa.
 */

import type { RuntimeId } from "./runtime/types";

export type ChatRole = "user" | "assistant";

export type ChatStatus = "pending" | "complete" | "error";

export interface ChatMessage {
  id: number;
  role: ChatRole;
  text: string;
  status: ChatStatus;
  runtime?: RuntimeId;
}

export interface ConversationState {
  messages: ChatMessage[];
  nextId: number;
  /** FIFO of assistant message ids awaiting a completed turn. */
  pendingIds: number[];
  /** Highest `turnSeq` already applied, scoped per runtime. */
  lastTurnSeq: Record<RuntimeId, number>;
  /** Ids of runtime turns already applied (OpenCode has no server seq). */
  appliedTurnIds: string[];
  /** False until the first state frame fixes the baseline `turnSeq`. */
  synced: boolean;
}

export const initialConversationState: ConversationState = {
  messages: [],
  nextId: 1,
  pendingIds: [],
  lastTurnSeq: { hermes: 0, opencode: 0 },
  appliedTurnIds: [],
  synced: false,
};

/** Cap on remembered turn ids so dedup state cannot grow without bound. */
export const MAX_APPLIED_TURN_IDS = 64;

export type ConversationAction =
  | { type: "sync-turn-seq"; turnSeq: number }
  | { type: "user-submitted"; text: string; runtime?: RuntimeId }
  | {
      type: "turn-completed";
      /**
       * Runtime that produced the completed turn. Defaults to `hermes` so the
       * original single-runtime call sites keep working.
       */
      runtime?: RuntimeId;
      /**
       * Server-issued monotonic sequence (Hermes). When omitted the reducer
       * relies on `turnId` for de-duplication instead of an ordering guard.
       */
      turnSeq?: number;
      /** Stable identity for a runtime turn that has no server sequence. */
      turnId?: string;
      text: string | null;
      fallback: string | null;
      failed: boolean;
    }
  | {
      type: "direct-response";
      runtime: RuntimeId;
      userText: string;
      assistantText: string;
      failed?: boolean;
    }
  | { type: "submit-failed"; message: string; runtime?: RuntimeId }
  | { type: "gateway-lost"; runtime?: RuntimeId };

const FALLBACK_COMPLETE = "Completed without a text response.";
const FALLBACK_FAILED = "Turn failed without a message.";
const INTERRUPTED = "Interrupted — gateway disconnected.";

function runtimeOf(
  state: ConversationState,
  messageId: number,
): RuntimeId | undefined {
  return state.messages.find((message) => message.id === messageId)?.runtime;
}

export function conversationReducer(
  state: ConversationState,
  action: ConversationAction,
): ConversationState {
  switch (action.type) {
    case "sync-turn-seq":
      return state.synced
        ? state
        : {
            ...state,
            synced: true,
            lastTurnSeq: { ...state.lastTurnSeq, hermes: action.turnSeq },
          };

    case "user-submitted": {
      const userId = state.nextId;
      const assistantId = userId + 1;
      const runtime = action.runtime ?? "hermes";

      return {
        ...state,
        nextId: assistantId + 1,
        pendingIds: [...state.pendingIds, assistantId],
        messages: [
          ...state.messages,
          { id: userId, role: "user", text: action.text, status: "complete", runtime },
          {
            id: assistantId,
            role: "assistant",
            text: "",
            status: "pending",
            runtime,
          },
        ],
      };
    }

    case "direct-response": {
      const userId = state.nextId;
      const assistantId = userId + 1;

      return {
        ...state,
        nextId: assistantId + 1,
        messages: [
          ...state.messages,
          { id: userId, role: "user", text: action.userText, status: "complete", runtime: action.runtime },
          {
            id: assistantId,
            role: "assistant",
            text: action.assistantText,
            status: action.failed ? "error" : "complete",
            runtime: action.runtime,
          },
        ],
      };
    }

    case "turn-completed": {
      const runtime = action.runtime ?? "hermes";

      // Replay / out-of-order guard: scoped to this runtime only, so a late
      // Hermes frame cannot suppress or consume an OpenCode completion.
      if (
        action.turnSeq != null &&
        action.turnSeq <= (state.lastTurnSeq[runtime] ?? 0)
      ) {
        return state;
      }

      // Idempotency for turns without a server sequence (OpenCode).
      if (action.turnId != null && state.appliedTurnIds.includes(action.turnId)) {
        return state;
      }

      const raw =
        action.text && action.text !== "-"
          ? action.text
          : action.fallback ?? "";
      const text =
        raw ||
        (action.failed ? FALLBACK_FAILED : FALLBACK_COMPLETE);
      const status: ChatStatus = action.failed ? "error" : "complete";

      const lastTurnSeq =
        action.turnSeq != null
          ? { ...state.lastTurnSeq, [runtime]: action.turnSeq }
          : state.lastTurnSeq;
      const appliedTurnIds =
        action.turnId != null
          ? [...state.appliedTurnIds, action.turnId].slice(-MAX_APPLIED_TURN_IDS)
          : state.appliedTurnIds;

      // Attach to the oldest pending reply *of the same runtime*.
      const pendingIndex = state.pendingIds.findIndex(
        (id) => runtimeOf(state, id) === runtime,
      );

      if (pendingIndex === -1) {
        const id = state.nextId;

        return {
          ...state,
          nextId: id + 1,
          lastTurnSeq,
          appliedTurnIds,
          messages: [
            ...state.messages,
            { id, role: "assistant", text, status, runtime },
          ],
        };
      }

      const pendingId = state.pendingIds[pendingIndex];
      const remaining = state.pendingIds.filter(
        (_, index) => index !== pendingIndex,
      );

      return {
        ...state,
        lastTurnSeq,
        appliedTurnIds,
        pendingIds: remaining,
        messages: state.messages.map((message) =>
          message.id === pendingId
            ? { ...message, text, status }
            : message,
        ),
      };
    }

    case "submit-failed": {
      const runtime = action.runtime ?? "hermes";

      // Fail the most recently submitted pending reply of the same runtime.
      let targetIndex = -1;
      for (let index = state.pendingIds.length - 1; index >= 0; index -= 1) {
        if (runtimeOf(state, state.pendingIds[index]) === runtime) {
          targetIndex = index;
          break;
        }
      }

      if (targetIndex === -1) {
        return state;
      }

      const pendingId = state.pendingIds[targetIndex];
      const remaining = state.pendingIds.filter(
        (_, index) => index !== targetIndex,
      );

      return {
        ...state,
        pendingIds: remaining,
        messages: state.messages.map((message) =>
          message.id === pendingId
            ? { ...message, text: action.message, status: "error" }
            : message,
        ),
      };
    }

    case "gateway-lost": {
      const runtime = action.runtime ?? "hermes";
      const pending = new Set(
        state.pendingIds.filter((id) => runtimeOf(state, id) === runtime),
      );

      if (pending.size === 0) {
        return state;
      }

      return {
        ...state,
        pendingIds: state.pendingIds.filter((id) => !pending.has(id)),
        messages: state.messages.map((message) =>
          pending.has(message.id)
            ? {
                ...message,
                text: message.text || INTERRUPTED,
                status: "error",
              }
            : message,
        ),
      };
    }

    default:
      return state;
  }
}
