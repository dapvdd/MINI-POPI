import { describe, expect, it } from "vitest";
import {
  AUTH_RECOVERY_HINT,
  RECONNECT_BASE_DELAY_MS,
  RECONNECT_MAX_DELAY_MS,
  classifyGatewayError,
  decideReconnect,
  reconnectDelayForAttempt,
} from "./connection";

describe("classifyGatewayError", () => {
  it("treats a rejected ws upgrade (403) as auth", () => {
    const result = classifyGatewayError(
      "Unexpected server response: 403",
    );

    expect(result.kind).toBe("auth");
    expect(result.message).toBe(AUTH_RECOVERY_HINT);
  });

  it("treats a 401 gate response as auth", () => {
    expect(classifyGatewayError("Unexpected server response: 401").kind).toBe(
      "auth",
    );
    expect(classifyGatewayError("Unauthorized").kind).toBe("auth");
  });

  it("never leaks a token or URL in the sanitized auth message", () => {
    const secret = "top-secret-token-value";
    const result = classifyGatewayError(
      `WebSocket error: ${secret} Unexpected server response: 403`,
    );

    expect(result.message).not.toContain(secret);
    expect(result.message).not.toContain("ws://");
  });

  it("treats refused/reset/timeout as transient", () => {
    for (const message of [
      "connect ECONNREFUSED 127.0.0.1:9119",
      "read ECONNRESET",
      "connect ETIMEDOUT",
      "socket hang up",
      "WebSocket was closed before the connection was established",
    ]) {
      expect(classifyGatewayError(message).kind).toBe("transient");
    }
  });

  it("preserves an unrecognized message as unknown", () => {
    const result = classifyGatewayError("something unexpected");

    expect(result.kind).toBe("unknown");
    expect(result.message).toBe("something unexpected");
  });
});

describe("reconnectDelayForAttempt", () => {
  it("backs off exponentially from the base delay", () => {
    expect(reconnectDelayForAttempt(1)).toBe(RECONNECT_BASE_DELAY_MS);
    expect(reconnectDelayForAttempt(2)).toBe(RECONNECT_BASE_DELAY_MS * 2);
    expect(reconnectDelayForAttempt(3)).toBe(RECONNECT_BASE_DELAY_MS * 4);
  });

  it("caps at the max delay", () => {
    expect(reconnectDelayForAttempt(50)).toBe(RECONNECT_MAX_DELAY_MS);
  });
});

describe("decideReconnect", () => {
  it("does not retry an auth failure", () => {
    expect(decideReconnect("auth", 1)).toEqual({
      retry: false,
      delayMs: 0,
    });
  });

  it("retries transient and unknown failures with backoff", () => {
    expect(decideReconnect("transient", 1)).toEqual({
      retry: true,
      delayMs: RECONNECT_BASE_DELAY_MS,
    });
    expect(decideReconnect("unknown", 3)).toEqual({
      retry: true,
      delayMs: RECONNECT_BASE_DELAY_MS * 4,
    });
  });
});
