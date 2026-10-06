import {
  getHermesClient,
  subscribeToHermesState,
} from "@/lib/hermes/server";

export async function GET() {
  const encoder = new TextEncoder();

  let unsubscribe: (() => void) | null = null;

  const stream = new ReadableStream({
    start(controller) {
      getHermesClient();

      const send = (state: unknown) => {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify(state)}\n\n`,
          ),
        );
      };

      unsubscribe = subscribeToHermesState(send);

      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify(
            getHermesClient().getState(),
          )}\n\n`,
        ),
      );
    },

    cancel() {
      unsubscribe?.();
      unsubscribe = null;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}