import { describe, expect, it } from "vitest";
import {
  hostnameFromHostHeader,
  isLoopbackHostname,
  isTrustedOperatorRequest,
} from "./trust";

function headers(init: Record<string, string>): Headers {
  return new Headers(init);
}

describe("hostnameFromHostHeader", () => {
  it("strips an IPv4 port", () => {
    expect(hostnameFromHostHeader("127.0.0.1:3000")).toBe("127.0.0.1");
  });

  it("keeps IPv6 literals intact", () => {
    expect(hostnameFromHostHeader("[::1]:3000")).toBe("[::1]");
  });

  it("handles a bare hostname", () => {
    expect(hostnameFromHostHeader("localhost")).toBe("localhost");
  });

  it("returns null for missing/empty values", () => {
    expect(hostnameFromHostHeader(null)).toBeNull();
    expect(hostnameFromHostHeader("  ")).toBeNull();
  });
});

describe("isLoopbackHostname", () => {
  it("accepts loopback names", () => {
    for (const h of ["localhost", "127.0.0.1", "::1", "[::1]"]) {
      expect(isLoopbackHostname(h)).toBe(true);
    }
  });

  it("rejects public names", () => {
    for (const h of ["example.com", "192.168.1.10", "10.0.0.1", null]) {
      expect(isLoopbackHostname(h)).toBe(false);
    }
  });
});

describe("isTrustedOperatorRequest", () => {
  it("accepts a loopback Host", () => {
    expect(isTrustedOperatorRequest(headers({ host: "127.0.0.1:3000" })).ok).toBe(true);
    expect(isTrustedOperatorRequest(headers({ host: "localhost:3000" })).ok).toBe(true);
  });

  it("rejects a non-loopback Host", () => {
    const decision = isTrustedOperatorRequest(headers({ host: "minpop.example.com" }));
    expect(decision.ok).toBe(false);
    expect(decision.reason).toBeTruthy();
  });

  it("rejects a missing Host", () => {
    expect(isTrustedOperatorRequest(headers({})).ok).toBe(false);
  });

  it("accepts a loopback Origin", () => {
    expect(
      isTrustedOperatorRequest(headers({ host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000" }))
        .ok,
    ).toBe(true);
  });

  it("rejects a cross-origin request", () => {
    const decision = isTrustedOperatorRequest(
      headers({ host: "127.0.0.1:3000", origin: "http://evil.example.com" }),
    );
    expect(decision.ok).toBe(false);
  });

  it("rejects a malformed Origin", () => {
    const decision = isTrustedOperatorRequest(
      headers({ host: "127.0.0.1:3000", origin: "not a url" }),
    );
    expect(decision.ok).toBe(false);
  });
});
