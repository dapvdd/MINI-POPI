import { getHermesClient, subscribeToHermesEvents } from "./server";
import type { RuntimeAdapter } from "../runtime/adapter";
import type {
  RuntimeCapabilities,
  RuntimeEvent,
  RuntimeHealth,
  RuntimeSession,
  RuntimeWorker,
} from "../runtime/types";
import { toCompositeId } from "../runtime/types";
import { normalizeHermesWorker } from "../runtime/normalize";
import { workersToArray } from "./workers";

export class HermesRuntimeAdapter implements RuntimeAdapter {
  id = "hermes" as const;
  version: string | null = null;

  getHealth(): Promise<RuntimeHealth> {
    // Try to get client state; if connected treat as reachable
    try {
      const client = getHermesClient();
      const st = client.getState();
      return Promise.resolve({
        runtime: "hermes",
        connected: st.gatewayConnected,
        reachable: st.gatewayConnected,
        error: st.connectionError || st.lastError || null,
        lastCheck: Date.now(),
      });
    } catch (e) {
      return Promise.resolve({
        runtime: "hermes",
        connected: false,
        reachable: false,
        error: e instanceof Error ? e.message : String(e),
        lastCheck: Date.now(),
      });
    }
  }

  getCapabilities(): RuntimeCapabilities {
    // Verified: list sessions via API routes using existing; create prompt, interrupt, events via client
    return {
      canListSessions: false, // we use REST via app routes where implemented; keep minimal
      canCreateSession: false,
      canSendPrompt: true,
      canInterrupt: true,
      canSubscribeEvents: true,
      canManagePermissions: false,
      supportsWorkers: true,
    };
  }

  listSessions(): Promise<RuntimeSession[]> {
    // Preserve existing behavior; do not reimplement here
    return Promise.resolve([]);
  }

  sendPrompt(sessionId: string, text: string): Promise<unknown> {
    const client = getHermesClient();
    // sessionId here is Hermes source id
    return client.request("prompt.submit", { session_id: sessionId, text });
  }

  interrupt(sessionId: string, workerId?: string): Promise<boolean> {
    const client = getHermesClient();
    if (workerId) {
      return client
        .interruptSubagent(sessionId, workerId)
        .then((r) => Boolean(r?.found))
        .catch(() => false);
    }
    // If no worker id, cannot interrupt generically without more RPC - fail honest
    return Promise.resolve(false);
  }

  subscribeEvents(onEvent: (event: RuntimeEvent) => void): () => void {
    return subscribeToHermesEvents((ev) => {
      const at = Date.now();
      const runtime = "hermes";
      const sourceId = ev.sessionId ?? "unknown";
      onEvent({
        runtime,
        type: ev.type,
        sourceId,
        sessionId: ev.sessionId ? toCompositeId(runtime, ev.sessionId) : undefined,
        payload: ev.payload ?? {},
        at,
      });
    });
  }

  getActiveWorkers(): Promise<RuntimeWorker[]> {
    try {
      const client = getHermesClient();
      const st = client.getState();
      const arr = workersToArray(st.workers);
      return Promise.resolve(arr.map((w) => normalizeHermesWorker(w)));
    } catch {
      return Promise.resolve([]);
    }
  }
}
