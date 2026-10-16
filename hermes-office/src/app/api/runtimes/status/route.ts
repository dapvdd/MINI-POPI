import { NextResponse } from "next/server";
import { HermesRuntimeAdapter } from "@/lib/hermes/adapter";
import { OpenCodeRuntimeAdapter } from "@/lib/opencode/adapter";
import { discoverOpenCodeService } from "@/lib/opencode/discovery";
import { getRuntimeRegistry } from "@/lib/runtime/registry";
import { buildDiagnostics, type RuntimeDiagnostics } from "@/lib/runtime/lifecycle";
import type { RuntimeHealth, RuntimeId } from "@/lib/runtime/types";
import {
  RUNTIME_STARTUP_PLANS,
  getRuntimeEndpoint,
  isRuntimeConfigured,
  isStarting,
  probeRuntimeListener,
} from "@/lib/runtime/startup-live";
import {
  getLastHealthyAt,
  recordHealthy,
} from "@/lib/runtime/health-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function ensureRegistry() {
  const registry = getRuntimeRegistry();
  if (!registry.get("hermes")) registry.register(new HermesRuntimeAdapter());
  if (!registry.get("opencode")) registry.register(new OpenCodeRuntimeAdapter());
  return registry;
}

export async function GET() {
  const registry = ensureRegistry();
  const adapters = registry.all().filter((a) => a.id === "hermes" || a.id === "opencode");

  // Each runtime is checked independently. A failure in one never blocks the
  // other. Health probes use bounded timeouts; listener probes are bounded too.
  const diagnostics: RuntimeDiagnostics[] = await Promise.all(
    adapters.map(async (adapter) => {
      const runtimeId = adapter.id as RuntimeId;

      const [health, listening] = await Promise.all([
        adapter.getHealth().catch(
          (e): RuntimeHealth => ({
            runtime: runtimeId,
            connected: false,
            reachable: false,
            error: e instanceof Error ? e.message : String(e),
            lastCheck: Date.now(),
          }),
        ),
        probeRuntimeListener(runtimeId).catch(() => null),
      ]);

      const plan = RUNTIME_STARTUP_PLANS[runtimeId];

      if (health.connected && health.reachable) {
        recordHealthy(runtimeId, health.lastCheck ?? Date.now());
      }

      return buildDiagnostics({
        runtime: runtimeId,
        health,
        configured: isRuntimeConfigured(runtimeId),
        endpoint: getRuntimeEndpoint(runtimeId),
        listening,
        listeningDetail: null,
        starting: isStarting(runtimeId),
        startupSupported: plan.supported,
        startupReason: plan.reason,
        mechanism: plan.mechanism,
        lastHealthyAt: getLastHealthyAt(runtimeId),
      });
    }),
  );

  // Configuration-level facts only. Endpoint presence does NOT imply health.
  const oc = discoverOpenCodeService();

  return NextResponse.json({
    runtimes: diagnostics,
    diagnostics: {
      opencode: {
        configured: Boolean(oc),
        endpoint: oc ? oc.url : null,
        hasServiceFile: Boolean(oc),
      },
      hermes: {
        configured: Boolean(process.env.HERMES_SESSION_TOKEN),
        endpoint: getRuntimeEndpoint("hermes"),
      },
    },
    timestamp: Date.now(),
  });
}
