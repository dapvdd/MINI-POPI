import type { RuntimeHealth, RuntimeSession, RuntimeWorker } from "./types";

export interface UnifiedStore {
  health: Record<string, RuntimeHealth>;
  sessions: RuntimeSession[];
  workers: RuntimeWorker[];
}

export const createEmptyStore = (): UnifiedStore => ({
  health: {},
  sessions: [],
  workers: [],
});
