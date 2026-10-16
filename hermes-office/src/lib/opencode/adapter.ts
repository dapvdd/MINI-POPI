import { getOpenCodeAuthHeader, getOpenCodeBaseUrl } from "./client";
import type { RuntimeAdapter } from "../runtime/adapter";
import type {
  RuntimeCapabilities,
  RuntimeEvent,
  RuntimeHealth,
  RuntimeSession,
  RuntimeWorker,
} from "../runtime/types";
import { toCompositeId } from "../runtime/types";

interface OpenCodeSession {
  id: string | number;
  title?: string | null;
  directory?: string | null;
  location?: { directory?: string | null };
  createdAt?: number | null;
  updatedAt?: number | null;
  time?: { created?: number | null; updated?: number | null };
  status?: string | null;
  project?: string | null;
  parentID?: string | number | null;
}

function mapSessionToRuntime(s: unknown): RuntimeSession | null {
  if (!s || typeof s !== "object") return null;
  const sess = s as OpenCodeSession;
  if (sess.id == null) return null;
  const sourceId = String(sess.id);
  const dir = sess.directory || sess.location?.directory || null;
  return {
    id: toCompositeId("opencode", sourceId),
    runtime: "opencode",
    sourceId,
    title: sess.title || null,
    directory: typeof dir === "string" ? dir : null,
    createdAt: sess.createdAt || sess.time?.created || null,
    updatedAt: sess.updatedAt || sess.time?.updated || null,
    status: sess.status || null,
    project: sess.project || null,
    parentId: sess.parentID != null ? toCompositeId("opencode", String(sess.parentID)) : null,
  };
}

export class OpenCodeRuntimeAdapter implements RuntimeAdapter {
  id = "opencode" as const;
  version: string | null = null;

  private getAuthAndBase(): { base: string; headers: Record<string, string> } | null {
    const base = getOpenCodeBaseUrl();
    const auth = getOpenCodeAuthHeader();
    if (!base || !auth) return null;
    return { base, headers: auth };
  }

  async getHealth(): Promise<RuntimeHealth> {
    const ab = this.getAuthAndBase();
    if (!ab) {
      return {
        runtime: "opencode",
        connected: false,
        reachable: false,
        error: "OpenCode service not discovered (service.json missing or incomplete)",
        lastCheck: Date.now(),
      };
    }
    try {
      const res = await fetch(`${ab.base}/api/info`, {
        headers: { ...ab.headers },
        cache: "no-store",
      });
      if (!res.ok) {
        return {
          runtime: "opencode",
          connected: false,
          reachable: false,
          error: `HTTP ${res.status}`,
          lastCheck: Date.now(),
        };
      }
      const data = await res.json().catch(() => ({}));
      const v = data?.version || data?.data?.version;
      if (typeof v === "string") this.version = v;
      return {
        runtime: "opencode",
        connected: true,
        reachable: true,
        version: this.version,
        lastCheck: Date.now(),
      };
    } catch (e) {
      return {
        runtime: "opencode",
        connected: false,
        reachable: false,
        error: e instanceof Error ? e.message : String(e),
        lastCheck: Date.now(),
      };
    }
  }

  getCapabilities(): RuntimeCapabilities {
    return {
      canListSessions: true,
      canCreateSession: true,
      canSendPrompt: true,
      canInterrupt: true,
      canSubscribeEvents: true,
      canManagePermissions: true,
      supportsWorkers: true,
    };
  }

  async listSessions(options?: { directory?: string }): Promise<RuntimeSession[]> {
    const ab = this.getAuthAndBase();
    if (!ab) return [];
    const url = new URL(`${ab.base}/api/session`);
    if (options?.directory) {
      url.searchParams.set("directory", options.directory);
    }
    const res = await fetch(url.toString(), {
      headers: { ...ab.headers },
      cache: "no-store",
    });
    if (!res.ok) return [];
    const body = await res.json().catch(() => ({}));
    const data = Array.isArray(body?.data) ? body.data : Array.isArray(body) ? body : [];
    return data
      .map((s: unknown) => mapSessionToRuntime(s))
      .filter((x: RuntimeSession | null): x is RuntimeSession => x !== null);
  }

  async createSession(options: { directory: string; title?: string }): Promise<RuntimeSession> {
    const ab = this.getAuthAndBase();
    if (!ab) throw new Error("OpenCode service not available");
    const res = await fetch(`${ab.base}/api/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...ab.headers },
      body: JSON.stringify({
        location: { directory: options.directory },
        title: options.title,
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json().catch(() => ({}));
    const sess = body?.data || body;
    const mapped = mapSessionToRuntime(sess);
    if (!mapped) throw new Error("Invalid session response");
    return mapped;
  }

  async sendPrompt(sessionId: string, text: string): Promise<unknown> {
    const ab = this.getAuthAndBase();
    if (!ab) throw new Error("OpenCode service not available");
    const res = await fetch(`${ab.base}/api/session/${encodeURIComponent(sessionId)}/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...ab.headers },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json().catch(() => ({}));
  }

