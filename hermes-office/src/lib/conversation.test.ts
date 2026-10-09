import { describe, expect, it } from "vitest";
import {
  conversationReducer as reduce,
  initialConversationState,
  type ConversationState,
} from "./conversation";

function sync(state: ConversationState, turnSeq: number) {
  return reduce(state, { type: "sync-turn-seq", turnSeq });
}

function submit(state: ConversationState, text: string) {
  return reduce(state, { type: "user-submitted", text });
}

function complete(
  state: ConversationState,
  turnSeq: number,
  text: string | null,
  failed = false,
) {
  return reduce(state, {
    type: "turn-completed",
    turnSeq,
    text,
    fallback: null,
    failed,
  });
}

function visible(state: ConversationState) {
  return state.messages.map((m) => `${m.role}:${m.status}:${m.text}`);
}

describe("conversationReducer", () => {
  it("attaches a response to the turn that produced it", () => {
    let state = sync(initialConversationState, 0);
    state = submit(state, "prompt A");
    state = complete(state, 1, "answer A");

    expect(visible(state)).toEqual([
      "user:complete:prompt A",
      "assistant:complete:answer A",
    ]);
    expect(state.pendingIds).toEqual([]);
  });

  it("keeps two consecutive prompts in order without duplicates", () => {
    let state = sync(initialConversationState, 0);
    state = submit(state, "A");
    state = complete(state, 1, "answer A");
    state = submit(state, "B");
    state = complete(state, 2, "answer B");

    expect(visible(state)).toEqual([
      "user:complete:A",
      "assistant:complete:answer A",
      "user:complete:B",
      "assistant:complete:answer B",
    ]);
  });

  it("does not require an extra prompt for a response to appear", () => {
    let state = sync(initialConversationState, 0);
    state = submit(state, "A");
    state = complete(state, 1, "answer A");

    const messages = state.messages;
    expect(messages[1]).toMatchObject({
      role: "assistant",
      text: "answer A",
      status: "complete",
    });
  });

  it("ignores replayed or out-of-order completed turns", () => {
    let state = sync(initialConversationState, 0);
    state = submit(state, "A");
    state = complete(state, 1, "answer A");

    const afterFirst = state;
    const replay = complete(state, 1, "answer A");

    expect(replay).toBe(afterFirst);
    expect(visible(replay)).toHaveLength(2);
  });

  it("drops the pending marker when submission fails", () => {
    let state = sync(initialConversationState, 0);
    state = submit(state, "A");
    state = reduce(state, { type: "submit-failed", message: "boom" });

    expect(state.pendingIds).toEqual([]);
    expect(visible(state)).toEqual([
      "user:complete:A",
      "assistant:error:boom",
    ]);
  });

  it("interrupts pending responses when the gateway drops", () => {
    let state = sync(initialConversationState, 0);
    state = submit(state, "A");
    state = reduce(state, { type: "gateway-lost" });

    expect(state.pendingIds).toEqual([]);
    expect(state.messages[1]).toMatchObject({
      role: "assistant",
      status: "error",
    });
  });

  it("baselines on the first sync so replay history is not re-added", () => {
    let state = sync(initialConversationState, 7);
    state = complete(state, 7, "historical");

    expect(state.messages).toHaveLength(0);

    state = submit(state, "new");
    state = complete(state, 8, "fresh");

    expect(visible(state)).toEqual([
      "user:complete:new",
      "assistant:complete:fresh",
    ]);
  });

  it("queues multiple submitted prompts and completes them FIFO", () => {
    let state = sync(initialConversationState, 0);
    state = submit(state, "A");
    state = submit(state, "B");

    state = complete(state, 1, "answer A");

    // The oldest pending race is filled first; B stays pending.
    expect(visible(state)).toEqual([
      "user:complete:A",
      "assistant:complete:answer A",
      "user:complete:B",
      "assistant:pending:",
    ]);

    state = complete(state, 2, "answer B");

    expect(visible(state)).toEqual([
      "user:complete:A",
      "assistant:complete:answer A",
      "user:complete:B",
      "assistant:complete:answer B",
    ]);
  });

  it("uses the failure fallback text when the turn failed with no message", () => {
    let state = sync(initialConversationState, 0);
    state = submit(state, "A");
    state = complete(state, 1, null, true);

    expect(state.messages[1].status).toBe("error");
    expect(state.messages[1].text).toBe("Turn failed without a message.");
  });
});
