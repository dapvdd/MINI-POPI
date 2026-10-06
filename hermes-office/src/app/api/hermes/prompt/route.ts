import { getHermesClient } from "@/lib/hermes/server";

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const sessionId = body.session_id;
    const prompt = body.prompt;

    if (!sessionId || !prompt) {
      return Response.json(
        {
          ok: false,
          error: "session_id dan prompt wajib diisi",
        },
        { status: 400 },
      );
    }

    const hermes = getHermesClient();

    const result = await hermes.submitPrompt(
      sessionId,
      prompt,
    );

    return Response.json({
      ok: true,
      result,
    });
  } catch (error) {
    console.error("❌ Hermes prompt error:", error);

    return Response.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Unknown error",
      },
      { status: 500 },
    );
  }
}