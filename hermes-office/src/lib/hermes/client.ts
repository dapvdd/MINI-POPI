import WebSocket from "ws";
import type { AgentState } from "./types";
import { mapEventToState } from "./state-adapter";

interface HermesMessage {
  method?: string;
  params?: {
    type?: string;
    payload?: Record<string, unknown>;
  };
}

export class HermesClient {
  private ws: WebSocket | null = null;

  private state: AgentState = {
    status: "OFFLINE",
    tool: null,
    command: null,
    lastOutput: null,
    lastError: null,
    startedAt: null,
  };

  constructor(
    private readonly token: string,
    private readonly onStateChange: (state: AgentState) => void,
  ) {}

  connect() {
    const url =
      `ws://127.0.0.1:9119/api/ws?token=${encodeURIComponent(this.token)}`;

    this.ws = new WebSocket(url);

    this.ws.on("open", () => {
      console.log("🔌 Connected to Hermes Gateway");
    });

    this.ws.on("message", (data) => {
      this.handleMessage(data.toString());
    });

    this.ws.on("close", () => {
      this.state = {
        ...this.state,
        status: "OFFLINE",
      };

      this.onStateChange(this.state);
      console.log("🔌 Hermes Gateway disconnected");
    });

    this.ws.on("error", (error) => {
      console.error("❌ Hermes WebSocket error:", error.message);

      this.state = {
        ...this.state,
        status: "ERROR",
        lastError: error.message,
      };

      this.onStateChange(this.state);
    });
  }

  disconnect() {
    this.ws?.close();
    this.ws = null;
  }

  getState() {
    return this.state;
  }

  private handleMessage(raw: string) {
    let message: HermesMessage;

    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }

    if (message.method !== "event") {
      return;
    }

    const type = message.params?.type;

    if (!type) {
      return;
    }

    this.state = mapEventToState(this.state, {
      type,
      payload: message.params?.payload,
    });

    this.onStateChange(this.state);
  }
}