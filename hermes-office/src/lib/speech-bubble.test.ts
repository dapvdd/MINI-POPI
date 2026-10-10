import { describe, expect, it } from "vitest";
import {
  BUBBLE_COOLDOWN_MS,
  BUBBLE_DWELL_MS,
  BUBBLE_MAX_CHARS,
  BUBBLE_MIN_SWAP_MS,
  initialBubbleState,
  selectBubble,
  truncateForBubble,
  type BubbleInput,
} from "./speech-bubble";

const T0 = 1_000_000;

function input(overrides: Partial<BubbleInput> = {}): BubbleInput {
  return {
    sessionId: "session-a",
    pendingId: null,
    turnSeq: 0,
    response: null,
    responseStatus: null,
    now: T0,
    ...overrides,
  };
}

function next(
  state: ReturnType<typeof initialBubbleState>,
  overrides: Partial<BubbleInput> = {},
) {
  return selectBubble(state, input(overrides));
}

describe("truncateForBubble", () => {
  it("flattens whitespace and keeps short text intact", () => {
    expect(truncateForBubble("  hello   world  ")).toBe("hello world");
    expect(truncateForBubble("short")).toBe("short");
  });

  it("truncates long text with an ellipsis and a hard bound", () => {
    const long = "x".repeat(400);
    const text = truncateForBubble(long);

    expect(text.length).toBeLessThanOrEqual(BUBBLE_MAX_CHARS);
    expect(text.endsWith("…")).toBe(true);
    expect(text.startsWith("x".repeat(BUBBLE_MAX_CHARS - 1))).toBe(true);
  });

  it("treats the app's placeholder as no text at all", () => {
    expect(truncateForBubble("-")).toBe("");
    expect(truncateForBubble(" - ")).toBe("");
    expect(truncateForBubble(null)).toBe("");
    expect(truncateForBubble(undefined)).toBe("");
  });
});

