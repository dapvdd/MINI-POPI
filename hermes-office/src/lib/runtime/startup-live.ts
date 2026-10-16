/**
 * Server-only bindings for runtime lifecycle orchestration.
 *
 * This module owns the *real* side effects (process spawn, TCP listener probe,
 * adapter health) while the decision logic lives in the pure `startup.ts`.
 * Import it only from Node-runtime route handlers.
 */
import net from "net";
import { spawn } from "child_process";
import { HermesRuntimeAdapter } from "@/lib/hermes/adapter";
import { OpenCodeRuntimeAdapter } from "@/lib/opencode/adapter";
import { discoverOpenCodeService } from "@/lib/opencode/discovery";
import { parseEndpointHostPort } from "./lifecycle";
import {
  RUNTIME_STARTUP_PLANS,
  runStartup,
  isStarting,
  type RuntimeHealthProbe,
  type StartupResult,
} from "./startup";
import type { RuntimeId } from "./types";

/** Hermes dashboard serves the MINPOP ws RPC here (verified default). */
export const HERMES_ENDPOINT = "ws://127.0.0.1:9119/api/ws";

/** The configured, sanitized endpoint for a runtime (never contains secrets). */
export function getRuntimeEndpoint(runtime: RuntimeId): string | null {
  if (runtime === "hermes") return HERMES_ENDPOINT;
  const svc = discoverOpenCodeService();
  return svc?.url ?? null;
}

/** Whether the runtime has the configuration needed to be reachable at all. */
export function isRuntimeConfigured(runtime: RuntimeId): boolean {
  if (runtime === "hermes") return Boolean(process.env.HERMES_SESSION_TOKEN);
  return Boolean(discoverOpenCodeService());
}

/** Health via the existing adapters (the same contract the rest of MINPOP uses). */
export async function probeRuntimeHealth(runtime: RuntimeId): Promise<RuntimeHealthProbe> {
  const adapter =
    runtime === "hermes" ? new HermesRuntimeAdapter() : new OpenCodeRuntimeAdapter();
  const h = await adapter.getHealth();
  return {
    healthy: Boolean(h.connected && h.reachable),
    reachable: Boolean(h.reachable),
    error: h.error ?? null,
  };
}

/**
 * Bounded TCP listener probe.
 * - `true`  : connection accepted
 * - `false` : connection refused (nothing listening)
 * - `null`  : inconclusive (timeout / unexpected error)
 */
export function probeListener(
  host: string,
  port: number,
  timeoutMs = 600,
): Promise<boolean | null> {
  return new Promise((resolve) => {
    let settled = false;
    const socket = new net.Socket();

    const finish = (value: boolean | null) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(null));
    socket.once("error", (err: NodeJS.ErrnoException) => {
      finish(err.code === "ECONNREFUSED" ? false : null);
    });

    try {
      socket.connect(port, host);
    } catch {
      finish(null);
    }
  });
}

/** Listener evidence for a runtime's configured endpoint. */
export async function probeRuntimeListener(runtime: RuntimeId): Promise<boolean | null> {
  const endpoint = getRuntimeEndpoint(runtime);
  if (!endpoint) return null;
  const hp = parseEndpointHostPort(endpoint);
  if (!hp) return null;
  return probeListener(hp.host, hp.port);
}

/**
 * Spawn a detached, loopback-only service process. stdio is ignored and the
 * child is unref'd so it outlives the request that started it. Only the
 * hard-coded commands from `RUNTIME_STARTUP_PLANS` ever reach here — no user
 * input is ever interpolated into a command.
 */
export function spawnDetached(command: string, args: string[]): void {
  // On Windows, npm-installed shims (opencode.cmd) need shell resolution.
  // We invoke cmd.exe explicitly instead of `shell: true` so no `args` array is
  // concatenated by Node (avoids DEP0190 and any escaping ambiguity). The
  // command/args always come from the fixed RUNTIME_STARTUP_PLANS allow-list,
  // never from user input.
  const isWindows = process.platform === "win32";
  const child = isWindows
    ? spawn(
        /* turbopackIgnore: true */ process.env.ComSpec || "cmd.exe",
        ["/d", "/s", "/c", [command, ...args].join(" ")],
        { detached: true, stdio: "ignore", windowsHide: true },
      )
    : spawn(/* turbopackIgnore: true */ command, args, { detached: true, stdio: "ignore" });
  child.unref();
}

export async function startRuntimeLive(runtime: RuntimeId): Promise<StartupResult> {
  return runStartup(runtime, {
    probeHealth: probeRuntimeHealth,
    spawnProcess: spawnDetached,
  });
}

export { isStarting, RUNTIME_STARTUP_PLANS };
export type { StartupResult };
