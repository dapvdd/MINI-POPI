import { describe, expect, it } from "vitest";
import {
  buildDiagnostics,
  describeActions,
  parseEndpointHostPort,
  remediationFor,
  resolveLifecycleState,
  sanitizeError,
} from "./lifecycle";
import type { RuntimeHealth } from "./types";

function health(partial: Partial<RuntimeHealth>): RuntimeHealth {
  return {
    runtime: "opencode",
    connected: false,
    reachable: false,
    error: null,
    lastCheck: 1000,
    ...partial,
  };
}

describe("resolveLifecycleState", () => {
  it("reports unconfigured when the runtime is not configured", () => {
    expect(
      resolveLifecycleState({ configured: false, healthy: false, listening: false }),
    ).toBe("unconfigured");
  });

  it("reports healthy when the health probe succeeds", () => {
    expect(
      resolveLifecycleState({ configured: true, healthy: true, listening: true }),
    ).toBe("healthy");
  });

  it("reports starting while a start is in progress", () => {
    expect(
      resolveLifecycleState({ configured: true, healthy: false, starting: true, listening: null }),
    ).toBe("starting");
  });

  it("only reports stopped with explicit 'not listening' evidence", () => {
    expect(
      resolveLifecycleState({ configured: true, healthy: false, listening: false }),
    ).toBe("stopped");
  });

  it("reports failed when listening but health fails", () => {
    expect(
      resolveLifecycleState({ configured: true, healthy: false, listening: true }),
    ).toBe("failed");
  });

  it("reports unreachable (not stopped) when process state is unknown", () => {
    expect(
      resolveLifecycleState({ configured: true, healthy: false, listening: null }),
    ).toBe("unreachable");
  });
});

describe("sanitizeError", () => {
  it("returns null for empty input", () => {
    expect(sanitizeError(null)).toBeNull();
    expect(sanitizeError(undefined)).toBeNull();
    expect(sanitizeError("   ")).toBeNull();
  });

  it("leaves ordinary errors readable", () => {
    expect(sanitizeError("HTTP 500")).toBe("HTTP 500");
    expect(sanitizeError("connection refused")).toBe("connection refused");
  });

  it("redacts key=value secrets", () => {
    const out = sanitizeError("failed token=abc123SECRET value");
    expect(out).not.toContain("abc123SECRET");
    expect(out).toContain("[redacted]");
  });

  it("redacts authorization headers and basic blobs", () => {
    const out = sanitizeError("Authorization: Basic b3BlbmNvZGU6c3VwZXJzZWNyZXQ=");
    expect(out).not.toContain("b3BlbmNvZGU6c3VwZXJzZWNyZXQ=");
    expect(out).toContain("[redacted]");
  });

  it("redacts token query parameters", () => {
    const out = sanitizeError(
      "ws://127.0.0.1:9119/api/ws?token=abcdefghijklmnopqrstuvwxyz0123 failed",
    );
    expect(out).not.toContain("abcdefghijklmnopqrstuvwxyz0123");
  });

  it("redacts long random secrets", () => {
    const out = sanitizeError("service password AAABBBCCCDDDEEEFFFGGGHHHIIIJJJ");
    expect(out).not.toContain("AAABBBCCCDDDEEEFFFGGGHHHIIIJJJ");
  });

  it("bounds the length of the returned message", () => {
    const out = sanitizeError("x".repeat(1000));
    expect((out ?? "").length).toBeLessThanOrEqual(301);
  });
});

