import { NextResponse } from "next/server";
import { HermesRuntimeAdapter } from "@/lib/hermes/adapter";
import { OpenCodeRuntimeAdapter } from "@/lib/opencode/adapter";
import { getRuntimeRegistry } from "@/lib/runtime/registry";

export async function GET() {
  const registry = getRuntimeRegistry();
  // Ensure adapters registered (idempotent)
  if (!registry.get("hermes")) {
    try {
      registry.register(new HermesRuntimeAdapter());
    } catch {
      // ignore
    }
  }
  if (!registry.get("opencode")) {
    try {
      registry.register(new OpenCodeRuntimeAdapter());
    } catch {
      // ignore
    }
  }
  const adapters = registry.all();
  const results = await Promise.all(
    adapters.map(async (a) => {
      try {
        const h = await a.getHealth();
        return h;
      } catch (e) {
        return {
          runtime: a.id,
          connected: false,
          reachable: false,
          error: e instanceof Error ? e.message : String(e),
          lastCheck: Date.now(),
        };
      }
    })
  );
  return NextResponse.json({ runtimes: results });
}
