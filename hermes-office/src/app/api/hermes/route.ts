import { getHermesClient } from "@/lib/hermes/server";

export async function GET() {
  try {
    getHermesClient();

    return Response.json({
      ok: true,
      message: "Hermes client started",
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}