  async interrupt(sessionId: string, workerId?: string): Promise<boolean> {
    const ab = this.getAuthAndBase();
    if (!ab) throw new Error("OpenCode service not available");
    const url = new URL(`${ab.base}/api/session/${encodeURIComponent(sessionId)}/interrupt`);
    if (workerId) {
      url.searchParams.set("resume", "false");
    }
    const res = await fetch(url.toString(), {
      method: "POST",
      headers: { ...ab.headers },
    });
    if (!res.ok) return false;
    const body = await res.json().catch(() => ({}));
    return body?.interrupted === true;
  }

  async getMessages(sessionId: string, options?: { cursor?: string | null }): Promise<{ messages: unknown[]; cursor?: string | null }> {
    const ab = this.getAuthAndBase();
    if (!ab) return { messages: [] };
    const url = new URL(`${ab.base}/api/session/${encodeURIComponent(sessionId)}/message`);
    if (options?.cursor) url.searchParams.set("cursor", options.cursor);
    const res = await fetch(url.toString(), {
      headers: { ...ab.headers },
      cache: "no-store",
    });
    if (!res.ok) return { messages: [] };
    const body = await res.json().catch(() => ({}));
    return {
      messages: Array.isArray(body?.data) ? body.data : [],
      cursor: body?.cursor || null,
    };
  }

  async managePermission(sessionId: string, requestId: string, decision: "once" | "always" | "reject"): Promise<void> {
    const ab = this.getAuthAndBase();
    if (!ab) throw new Error("OpenCode service not available");
    const res = await fetch(
      `${ab.base}/api/session/${encodeURIComponent(sessionId)}/permission/${encodeURIComponent(requestId)}/reply`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...ab.headers },
        body: JSON.stringify({ decision }),
      },
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  }

  subscribeEvents(onEvent: (event: RuntimeEvent) => void): () => void {
    const ab = this.getAuthAndBase();
    if (!ab) {
      return () => {};
    }
    let aborted = false;
    let controller: AbortController | null = null;
    const start = async () => {
      if (aborted) return;
      controller = new AbortController();
      try {
        const res = await fetch(`${ab.base}/api/event`, {
          headers: { ...ab.headers, Accept: "text/event-stream" },
          cache: "no-store",
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          // Reconnect with backoff after short delay
          setTimeout(start, 1000);
          return;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() || "";
          for (const line of lines) {
            if (line.startsWith(":")) continue; // heartbeat
            if (!line.startsWith("data:")) continue;
            const json = line.slice(5).trim();
            if (!json) continue;
            try {
              const env = JSON.parse(json) as { id?: string; type: string; data?: unknown };
              const data = env.data as Record<string, unknown> | undefined;
              const sid = (data?.sessionID as string | number | undefined) || (data?.sessionId as string | number | undefined);
              onEvent({
                id: env.id,
                runtime: "opencode",
                type: env.type,
                sourceId: sid != null ? String(sid) : "unknown",
                sessionId: sid != null ? toCompositeId("opencode", String(sid)) : undefined,
                payload: (data as Record<string, unknown>) || {},
                at: Date.now(),
              });
            } catch {
              // ignore malformed
            }
          }
        }
      } catch {
        if (aborted) return;
        setTimeout(start, 2000);
      }
    };
    start();
    return () => {
      aborted = true;
      controller?.abort();
    };
  }

  async getActiveWorkers(): Promise<RuntimeWorker[]> {
    const ab = this.getAuthAndBase();
    if (!ab) return [];
    try {
      const res = await fetch(`${ab.base}/api/session/active`, {
        headers: { ...ab.headers },
        cache: "no-store",
      });
      if (!res.ok) return [];
      const body = await res.json().catch(() => ({}));
      const data = body?.data || {};
      const workers: RuntimeWorker[] = [];
      for (const [sid, info] of Object.entries(data as Record<string, unknown>)) {
        const i = info as Record<string, unknown>;
        // Only consider running sessions as active work; represent as primary/active
        if (i?.type === "running") {
          workers.push({
            id: toCompositeId("opencode", String(sid)),
            runtime: "opencode",
            sourceId: String(sid),
            role: "primary",
            status: "running",
            goal: null,
            activity: null,
            parentId: null,
            childSessionId: null,
            startedAt: null,
            updatedAt: Date.now(),
            completedAt: null,
            model: null,
            tokens: null,
            toolsets: [],
            summary: null,
            sessionId: toCompositeId("opencode", String(sid)),
            name: null,
            kind: "session",
            stale: false,
            lastSeenAt: Date.now(),
          });
        }
      }
      return workers;
    } catch {
      return [];
    }
  }
}
