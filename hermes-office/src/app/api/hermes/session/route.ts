import { createHermesSession } from "@/lib/hermes/server";

export async function POST() {
  try {
    const session = await createHermesSession();

    return Response.json({
      ok: true,
      session,
    });
  } catch (error) {
    console.error("❌ Hermes session error:", error);

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