describe("describeActions", () => {
  it("offers Start when stopped and startup is supported", () => {
    const actions = describeActions({
      runtime: "opencode",
      state: "stopped",
      startupSupported: true,
    });
    const start = actions.find((a) => a.id === "start");
    expect(start?.supported).toBe(true);
    expect(start?.label).toBe("Start");
    expect(actions.find((a) => a.id === "refresh")?.supported).toBe(true);
  });

  it("offers Retry when unhealthy-but-unknown", () => {
    const start = describeActions({
      runtime: "hermes",
      state: "unreachable",
      startupSupported: true,
    }).find((a) => a.id === "start");
    expect(start?.supported).toBe(true);
    expect(start?.label).toBe("Retry");
  });

  it("disables Start when already healthy", () => {
    const start = describeActions({
      runtime: "hermes",
      state: "healthy",
      startupSupported: true,
    }).find((a) => a.id === "start");
    expect(start?.supported).toBe(false);
    expect(start?.reason).toMatch(/healthy/i);
  });

  it("disables Start when another start is in progress", () => {
    const start = describeActions({
      runtime: "hermes",
      state: "starting",
      startupSupported: true,
    }).find((a) => a.id === "start");
    expect(start?.supported).toBe(false);
  });

  it("disables Start when startup is unsupported", () => {
    const start = describeActions({
      runtime: "opencode",
      state: "stopped",
      startupSupported: false,
      startupReason: "nope",
    }).find((a) => a.id === "start");
    expect(start?.supported).toBe(false);
    expect(start?.reason).toBe("nope");
  });
});

describe("remediationFor", () => {
  it("cites the verified startup commands", () => {
    expect(remediationFor("opencode", "stopped")).toContain("opencode service start");
    expect(remediationFor("hermes", "stopped")).toContain("hermes dashboard");
  });

  it("has a hint for every non-healthy state", () => {
    for (const state of ["unconfigured", "stopped", "failed", "unreachable", "starting"] as const) {
      expect(remediationFor("hermes", state)).toBeTruthy();
      expect(remediationFor("opencode", state)).toBeTruthy();
    }
  });

  it("has no hint when healthy", () => {
    expect(remediationFor("hermes", "healthy")).toBeNull();
  });
});

describe("parseEndpointHostPort", () => {
  it("parses http endpoints", () => {
    expect(parseEndpointHostPort("http://127.0.0.1:49374")).toEqual({
      host: "127.0.0.1",
      port: 49374,
    });
  });

  it("parses ws endpoints", () => {
    expect(parseEndpointHostPort("ws://127.0.0.1:9119/api/ws")).toEqual({
      host: "127.0.0.1",
      port: 9119,
    });
  });

  it("parses bare host:port", () => {
    expect(parseEndpointHostPort("127.0.0.1:9119")).toEqual({ host: "127.0.0.1", port: 9119 });
  });

  it("returns null when a port cannot be determined", () => {
    expect(parseEndpointHostPort("")).toBeNull();
    expect(parseEndpointHostPort("not-a-host")).toBeNull();
  });
});

describe("buildDiagnostics", () => {
  it("marks a healthy runtime and carries no remediation", () => {
    const d = buildDiagnostics({
      runtime: "opencode",
      health: health({ connected: true, reachable: true, version: "1.2.3" }),
      configured: true,
      endpoint: "http://127.0.0.1:49374",
      listening: true,
      startupSupported: true,
      mechanism: "opencode service start",
    });
    expect(d.state).toBe("healthy");
    expect(d.reachable).toBe(true);
    expect(d.remediation).toBeNull();
    expect(d.version).toBe("1.2.3");
  });

  it("sanitizes the health error before exposing it", () => {
    const d = buildDiagnostics({
      runtime: "opencode",
      health: health({ error: "auth failed token=SUPERSECRETVALUE" }),
      configured: true,
      endpoint: "http://127.0.0.1:49374",
      listening: null,
      startupSupported: true,
    });
    expect(d.error).not.toContain("SUPERSECRETVALUE");
    expect(d.state).toBe("unreachable");
  });

  it("keeps last-known healthy timestamp while currently offline", () => {
    const d = buildDiagnostics({
      runtime: "hermes",
      health: health({ runtime: "hermes", lastCheck: 5000 }),
      configured: true,
      endpoint: "ws://127.0.0.1:9119/api/ws",
      listening: false,
      startupSupported: true,
      lastHealthyAt: 4000,
    });
    expect(d.state).toBe("stopped");
    expect(d.lastHealthyAt).toBe(4000);
    expect(d.lastCheck).toBe(5000);
  });

  it("refuses to claim health from configuration alone", () => {
    const d = buildDiagnostics({
      runtime: "opencode",
      health: health({ error: "HTTP 401" }),
      configured: true,
      endpoint: "http://127.0.0.1:49374",
      listening: true,
      startupSupported: true,
    });
    expect(d.healthy).toBe(false);
    expect(d.state).toBe("failed");
  });
});
