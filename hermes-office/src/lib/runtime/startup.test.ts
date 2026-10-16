import { describe, expect, it, beforeEach } from "vitest";
import {
  RUNTIME_STARTUP_PLANS,
  isStarting,
  resetStartupLocks,
  runStartup,
  type StartupDeps,
} from "./startup";
import type { RuntimeId } from "./types";

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

beforeEach(() => {
  resetStartupLocks();
});

describe("RUNTIME_STARTUP_PLANS", () => {
  it("declares the verified mechanisms", () => {
    expect(RUNTIME_STARTUP_PLANS.opencode.command).toBe("opencode");
    expect(RUNTIME_STARTUP_PLANS.opencode.args).toEqual(["service", "start"]);
    expect(RUNTIME_STARTUP_PLANS.hermes.command).toBe("hermes");
    expect(RUNTIME_STARTUP_PLANS.hermes.args).toContain("dashboard");
    expect(RUNTIME_STARTUP_PLANS.hermes.args).toContain("--no-open");
    expect(RUNTIME_STARTUP_PLANS.hermes.args).toContain("--skip-build");
  });
});

describe("runStartup", () => {
  it("reuses a healthy instance without spawning a duplicate", async () => {
    let spawns = 0;
    const result = await runStartup("opencode", {
      probeHealth: async () => ({ healthy: true, reachable: true }),
      spawnProcess: () => {
        spawns += 1;
      },
    });
    expect(result.ok).toBe(true);
    expect(result.outcome).toBe("reused");
    expect(result.alreadyRunning).toBe(true);
    expect(result.started).toBe(false);
    expect(spawns).toBe(0);
  });

  it("starts and confirms health within the bound", async () => {
    let spawns = 0;
    let calls = 0;
    const result = await runStartup("hermes", {
      probeHealth: async () => {
        calls += 1;
        return { healthy: calls > 1, reachable: calls > 1 };
      },
      spawnProcess: () => {
        spawns += 1;
      },
      sleep: async () => {},
      timeoutMs: 1000,
      pollIntervalMs: 1,
    });
    expect(result.ok).toBe(true);
    expect(result.outcome).toBe("healthy");
    expect(result.started).toBe(true);
    expect(spawns).toBe(1);
  });

  it("reports a truthful timeout failure and sanitizes the error", async () => {
    const result = await runStartup("opencode", {
      probeHealth: async () => ({
        healthy: false,
        reachable: false,
        error: "auth failed token=SUPERSECRETVALUE1234567890",
      }),
      spawnProcess: () => {},
      timeoutMs: 25,
      pollIntervalMs: 5,
    });
    expect(result.ok).toBe(false);
    expect(result.outcome).toBe("failed");
    expect(result.started).toBe(true);
    expect(result.error).toMatch(/did not become healthy/);
    expect(result.error).not.toContain("SUPERSECRETVALUE1234567890");
  });

  it("reports unsupported for a runtime without a plan", async () => {
    const result = await runStartup("bogus" as RuntimeId, {
      probeHealth: async () => ({ healthy: false, reachable: false }),
      spawnProcess: () => {},
    });
    expect(result.ok).toBe(false);
    expect(result.outcome).toBe("unsupported");
    expect(result.started).toBe(false);
  });

  it("prevents concurrent duplicate starts for the same runtime", async () => {
    let healthy = false;
    const gate: { release: (() => void) | null } = { release: null };
    const deps: StartupDeps = {
      probeHealth: async () => ({ healthy, reachable: healthy }),
      spawnProcess: () => {},
      sleep: () =>
        new Promise<void>((r) => {
          gate.release = r;
        }),
      timeoutMs: 100000,
    };

    const first = runStartup("hermes", deps);
    await tick();
    await tick();
    expect(isStarting("hermes")).toBe(true);

    const second = await runStartup("hermes", deps);
    expect(second.outcome).toBe("starting");
    expect(second.ok).toBe(false);

    healthy = true;
    gate.release?.();
    const firstResult = await first;
    expect(firstResult.outcome).toBe("healthy");
    expect(isStarting("hermes")).toBe(false);
  });

  it("keeps start locks independent per runtime", async () => {
    let healthy = false;
    const gate: { release: (() => void) | null } = { release: null };
    const deps: StartupDeps = {
      probeHealth: async () => ({ healthy, reachable: healthy }),
      spawnProcess: () => {},
      sleep: () =>
        new Promise<void>((r) => {
          gate.release = r;
        }),
      timeoutMs: 100000,
    };

    const hermes = runStartup("hermes", deps);
    await tick();
    await tick();
    expect(isStarting("hermes")).toBe(true);
    expect(isStarting("opencode")).toBe(false);

    healthy = true;
    gate.release?.();
    await hermes;
    expect(isStarting("hermes")).toBe(false);
  });
});
