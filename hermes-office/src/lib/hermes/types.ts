import type { GatewayErrorKind } from "./connection";
import type { WorkersState } from "./workers";

export type AgentStatus =
  | "OFFLINE"
  | "IDLE"
  | "THINKING"
  | "WORKING"
  | "USING_TOOL"
  | "TERMINAL"
  | "ERROR";

export type TurnResultStatus =
  | "complete"
  | "error"
  | "interrupted";

export interface AgentState {
  status: AgentStatus;
  tool: string | null;
  command: string | null;
  lastOutput: string | null;
  lastError: string | null;
  lastResponse: string | null;
  startedAt: number | null;
  /**
   * Increments once per completed turn (`message.complete`). It is the
   * reliable signal clients use to attach the finished response to the
   * matching pending prompt without duplicate appends on replay/reconnect.
   */
  turnSeq: number;
  lastResponseStatus: TurnResultStatus | null;
  /**
   * Next.js -> Hermes Gateway WebSocket state. Distinct from the browser ->
   * Next.js SSE link, which the UI tracks separately.
   */
  gatewayConnected: boolean;
  /**
   * Kind of the most recent Gateway link error: `"auth"` when the session token
   * was rejected (permanent until the process restarts), `"transient"` for a
   * network drop that will be retried, `null` when the link is healthy.
   */
  connectionError: GatewayErrorKind | null;
  /**
   * Delegated subagents, keyed by stable identity. UI-facing contract for the
   * future Three.js office; presentation/animation stays out of this model.
   */
  workers: WorkersState;
}
