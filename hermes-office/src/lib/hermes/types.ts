export type AgentStatus =
  | "OFFLINE"
  | "IDLE"
  | "THINKING"
  | "WORKING"
  | "USING_TOOL"
  | "TERMINAL"
  | "ERROR";

export interface AgentState {
  status: AgentStatus;
  tool: string | null;
  command: string | null;
  lastOutput: string | null;
  lastError: string | null;
  startedAt: number | null;
}