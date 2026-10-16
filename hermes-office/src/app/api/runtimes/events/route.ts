import { HermesRuntimeAdapter } from "@/lib/hermes/adapter";
import { OpenCodeRuntimeAdapter } from "@/lib/opencode/adapter";
import { getRuntimeRegistry } from "@/lib/runtime/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const registry = getRuntimeRegistry();
  if (!registry.get("hermes")) registry.register(new HermesRuntimeAdapter());
  if (!registry.get("opencode")) registry.register(new OpenCodeRuntimeAdapter());

  const encoder = new TextEncoder();
  let closed = false;
  let cleanup: (() => void) | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const send = (evt: Record<string, unknown>) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(evt)}\n\n`));
        } catch {
          // Controller closed between the guard and the enqueue.
          closed = true;
        }
      };

      send({ type: "runtimes.hello", payload: { at: Date.now() } });

      const subs: Array<() => void> = [];
      for (const a of registry.all()) {
        if (a.subscribeEvents) {
          subs.push(
            a.subscribeEvents((e) => {
              send({ type: "runtime.event", payload: e });
            }),
          );
        }
      }

      const keepalive = setInterval(() => {
        send({ type: "runtimes.ping", payload: { at: Date.now() } });
      }, 15000);

      // Cleanup MUST run from `cancel()`; a value returned by `start()` is
      // ignored by ReadableStream and would leak subscriptions / throw
      // "Controller is already closed" after the client disconnects.
      cleanup = () => {
        closed = true;
        clearInterval(keepalive);
        for (const s of subs) {
          try {
            s();
          } catch {
            // ignore unsubscribe errors
          }
        }
      };
    },
    cancel() {
      cleanup?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
