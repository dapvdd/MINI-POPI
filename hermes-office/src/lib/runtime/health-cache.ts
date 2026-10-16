/**
 * In-process record of the last time each runtime was observed healthy.
 *
 * The status API runs in the Next.js server process, so a small module-level
 * map is enough to report "last successful health check" even after a runtime
 * later goes offline. It is intentionally bounded (fixed keys) and never
 * stores credentials — only timestamps.
 */
import type { RuntimeId } from "./types";

const lastHealthy = new Map<RuntimeId, number>();

export function recordHealthy(runtime: RuntimeId, at: number): void {
  lastHealthy.set(runtime, at);
}

export function getLastHealthyAt(runtime: RuntimeId): number | null {
  return lastHealthy.get(runtime) ?? null;
}

/** Test helper — clears recorded timestamps. */
export function resetHealthCache(): void {
  lastHealthy.clear();
}
