import { NextRequest, NextResponse } from "next/server";
import { isTrustedOperatorRequest } from "@/lib/runtime/trust";
import {
  RUNTIME_STARTUP_PLANS,
  startRuntimeLive,
} from "@/lib/runtime/startup-live";
import type { RuntimeId } from "@/lib/runtime/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_RUNTIMES: RuntimeId[] = ["hermes", "opencode"];

function isRuntimeId(value: unknown): value is RuntimeId {
  return typeof value === "string" && (VALID_RUNTIMES as string[]).includes(value);
}

/**
 * Start (or retry) a local runtime. This is a state-changing control restricted
 * to the local trusted operator context:
 * - POST only
 * - loopback Host/Origin required
 * - runtime id validated against a fixed allow-list
 * - only hard-coded startup commands are ever executed
 */
export async function POST(req: NextRequest) {
  const trust = isTrustedOperatorRequest(req.headers);
  if (!trust.ok) {
    return NextResponse.json(
      { ok: false, error: trust.reason ?? "Forbidden" },
      { status: 403 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const runtime = (body as { runtime?: unknown }).runtime;

  if (!isRuntimeId(runtime)) {
    return NextResponse.json(
      { ok: false, error: "runtime must be one of: hermes, opencode" },
      { status: 400 },
    );
  }

  const plan = RUNTIME_STARTUP_PLANS[runtime];
  if (!plan.supported) {
    return NextResponse.json(
      {
        ok: false,
        runtime,
        outcome: "unsupported",
        error: plan.reason ?? "Automatic startup is not available for this runtime.",
      },
      { status: 501 },
    );
  }

  try {
    const result = await startRuntimeLive(runtime);
    const status = result.ok ? 200 : result.outcome === "starting" ? 409 : 504;
    return NextResponse.json(result, { status });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        runtime,
        outcome: "failed",
        error: e instanceof Error ? e.message : String(e),
      },
      { status: 500 },
    );
  }
}
