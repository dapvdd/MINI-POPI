import { describe, expect, it } from "vitest";
import {
  describeInterruptError,
  describeInterruptResult,
  resolveInterruptAvailability,
  type InterruptAvailabilityInput,
} from "./interrupt";

function availability(
  overrides: Partial<InterruptAvailabilityInput> = {},
) {
  return resolveInterruptAvailability({
    hasSession: true,
    status: "running",
    gatewayConnected: true,
    connectionError: null,
    interrupting: false,
    ...overrides,
  });
}

describe("resolveInterruptAvailability", () => {
  it("enables the control for a live worker on a healthy gateway", () => {
    expect(availability()).toEqual({ enabled: true, reason: null });
  });

  it("disables while an interrupt is already in flight (loading)", () => {
    expect(availability({ interrupting: true })).toEqual({
      enabled: false,
      reason: null,
    });
  });

  it("explains a missing live session", () => {
    const result = availability({ hasSession: false });

    expect(result.enabled).toBe(false);
    expect(result.reason).toMatch(/no live session/i);
  });

  it.each([
    "completed",
    "failed",
    "error",
    "timeout",
    "interrupted",
  ] as const)("disables for a terminal worker (%s)", (status) => {
    const result = availability({ status });

    expect(result.enabled).toBe(false);
    expect(result.reason).toMatch(/already finished/i);
  });

  it("surfaces a rejected session token as unavailable", () => {
    const result = availability({ connectionError: "auth" });

    expect(result.enabled).toBe(false);
    expect(result.reason).toMatch(/rejected the session token/i);
  });

  it("surfaces an offline gateway as unavailable", () => {
    const result = availability({ gatewayConnected: false });

    expect(result.enabled).toBe(false);
    expect(result.reason).toMatch(/offline/i);
  });

  it("treats a transient connection error as still interruptible", () => {
    const result = availability({ connectionError: "transient" });

    expect(result.enabled).toBe(true);
  });
});

describe("describeInterruptResult", () => {
  it("reports a found worker as a success", () => {
    const message = describeInterruptResult({
      found: true,
      subagent_id: "sa-0-abcd1234",
    });

    expect(message.tone).toBe("success");
    expect(message.text).toContain("sa-0-abcd1234");
  });

  it("reports a missing worker as stale, not an error", () => {
    const message = describeInterruptResult({
      found: false,
      subagent_id: "sa-1-deadbeef",
    });

    expect(message.tone).toBe("stale");
    expect(message.text).toMatch(/no longer running/i);
    expect(message.text).toContain("sa-1-deadbeef");
  });
});

describe("describeInterruptError", () => {
  it("wraps an Error message", () => {
    const message = describeInterruptError(new Error("session not found"));

    expect(message.tone).toBe("error");
    expect(message.text).toContain("session not found");
  });

  it("falls back for a non-Error rejection", () => {
    expect(describeInterruptError(undefined).text).toMatch(
      /unknown error/i,
    );
    expect(describeInterruptError("").text).toMatch(/unknown error/i);
  });
});
