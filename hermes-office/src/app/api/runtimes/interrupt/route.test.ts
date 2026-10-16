import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";
import { getRuntimeRegistry } from "@/lib/runtime/registry";

describe("POST /api/runtimes/interrupt", () => {
  const LOCAL_HEADERS = {
    "host": "localhost:3000",
    "origin": "http://localhost:3000",
    "content-type": "application/json",
  };

  function createRequest(body: unknown, headers = LOCAL_HEADERS) {
    return new NextRequest("http://localhost:3000/api/runtimes/interrupt", {
      method: "POST",
      headers,
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  }

  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects non-loopback requests with 403", async () => {
    const req = createRequest({ id: "opencode:sess-1" }, {
      "host": "evil.com",
      "origin": "http://evil.com",
      "content-type": "application/json",
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.ok).toBe(false);
  });

  it("rejects invalid JSON body with 400", async () => {
    const req = new NextRequest("http://localhost:3000/api/runtimes/interrupt", {
      method: "POST",
      headers: LOCAL_HEADERS,
      body: "{ not valid json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("rejects unknown runtime with 400", async () => {
    const req = createRequest({ runtime: "unknown-runtime", sessionId: "123" });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("must be one of");
  });

  it("dispatches interrupt for OpenCode via composite ID", async () => {
    const registry = getRuntimeRegistry();
    const fakeAdapter = {
      id: "opencode" as const,
      getHealth: vi.fn(),
      getCapabilities: vi.fn(),
      listSessions: vi.fn(),
      interrupt: vi.fn().mockResolvedValue(true),
    };
    registry.register(fakeAdapter);

    const req = createRequest({ id: "opencode:test-sess" });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.runtime).toBe("opencode");
    expect(data.interrupted).toBe(true);
    expect(fakeAdapter.interrupt).toHaveBeenCalledWith("test-sess", undefined);
  });

  it("dispatches interrupt for Hermes subagent via explicit parameters", async () => {
    const registry = getRuntimeRegistry();
    const fakeAdapter = {
      id: "hermes" as const,
      getHealth: vi.fn(),
      getCapabilities: vi.fn(),
      listSessions: vi.fn(),
      interrupt: vi.fn().mockResolvedValue(true),
    };
    registry.register(fakeAdapter);

    const req = createRequest({
      runtime: "hermes",
      sessionId: "h-sess-1",
      workerId: "sub-9",
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.runtime).toBe("hermes");
    expect(data.interrupted).toBe(true);
    expect(fakeAdapter.interrupt).toHaveBeenCalledWith("h-sess-1", "sub-9");
  });

  it("requires sessionId when not discoverable", async () => {
    const registry = getRuntimeRegistry();
    const fakeAdapter = {
      id: "opencode" as const,
      getHealth: vi.fn(),
      getCapabilities: vi.fn(),
      listSessions: vi.fn(),
      interrupt: vi.fn().mockResolvedValue(true),
    };
    registry.register(fakeAdapter);

    const req = createRequest({ runtime: "opencode" });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/sessionId is required/i);
  });
});
