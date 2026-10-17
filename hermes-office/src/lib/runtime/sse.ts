/**
 * Small, pure helpers for browser SSE subscriptions.
 *
 * The page opens several `EventSource` streams (Hermes state + unified runtime
 * events). Reconnects and server replays can deliver the same frame twice, and
 * naive error handlers can schedule overlapping reconnects. These helpers keep
 * that bookkeeping testable without a DOM: bounded id de-duplication and a
 * capped exponential backoff.
 */

/** Never wait longer than this between SSE reconnect attempts. */
export const SSE_MAX_RETRY_MS = 15000;

/** Double the current delay, clamped to `[1, max]`. */
export function nextRetryDelay(
  current: number,
  max: number = SSE_MAX_RETRY_MS,
): number {
  const safe = Number.isFinite(current) && current > 0 ? current : 1;
  return Math.min(safe * 2, max);
}

export interface EventIdTracker {
  /** True the first time an id is seen; false for a replay/duplicate. */
  accept(id: string): boolean;
  size(): number;
  reset(): void;
}

/**
 * Bounded set of recently seen event ids. Oldest ids are evicted past `limit`,
 * so a very late replay is not guaranteed to be dropped — but the window is
 * large enough to cover a reconnect burst without unbounded memory growth.
 */
export function createEventIdTracker(limit = 250): EventIdTracker {
  const cap = Math.max(1, Math.floor(limit));
  const seen = new Set<string>();
  const order: string[] = [];

  return {
    accept(id: string): boolean {
      if (!id) return true;
      if (seen.has(id)) return false;

      seen.add(id);
      order.push(id);
      while (order.length > cap) {
        const oldest = order.shift();
        if (oldest !== undefined) seen.delete(oldest);
      }
      return true;
    },
    size(): number {
      return seen.size;
    },
    reset(): void {
      seen.clear();
      order.length = 0;
    },
  };
}