describe("selectBubble", () => {
  it("stays silent with nothing to say", () => {
    const state = initialBubbleState("session-a");

    expect(next(state).message).toBeNull();
    expect(next(state, { turnSeq: 2 }).message).toBeNull();
    expect(
      next(state, { turnSeq: 2, responseStatus: "complete", response: "-" })
        .message,
    ).toBeNull();
  });

  it("shows a thinking indicator while a response is pending", () => {
    const state = next(initialBubbleState("session-a"), { pendingId: 3 });

    expect(state.message).not.toBeNull();
    expect(state.message?.kind).toBe("thinking");
    expect(state.message?.id).toBe("pending-3");
  });

  it("shows real completed text instead of the thinking indicator", () => {
    const thinking = next(initialBubbleState("session-a"), { pendingId: 3 });

    const answered = selectBubble(thinking, {
      ...input({ pendingId: null, turnSeq: 1, responseStatus: "complete", response: "All done." }),
      now: T0 + BUBBLE_MIN_SWAP_MS,
    });

    expect(answered.message?.kind).toBe("response");
    expect(answered.message?.text).toBe("All done.");
    expect(answered.message?.tone).toBe("neutral");
  });

  it("flags a failed turn from its real result status", () => {
    const state = next(initialBubbleState("session-a"), {
      turnSeq: 5,
      responseStatus: "error",
      response: "Gateway rejected the token.",
    });

    expect(state.message?.tone).toBe("error");
  });

  it("collapses a bubble on its own after the dwell time", () => {
    let state = next(initialBubbleState("session-a"), { pendingId: 3 });

    state = selectBubble(state, { ...input({ pendingId: 3 }) , now: T0 + BUBBLE_DWELL_MS - 10 });
    expect(state.message).not.toBeNull();

    state = selectBubble(state, { ...input({ pendingId: 3 }), now: T0 + BUBBLE_DWELL_MS + 10 });
    expect(state.message).toBeNull();
  });

  it("never shows the same source twice in a row", () => {
    let state = next(initialBubbleState("session-a"), { pendingId: 3 });

    // Visible, then dismissed by the dwell timer.
    state = selectBubble(state, { ...input({ pendingId: 3 }), now: T0 + BUBBLE_DWELL_MS + 1 });
    expect(state.message).toBeNull();

    // The same pending turn cannot re-open a bubble.
    state = selectBubble(state, { ...input({ pendingId: 3 }), now: T0 + BUBBLE_DWELL_MS + 2 });
    expect(state.message).toBeNull();

    // A genuinely new turn may.
    state = selectBubble(state, { ...input({ pendingId: 9 }), now: T0 + BUBBLE_DWELL_MS + 3 });
    expect(state.message?.id).toBe("pending-9");
  });

  it("respects the cooldown between two different responses", () => {
    let state = next(initialBubbleState("session-a"), {
      turnSeq: 1,
      responseStatus: "complete",
      response: "first",
    });

    // The response bubble expires on its own...
    state = selectBubble(state, {
      ...input({ turnSeq: 1, responseStatus: "complete", response: "first" }),
      now: T0 + BUBBLE_DWELL_MS + 1,
    });
    expect(state.message).toBeNull();

    // ...and a second completion inside the cooldown is suppressed.
    state = selectBubble(state, {
      ...input({ turnSeq: 2, responseStatus: "complete", response: "second" }),
      now: T0 + BUBBLE_DWELL_MS + 100,
    });
    expect(state.message).toBeNull();

    // Once the cooldown has lapsed it comes through.
    state = selectBubble(state, {
      ...input({ turnSeq: 2, responseStatus: "complete", response: "second" }),
      now: T0 + BUBBLE_DWELL_MS + BUBBLE_COOLDOWN_MS + 10,
    });
    expect(state.message?.text).toBe("second");
  });

  it("does not replace a bubble that was just shown", () => {
    let state = next(initialBubbleState("session-a"), { pendingId: 3 });

    state = selectBubble(state, {
      ...input({ pendingId: null, turnSeq: 1, responseStatus: "complete", response: "done" }),
      now: T0 + 100,
    });

    // Still thinking: swapping too fast is what reads as flicker.
    expect(state.message?.kind).toBe("thinking");

    state = selectBubble(state, {
      ...input({ pendingId: null, turnSeq: 1, responseStatus: "complete", response: "done" }),
      now: T0 + BUBBLE_MIN_SWAP_MS + 10,
    });
    expect(state.message?.kind).toBe("response");
  });

  it("wipes the bubble when the session changes", () => {
    let state = next(initialBubbleState("session-a"), { pendingId: 3 });
    expect(state.message).not.toBeNull();

    const sameSession = selectBubble(
      state,
      input({ sessionId: "session-a", pendingId: 3 }),
    );
    expect(sameSession.message).not.toBeNull();

    // Switching sessions drops whatever was on screen: no stale text survives.
    state = selectBubble(state, input({ sessionId: "session-b" }));
    expect(state.message).toBeNull();

    // A reply in the new session comes through once its cooldown lapses, and
    // the old session's pending indicator cannot resurrect it.
    const later = T0 + BUBBLE_COOLDOWN_MS + 50;
    state = selectBubble(state, {
      ...input({
        sessionId: "session-b",
        turnSeq: 1,
        responseStatus: "complete",
        response: "from the new session",
      }),
      now: later,
    });
    expect(state.message?.text).toBe("from the new session");
  });

  it("returns the same state object when nothing changes", () => {
    const state = next(initialBubbleState("session-a"), { pendingId: 3 });

    expect(selectBubble(state, input({ pendingId: 3 }))).toBe(state);
    expect(selectBubble(state, input({ pendingId: 3, now: T0 - 5000 }))).toBe(
      state,
    );
  });

  it("truncates the bubble copy without losing the original text", () => {
    const long = "line ".repeat(80);
    const state = next(initialBubbleState("session-a"), {
      turnSeq: 1,
      responseStatus: "complete",
      response: long,
    });

    expect(state.message?.text.length).toBeLessThanOrEqual(BUBBLE_MAX_CHARS);
    expect(long.length).toBeGreaterThan(BUBBLE_MAX_CHARS);
    expect(long.startsWith(state.message?.text.replace("…", "") as string)).toBe(
      true,
    );
  });
});
