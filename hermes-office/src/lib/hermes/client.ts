import WebSocket from "ws";
import type { AgentState } from "./types";
import {
  AUTH_RECOVERY_HINT,
  classifyGatewayError,
  decideReconnect,
  type GatewayErrorKind,
} from "./connection";
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
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private closedByUs = false;
  /**
   * Set after a 401/403. The session token is read from the environment once at
   * process boot, so no in-process retry can succeed; we stop the loop and
   * surface a recovery hint instead of hammering the Gateway.
   */
  private authBlocked = false;
  private lastErrorKind: GatewayErrorKind | null = null;

  private state: AgentState = {
    status: "OFFLINE",
    tool: null,
    command: null,
    lastOutput: null,
    lastError: null,
    lastResponse: null,
    startedAt: null,
    turnSeq: 0,
    lastResponseStatus: null,
    gatewayConnected: false,
    connectionError: null,
    workers: {},
  };

  constructor(
    private readonly token: string,
    private readonly onStateChange: (state: AgentState) => void,
  ) {}

  connect() {
    if (this.wsReady) {
      return this.wsReady;
    }

    if (this.authBlocked) {
      return Promise.reject(new Error(AUTH_RECOVERY_HINT));
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
        this.reconnectAttempt = 0;
        this.authBlocked = false;
        this.lastErrorKind = null;

        console.log("🔌 Connected to Hermes Gateway");

        const stale =
          this.state.status === "OFFLINE" ||
          this.state.status === "ERROR";

        const nextStatus = stale ? "IDLE" : this.state.status;
        const nextError =
          stale || this.state.lastError
            ? null
            : this.state.lastError;

        if (
          nextStatus !== this.state.status ||
          nextError !== this.state.lastError ||
          this.state.connectionError !== null ||
          !this.state.gatewayConnected
        ) {
          this.updateState({
            ...this.state,
            status: nextStatus,
            lastError: nextError,
            gatewayConnected: true,
            connectionError: null,
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

        if (
          this.state.status !== "OFFLINE" ||
          this.state.gatewayConnected
        ) {
          this.updateState({
            ...this.state,
            status: "OFFLINE",
            gatewayConnected: false,
          });
        }

        console.log("🔌 Hermes Gateway disconnected");

        if (this.closedByUs) {
          return;
        }

        const decision = decideReconnect(
          this.lastErrorKind ?? "unknown",
          this.reconnectAttempt + 1,
        );

        if (decision.retry) {
          this.reconnectAttempt += 1;
          this.scheduleReconnect(decision.delayMs);
        }
      });

      this.ws.on("error", (error) => {
        const classified = classifyGatewayError(error.message);

        console.error("❌ Hermes WebSocket error:", classified.message);

        if (classified.kind === "auth") {
          this.authBlocked = true;
        }

        this.lastErrorKind = classified.kind;

        this.updateState({
          ...this.state,
          status: "ERROR",
          lastError: classified.message,
          gatewayConnected: false,
          connectionError: classified.kind,
        });

        reject(new Error(classified.message));
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

  private scheduleReconnect(delayMs: number) {
    if (this.reconnectTimer) {
      return;
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch(() => {});
    }, delayMs);
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
