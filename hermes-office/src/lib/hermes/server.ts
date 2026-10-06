import { HermesClient } from "./client";

let client: HermesClient | null = null;

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
  });

  client.connect();

  return client;
}

export async function createHermesSession() {
  const hermes = getHermesClient();

  return hermes.request<{ session_id: string }>(
    "session.create",
    {},
  );
}