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
 */

export type ChatRole = "user" | "assistant";

export type ChatStatus = "pending" | "complete" | "error";

export interface ChatMessage {
  id: number;
  role: ChatRole;
  text: string;
  status: ChatStatus;
}

export interface ConversationState {
  messages: ChatMessage[];
  nextId: number;
  /** FIFO of assistant message ids awaiting a completed turn. */
  pendingIds: number[];
  /** Highest `turnSeq` already applied; guards against replay duplicates. */
  lastTurnSeq: number;
  /** False until the first state frame fixes the baseline `turnSeq`. */
  synced: boolean;
}

export const initialConversationState: ConversationState = {
  messages: [],
  nextId: 1,
  pendingIds: [],
  lastTurnSeq: 0,
  synced: false,
};

export type ConversationAction =
  | { type: "sync-turn-seq"; turnSeq: number }
  | { type: "user-submitted"; text: string }
  | {
      type: "turn-completed";
      turnSeq: number;
      text: string | null;
      fallback: string | null;
      failed: boolean;
    }
  | { type: "submit-failed"; message: string }
  | { type: "gateway-lost" };

const FALLBACK_COMPLETE = "Completed without a text response.";
const FALLBACK_FAILED = "Turn failed without a message.";
const INTERRUPTED = "Interrupted — gateway disconnected.";

export function conversationReducer(
  state: ConversationState,
  action: ConversationAction,
): ConversationState {
  switch (action.type) {
    case "sync-turn-seq":
      return state.synced
        ? state
        : { ...state, synced: true, lastTurnSeq: action.turnSeq };

    case "user-submitted": {
      const userId = state.nextId;
      const assistantId = userId + 1;

      return {
        ...state,
        nextId: assistantId + 1,
        pendingIds: [...state.pendingIds, assistantId],
        messages: [
          ...state.messages,
          { id: userId, role: "user", text: action.text, status: "complete" },
          {
            id: assistantId,
            role: "assistant",
            text: "",
            status: "pending",
          },
        ],
      };
    }

    case "turn-completed": {
      if (action.turnSeq <= state.lastTurnSeq) {
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

      if (state.pendingIds.length === 0) {
        const id = state.nextId;

        return {
          ...state,
          nextId: id + 1,
          lastTurnSeq: action.turnSeq,
          messages: [
            ...state.messages,
            { id, role: "assistant", text, status },
          ],
        };
      }

      const [pendingId, ...remaining] = state.pendingIds;

      return {
        ...state,
        lastTurnSeq: action.turnSeq,
        pendingIds: remaining,
        messages: state.messages.map((message) =>
          message.id === pendingId
            ? { ...message, text, status }
            : message,
        ),
      };
    }

    case "submit-failed": {
      if (state.pendingIds.length === 0) {
        return state;
      }

      const pendingId = state.pendingIds[state.pendingIds.length - 1];

      return {
        ...state,
        pendingIds: state.pendingIds.slice(0, -1),
        messages: state.messages.map((message) =>
          message.id === pendingId
            ? { ...message, text: action.message, status: "error" }
            : message,
        ),
      };
    }

    case "gateway-lost": {
      if (state.pendingIds.length === 0) {
        return state;
      }

      const pending = new Set(state.pendingIds);

      return {
        ...state,
        pendingIds: [],
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
