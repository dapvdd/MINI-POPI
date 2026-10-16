import { NextRequest, NextResponse } from "next/server";
import { HermesRuntimeAdapter } from "@/lib/hermes/adapter";
import { OpenCodeRuntimeAdapter } from "@/lib/opencode/adapter";
import { getRuntimeRegistry } from "@/lib/runtime/registry";

export async function GET(req: NextRequest) {
  const registry = getRuntimeRegistry();
  if (!registry.get("hermes")) registry.register(new HermesRuntimeAdapter());
  if (!registry.get("opencode")) registry.register(new OpenCodeRuntimeAdapter());
  const url = new URL(req.url);
  const rt = url.searchParams.get("runtime") as "hermes" | "opencode" | null;
  const directory = url.searchParams.get("directory") || undefined;
  if (rt) {
    const a = registry.get(rt);
    if (!a) return NextResponse.json({ sessions: [], error: "unknown runtime" }, { status: 404 });
    try {
      const sessions = await a.listSessions({ directory });
      return NextResponse.json({ runtime: rt, sessions });
    } catch (e) {
      return NextResponse.json(
        { runtime: rt, sessions: [], error: e instanceof Error ? e.message : String(e) },
        { status: 500 }
      );
    }
  }
  // aggregate all
  const all = await Promise.all(
    registry.all().map(async (a) => {
      try {
        return await a.listSessions({ directory });
      } catch {
        return [];
      }
    })
  );
  return NextResponse.json({ runtimes: registry.all().map((a) => a.id), sessions: all.flat() });
}
