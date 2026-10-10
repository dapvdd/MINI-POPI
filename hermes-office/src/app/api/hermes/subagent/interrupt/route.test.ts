import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AUTH_RECOVERY_HINT } from "@/lib/hermes/connection";

vi.mock("@/lib/hermes/server", () => ({
  interruptSubagent: vi.fn(),
}));

import { interruptSubagent } from "@/lib/hermes/server";
import { POST } from "./route";

const mockedInterrupt = vi.mocked(interruptSubagent);

const URL = "http://localhost/api/hermes/subagent/interrupt";

function post(body: unknown) {
  return new Request(URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockedInterrupt.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/hermes/subagent/interrupt", () => {
  it("rejects a request without both ids", async () => {
    const response = await POST(post({ session_id: "s-1" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: "session_id dan subagent_id wajib diisi",
    });
    expect(mockedInterrupt).not.toHaveBeenCalled();
  });

  it("rejects blank and non-string ids", async () => {
    const cases = [
      { session_id: "   ", subagent_id: "sa-1" },
      { session_id: "s-1", subagent_id: "" },
      { session_id: 42, subagent_id: "sa-1" },
      { session_id: "s-1", subagent_id: null },
    ];

    for (const body of cases) {
      const response = await POST(post(body));

      expect(response.status).toBe(400);
      expect(mockedInterrupt).not.toHaveBeenCalled();
    }
  });

  it("rejects a malformed JSON body with 400", async () => {
    const response = await POST(
      new Request(URL, { method: "POST", body: "{ not json" }),
    );

    expect(response.status).toBe(400);
    expect(mockedInterrupt).not.toHaveBeenCalled();
  });

  it("returns the official result on success", async () => {
    mockedInterrupt.mockResolvedValue({
      found: true,
      subagent_id: "sa-1",
    });

    const response = await POST(
      post({ session_id: "s-1", subagent_id: "sa-1" }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      result: { found: true, subagent_id: "sa-1" },
    });
    expect(mockedInterrupt).toHaveBeenCalledWith("s-1", "sa-1");
  });

  it("passes through a found:false (stale worker) result", async () => {
    mockedInterrupt.mockResolvedValue({
      found: false,
      subagent_id: "sa-1",
    });

    const response = await POST(
      post({ session_id: "s-1", subagent_id: "sa-1" }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      result: { found: false, subagent_id: "sa-1" },
    });
  });

  it("trims surrounding whitespace before calling the gateway", async () => {
    mockedInterrupt.mockResolvedValue({
      found: true,
      subagent_id: "sa-1",
    });

    await POST(
      post({ session_id: "  s-1  ", subagent_id: " sa-1 " }),
    );

    expect(mockedInterrupt).toHaveBeenCalledWith("s-1", "sa-1");
  });

  it("fails closed when the session token was rejected", async () => {
    mockedInterrupt.mockRejectedValue(new Error(AUTH_RECOVERY_HINT));

    const response = await POST(
      post({ session_id: "s-1", subagent_id: "sa-1" }),
    );

    expect(response.status).toBe(500);

    const json = await response.json();

    expect(json).toMatchObject({ ok: false, error: AUTH_RECOVERY_HINT });
    expect(JSON.stringify(json)).not.toMatch(/token=/);
  });

  it("fails closed when no session token is configured", async () => {
    mockedInterrupt.mockRejectedValue(
      new Error("HERMES_SESSION_TOKEN belum diset"),
    );

    const response = await POST(
      post({ session_id: "s-1", subagent_id: "sa-1" }),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: "HERMES_SESSION_TOKEN belum diset",
    });
  });

  it("returns 500 for an unexpected gateway error", async () => {
    mockedInterrupt.mockRejectedValue(new Error("session not found"));

    const response = await POST(
      post({ session_id: "s-1", subagent_id: "sa-1" }),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "session not found",
    });
  });
});
