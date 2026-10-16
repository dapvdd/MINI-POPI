import { HermesRuntimeAdapter } from "@/lib/hermes/adapter";
import { OpenCodeRuntimeAdapter } from "@/lib/opencode/adapter";
import { getRuntimeRegistry } from "@/lib/runtime/registry";

export const runtime = "nodejs";

export async function GET() {
  const registry = getRuntimeRegistry();
  if (!registry.get("hermes")) registry.register(new HermesRuntimeAdapter());
  if (!registry.get("opencode")) registry.register(new OpenCodeRuntimeAdapter());
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      const send = (evt: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(evt)}\n\n`));
      };
      send({ type: "runtimes.hello", payload: { at: Date.now() } });
      const subs: Array<() => void> = [];
      for (const a of registry.all()) {
        if (a.subscribeEvents) {
          subs.push(
            a.subscribeEvents((e) => {
              send({ type: "runtime.event", payload: e });
            })
          );
        }
      }
      const keepalive = setInterval(() => {
        send({ type: "runtimes.ping", payload: { at: Date.now() } });
      }, 15000);
      return () => {
        clearInterval(keepalive);
        for (const s of subs) s();
      };
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
