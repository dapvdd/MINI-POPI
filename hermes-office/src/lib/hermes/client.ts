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

const RECONNECT_BASE_DELAY = 1000;
const RECONNECT_MAX_DELAY = 15000;

export class HermesClient {
  private ws: WebSocket | null = null;
  private wsReady: Promise<void> | null = null;
  private requestId = 1;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = RECONNECT_BASE_DELAY;
  private closedByUs = false;

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

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.closedByUs = false;

    const url =
      `ws://127.0.0.1:9119/api/ws?token=${encodeURIComponent(this.token)}`;

    this.wsReady = new Promise<void>((resolve, reject) => {
      this.ws = new WebSocket(url);

      this.ws.on("open", () => {
        this.reconnectDelay = RECONNECT_BASE_DELAY;
        console.log("🔌 Connected to Hermes Gateway");

        const stale =
          this.state.status === "OFFLINE" ||
          this.state.status === "ERROR";

        if (stale || this.state.lastError) {
          this.updateState({
            ...this.state,
            status: stale ? "IDLE" : this.state.status,
            lastError: null,
          });
        }

        resolve();
      });

      this.ws.on("message", (data) => {
        this.handleMessage(data.toString());
      });

      this.ws.on("close", () => {
        this.wsReady = null;
        this.ws = null;

        if (this.state.status !== "OFFLINE") {
          this.updateState({
            ...this.state,
            status: "OFFLINE",
          });
        }

        console.log("🔌 Hermes Gateway disconnected");

        if (!this.closedByUs) {
          this.scheduleReconnect();
        }
      });

      this.ws.on("error", (error) => {
        console.error("❌ Hermes WebSocket error:", error.message);

        this.updateState({
          ...this.state,
          status: "ERROR",
          lastError: error.message,
        });

        reject(error);
      });
    });

    return this.wsReady;
  }

  disconnect() {
    this.closedByUs = true;
    this.wsReady = null;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.ws?.close();
    this.ws = null;
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) {
      return;
    }

    const delay = this.reconnectDelay;

    this.reconnectDelay = Math.min(
      this.reconnectDelay * 2,
      RECONNECT_MAX_DELAY,
    );

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch(() => {});
    }, delay);
  }

  private updateState(next: AgentState) {
    if (next === this.state) {
      return;
    }

    this.state = next;
    this.onStateChange(next);
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

      let timer: ReturnType<typeof setTimeout> | null = null;

      const settle = (fn: () => void) => {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }

        this.ws?.off("message", handleMessage);
        fn();
      };

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

        settle(() => {
          if (message.error) {
            reject(
              new Error(
                message.error.message ?? "Hermes RPC error",
              ),
            );
            return;
          }

          resolve(message.result as T);
        });
      };

      this.ws.on("message", handleMessage);

      timer = setTimeout(() => {
        settle(() => {
          reject(new Error(`Hermes RPC timeout: ${method}`));
        });
      }, 30000);

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

async submitPrompt(sessionId: string, prompt: string) {
  return this.request(
    "prompt.submit",
    {
      session_id: sessionId,
      text: prompt,
    },
  );
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

    this.updateState(
      mapEventToState(this.state, {
        type,
        payload: message.params?.payload,
      }),
    );
  }
}