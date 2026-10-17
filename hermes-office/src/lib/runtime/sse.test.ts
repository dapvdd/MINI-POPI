import { describe, expect, it } from "vitest";
import { createEventIdTracker, nextRetryDelay, SSE_MAX_RETRY_MS } from "./sse";

describe("nextRetryDelay", () => {
  it("doubles the delay and clamps to the maximum", () => {
    expect(nextRetryDelay(1000)).toBe(2000);
    expect(nextRetryDelay(10000)).toBe(SSE_MAX_RETRY_MS);
    expect(nextRetryDelay(SSE_MAX_RETRY_MS)).toBe(SSE_MAX_RETRY_MS);
  });

  it("recovers from a non-positive delay", () => {
    expect(nextRetryDelay(0)).toBe(2);
    expect(nextRetryDelay(Number.NaN)).toBe(2);
  });
});

describe("createEventIdTracker", () => {
  it("accepts an id once and rejects replays", () => {
    const tracker = createEventIdTracker();
    expect(tracker.accept("evt-1")).toBe(true);
    expect(tracker.accept("evt-1")).toBe(false);
    expect(tracker.accept("evt-2")).toBe(true);
    expect(tracker.size()).toBe(2);
  });

  it("always accepts an empty id (heartbeats must not be swallowed)", () => {
    const tracker = createEventIdTracker();
    expect(tracker.accept("")).toBe(true);
    expect(tracker.accept("")).toBe(true);
  });

  it("evicts the oldest ids past the limit so memory stays bounded", () => {
    const tracker = createEventIdTracker(2);
    tracker.accept("a");
    tracker.accept("b");
    tracker.accept("c");

    expect(tracker.size()).toBe(2);
    expect(tracker.accept("a")).toBe(true); // evicted, so accepted again
    expect(tracker.accept("c")).toBe(false);
  });
});
