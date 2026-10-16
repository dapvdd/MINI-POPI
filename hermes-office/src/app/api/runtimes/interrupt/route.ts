import { NextRequest, NextResponse } from "next/server";
import { HermesRuntimeAdapter } from "@/lib/hermes/adapter";
import { OpenCodeRuntimeAdapter } from "@/lib/opencode/adapter";
import { getRuntimeRegistry } from "@/lib/runtime/registry";
import { isTrustedOperatorRequest } from "@/lib/runtime/trust";
import { sanitizeError } from "@/lib/runtime/lifecycle";
import { splitCompositeId, type RuntimeId } from "@/lib/runtime/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function ensureRegistry() {
  const registry = getRuntimeRegistry();
  if (!registry.get("hermes")) registry.register(new HermesRuntimeAdapter());
  if (!registry.get("opencode")) registry.register(new OpenCodeRuntimeAdapter());
  return registry;
}

export async function POST(req: NextRequest) {
  const trust = isTrustedOperatorRequest(req.headers);
  if (!trust.ok) {
    return NextResponse.json(
      { ok: false, error: trust.reason ?? "Forbidden" },
      { status: 403 },
    );
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const rawId = typeof body.id === "string" ? body.id.trim() : null;
  let targetRuntime = typeof body.runtime === "string" ? body.runtime.trim() : null;
  let sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : (typeof body.session_id === "string" ? body.session_id.trim() : null);
  let workerId = typeof body.workerId === "string" ? body.workerId.trim() : (typeof body.subagent_id === "string" ? body.subagent_id.trim() : null);

  if (rawId) {
    const { runtime, sourceId } = splitCompositeId(rawId);
    if (runtime) {
      targetRuntime = runtime;
      if (runtime === "opencode") {
        sessionId = sessionId ?? sourceId;
      } else if (runtime === "hermes") {
        workerId = workerId ?? sourceId;
      }
    }
  }

  if (targetRuntime !== "hermes" && targetRuntime !== "opencode") {
    return NextResponse.json(
      { ok: false, error: "runtime must be one of: hermes, opencode" },
      { status: 400 },
    );
  }

  const rt = targetRuntime as RuntimeId;
  const registry = ensureRegistry();
  const adapter = registry.get(rt);

  if (!adapter) {
    return NextResponse.json(
      { ok: false, runtime: rt, error: `Runtime adapter not found: ${rt}` },
      { status: 404 },
    );
  }

  if (!adapter.interrupt) {
    return NextResponse.json(
      { ok: false, runtime: rt, error: `Interrupt is unsupported for runtime ${rt}` },
      { status: 501 },
    );
  }

  if (!sessionId) {
    return NextResponse.json(
      { ok: false, runtime: rt, error: "sessionId is required for interrupt" },
      { status: 400 },
    );
  }

  try {
    const result = await adapter.interrupt(sessionId, workerId || undefined);
    return NextResponse.json({
      ok: true,
      runtime: rt,
      interrupted: result,
      found: result,
      sourceId: workerId || sessionId,
    });
  } catch (err) {
    const sanitized = sanitizeError(err) ?? "Interrupt execution failed";
    return NextResponse.json(
      { ok: false, runtime: rt, error: sanitized },
      { status: 500 },
    );
  }
}
