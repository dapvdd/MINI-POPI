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
  private wsReady: Promise<void> | null = null;
  private requestId = 1;

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
    if (this.wsReady) {
      return this.wsReady;
    }

    const url =
      `ws://127.0.0.1:9119/api/ws?token=${encodeURIComponent(this.token)}`;

    this.wsReady = new Promise<void>((resolve, reject) => {
      this.ws = new WebSocket(url);

      this.ws.on("open", () => {
        console.log("🔌 Connected to Hermes Gateway");
        resolve();
      });

      this.ws.on("message", (data) => {
        this.handleMessage(data.toString());
      });

      this.ws.on("close", () => {
        this.wsReady = null;
        this.ws = null;

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

        reject(error);
      });
    });

    return this.wsReady;
  }

  disconnect() {
    this.wsReady = null;
    this.ws?.close();
    this.ws = null;
  }

  async request<T = unknown>(
    method: string,
    params: Record<string, unknown> = {},
  ) {
    await this.connect();

    return new Promise<T>((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error("Hermes WebSocket belum connected"));
        return;
      }

      const id = this.requestId++;

      const handleMessage = (data: WebSocket.RawData) => {
        let message: {
          id?: number;
          result?: T;
          error?: {
            message?: string;
          };
        };

        try {
          message = JSON.parse(data.toString());
        } catch {
          return;
        }

        if (message.id !== id) {
          return;
        }

        this.ws?.off("message", handleMessage);

        if (message.error) {
          reject(
            new Error(
              message.error.message ?? "Hermes RPC error",
            ),
          );
          return;
        }

        resolve(message.result as T);
      };

      this.ws.on("message", handleMessage);

      this.ws.send(
        JSON.stringify({
          jsonrpc: "2.0",
          id,
          method,
          params,
        }),
      );
    });
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