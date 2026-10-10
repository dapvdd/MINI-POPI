/**
 * Speech-bubble lifecycle.
 *
 * Pure, so the whole "what should Popi say and when" question is answerable
 * without a DOM. The component only decides *where* the bubble goes; this module
 * decides *what* it says.
 *
 * Hard rules encoded here:
 *  - Only real content is ever shown: a thinking indicator while an assistant
 *    response is genuinely pending, or text from a genuinely completed turn.
 *  - Nothing is fabricated. An empty or placeholder response yields no bubble.
 *  - One bubble at a time, one show per source, cooldown between bubbles, so
 *    the bubble cannot flicker or repeat itself.
 *  - A session change wipes the slate: a stale reply can never survive into a
 *    new session.
 */

export type BubbleKind = "thinking" | "response";

export type BubbleTone = "neutral" | "error";

export interface BubbleMessage {
  /** Stable identity of the thing being said. */
  id: string;
  kind: BubbleKind;
  tone: BubbleTone;
  /** Display-ready text, already truncated. */
  text: string;
}

export interface BubbleState {
  sessionId: string | null;
  message: BubbleMessage | null;
  shownAt: number;
  dismissedAt: number;
  lastShownId: string | null;
}

export interface BubbleInput {
  sessionId: string | null;
  /** Id of the pending assistant message, or null when nothing is pending. */
  pendingId: number | null;
  turnSeq: number;
  /** Real assistant text from a completed turn. */
  response: string | null;
  responseStatus: "complete" | "error" | "interrupted" | null;
  now: number;
}

/** Longest string the bubble shows; the full text stays in the transcript. */
export const BUBBLE_MAX_CHARS = 140;

/** How long a bubble stays up before it collapses on its own. */
export const BUBBLE_DWELL_MS = 9000;

/** Quiet period after a bubble closes, which is what stops flicker. */
export const BUBBLE_COOLDOWN_MS = 2500;

/** Minimum lifetime of a bubble before it may be replaced. */
export const BUBBLE_MIN_SWAP_MS = 700;

export const initialBubbleState = (
  sessionId: string | null = null,
): BubbleState => ({
  sessionId,
  message: null,
  shownAt: 0,
  dismissedAt: 0,
  lastShownId: null,
});

/** Placeholders the app uses for "no value yet" must never reach the bubble. */
function clean(text: string | null | undefined): string {
  if (typeof text !== "string") {
    return "";
  }

  const trimmed = text.trim();

  return trimmed === "-" ? "" : trimmed.replace(/\s+/g, " ");
}

export function truncateForBubble(
  text: string | null | undefined,
  max: number = BUBBLE_MAX_CHARS,
): string {
  const flat = clean(text);

  if (flat.length <= max) {
    return flat;
  }

  return `${flat.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}

function candidateFor(input: BubbleInput): BubbleMessage | null {
  if (input.pendingId !== null && input.pendingId > 0) {
    return {
      id: `pending-${input.pendingId}`,
      kind: "thinking",
      tone: "neutral",
      text: "",
    };
  }

  if (input.turnSeq > 0 && input.responseStatus !== null) {
    const text = truncateForBubble(input.response);

    if (!text) {
      return null;
    }

    return {
      id: `turn-${input.turnSeq}`,
      kind: "response",
      tone: input.responseStatus === "error" ? "error" : "neutral",
      text,
    };
  }

  return null;
}

/**
 * Resolve the bubble for the current input. Returns the same state object when
 * nothing should change, so the component never re-renders for nothing.
 */
export function selectBubble(
  state: BubbleState,
  input: BubbleInput,
): BubbleState {
  if (input.sessionId !== state.sessionId) {
    return {
      sessionId: input.sessionId,
      message: null,
      shownAt: 0,
      dismissedAt: input.now,
      lastShownId: null,
    };
  }

  let next = state;

  if (next.message && input.now - next.shownAt >= BUBBLE_DWELL_MS) {
    next = {
      ...next,
      message: null,
      dismissedAt: input.now,
    };
  }

  const candidate = candidateFor(input);

  if (!candidate) {
    return next;
  }

  if (candidate.id === next.lastShownId) {
    return next;
  }

  if (next.message) {
    if (next.message.id === candidate.id) {
      return next;
    }

    if (input.now - next.shownAt < BUBBLE_MIN_SWAP_MS) {
      return next;
    }
  } else if (candidate.kind === "response" && input.now - next.dismissedAt < BUBBLE_COOLDOWN_MS) {
    return next;
  }

  return {
    ...next,
    message: candidate,
    shownAt: input.now,
    lastShownId: candidate.id,
  };
}
