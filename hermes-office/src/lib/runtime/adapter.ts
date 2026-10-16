import type {
  RuntimeCapabilities,
  RuntimeEvent,
  RuntimeHealth,
  RuntimeSession,
  RuntimeWorker,
} from "./types";

/**
 * Common adapter contract for runtimes (Hermes, OpenCode).
 * Only claim capabilities that are verified; degrade honestly.
 */
export interface RuntimeAdapter {
  id: "hermes" | "opencode";
  version?: string | null;
  getHealth(): Promise<RuntimeHealth>;
  getCapabilities(): RuntimeCapabilities;
  listSessions(options?: { directory?: string }): Promise<RuntimeSession[]>;
  createSession?(options: { directory: string; title?: string }): Promise<RuntimeSession>;
  sendPrompt?(sessionId: string, text: string): Promise<unknown>;
  interrupt?(sessionId: string, workerId?: string): Promise<boolean>;
  getMessages?(sessionId: string, options?: { cursor?: string | null }): Promise<{ messages: unknown[]; cursor?: string | null }>;
  managePermission?(sessionId: string, requestId: string, decision: "once" | "always" | "reject"): Promise<void>;
  subscribeEvents?(onEvent: (event: RuntimeEvent) => void): () => void;
  getActiveWorkers?(): Promise<RuntimeWorker[]>;
}
