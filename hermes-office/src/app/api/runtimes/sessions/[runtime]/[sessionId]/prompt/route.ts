import { NextRequest, NextResponse } from "next/server";
import { HermesRuntimeAdapter } from "@/lib/hermes/adapter";
import { OpenCodeRuntimeAdapter } from "@/lib/opencode/adapter";
import { getRuntimeRegistry } from "@/lib/runtime/registry";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ runtime: string; sessionId: string }> }
) {
  const registry = getRuntimeRegistry();
  if (!registry.get("hermes")) registry.register(new HermesRuntimeAdapter());
  if (!registry.get("opencode")) registry.register(new OpenCodeRuntimeAdapter());
  const { runtime, sessionId } = await params;
  const rt = runtime as "hermes" | "opencode";
  const a = registry.get(rt);
  if (!a) return NextResponse.json({ error: "unknown runtime" }, { status: 404 });
  if (!a.sendPrompt) return NextResponse.json({ error: "unsupported" }, { status: 501 });
  try {
    const body = await req.json().catch(() => ({}));
    const text = String(body.text || body.prompt || "");
    if (!text) return NextResponse.json({ error: "text required" }, { status: 400 });
    const res = await a.sendPrompt(sessionId, text);
    return NextResponse.json({ ok: true, result: res });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
