import { HermesClient } from "./client";
import type { AgentState } from "./types";

let client: HermesClient | null = null;

type StateListener = (state: AgentState) => void;

const listeners = new Set<StateListener>();

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

  client.connect();

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

export async function createHermesSession() {
  const hermes = getHermesClient();

  return hermes.request<{ session_id: string }>(
    "session.create",
    {},
  );
}