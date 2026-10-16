import { NextResponse } from "next/server";
import { HermesRuntimeAdapter } from "@/lib/hermes/adapter";
import { OpenCodeRuntimeAdapter } from "@/lib/opencode/adapter";
import { getRuntimeRegistry } from "@/lib/runtime/registry";
import type { RuntimeId, RuntimeWorker } from "@/lib/runtime/types";

/**
 * Aggregated live workers across every runtime (Phase L).
 *
 * Each runtime is queried independently and never blocks another: a failing or
 * offline runtime reports `{ ok: false, workers: [] }` so the office can mark
 * its previously-seen workers stale rather than pretending they are working or
 * dropping them. No secrets are ever included — only normalized worker fields.
 */
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
  const adapters = registry
    .all()
    .filter((a) => a.id === "hermes" || a.id === "opencode");

  const perRuntime: Partial<
    Record<RuntimeId, { ok: boolean; workers: RuntimeWorker[]; error?: string | null }>
  > = {};

  await Promise.all(
    adapters.map(async (adapter) => {
      const runtimeId = adapter.id as RuntimeId;
      if (!adapter.getActiveWorkers) {
        perRuntime[runtimeId] = { ok: true, workers: [] };
        return;
      }
      try {
        const workers = await adapter.getActiveWorkers();
        perRuntime[runtimeId] = { ok: true, workers };
      } catch (error) {
        perRuntime[runtimeId] = {
          ok: false,
          workers: [],
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }),
  );

  const workers: RuntimeWorker[] = [
    ...(perRuntime.hermes?.workers ?? []),
    ...(perRuntime.opencode?.workers ?? []),
  ];

  return NextResponse.json({
    workers,
    runtimes: {
      hermes: {
        ok: perRuntime.hermes?.ok ?? false,
        count: perRuntime.hermes?.workers.length ?? 0,
      },
      opencode: {
        ok: perRuntime.opencode?.ok ?? false,
        count: perRuntime.opencode?.workers.length ?? 0,
      },
    },
    timestamp: Date.now(),
  });
}
