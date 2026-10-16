import { HermesClient } from "./client";
import type { AgentState } from "./types";

let client: HermesClient | null = null;

type StateListener = (state: AgentState) => void;
type RawEventListener = (event: { type: string; payload?: Record<string, unknown>; sessionId?: string }) => void;

const listeners = new Set<StateListener>();
const eventListeners = new Set<RawEventListener>();

export function getHermesClient() {
  if (client) {
    return client;
  }

  const token = process.env.HERMES_SESSION_TOKEN;

  if (!token) {
    throw new Error("HERMES_SESSION_TOKEN belum diset");
  }

  client = new HermesClient(token, (state) => {
    console.log("🤖 MINPOP STATE:", state);

    for (const listener of listeners) {
      listener(state);
    }
  });

  // Forward raw events to subscribers (additive)
  client.onEvent((event) => {
    for (const listener of eventListeners) {
      try {
        listener(event);
      } catch (err) {
        console.error("subscribeToHermesEvents listener error:", err);
      }
    }
  });

  client.connect().catch((error) => {
    console.error(
      "❌ Hermes connect failed:",
      error instanceof Error ? error.message : error,
    );
  });

  return client;
}

export function subscribeToHermesState(
  listener: StateListener,
) {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

export function subscribeToHermesEvents(
  listener: RawEventListener,
) {
  eventListeners.add(listener);

  return () => {
    eventListeners.delete(listener);
  };
}

export async function createHermesSession() {
  const hermes = getHermesClient();

  return hermes.request<{ session_id: string }>(
    "session.create",
    {},
  );
}

export async function interruptSubagent(sessionId: string, subagentId: string) {
  const hermes = getHermesClient();

  // Delegate to the single HermesClient so the request reuses the authenticated
  // WebSocket (HERMES_SESSION_TOKEN) and never opens a second Gateway link.
  return hermes.interruptSubagent(sessionId, subagentId);
}