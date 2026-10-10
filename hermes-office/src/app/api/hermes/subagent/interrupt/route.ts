import { interruptSubagent } from "@/lib/hermes/server";

function readId(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  return trimmed.length > 0 ? trimmed : null;
}

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return Response.json(
      { ok: false, error: "Body JSON tidak valid" },
      { status: 400 },
    );
  }

  const payload =
    body && typeof body === "object"
      ? (body as Record<string, unknown>)
      : {};

  const sessionId = readId(payload.session_id);
  const subagentId = readId(payload.subagent_id);

  if (!sessionId || !subagentId) {
    return Response.json(
      { ok: false, error: "session_id dan subagent_id wajib diisi" },
      { status: 400 },
    );
  }

  try {
    const result = await interruptSubagent(sessionId, subagentId);

    return Response.json({ ok: true, result });
  } catch (error) {
    console.error("❌ Hermes subagent interrupt error:", error);

    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
