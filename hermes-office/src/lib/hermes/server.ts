import { HermesClient } from "./client";

let client: HermesClient | null = null;

export function getHermesClient() {
  if (client) {
    return client;
  }

  const token = process.env.HERMES_TOKEN;

  if (!token) {
    throw new Error("HERMES_TOKEN belum diset");
  }

  client = new HermesClient(token, (state) => {
    console.log("🤖 MINPOP STATE:", state);
  });

  client.connect();

  return client;
}