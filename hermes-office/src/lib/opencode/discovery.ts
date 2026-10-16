import fs from "fs";
import path from "path";
import os from "os";

export interface OpenCodeServiceInfo {
  id?: string;
  version?: string;
  url: string;
  pid?: number;
  password: string;
}

/**
 * Discover OpenCode v2 background service from local state files.
 * - Primary: %LOCALAPPDATA%/state/opencode/service.json (or ~/.local/state/opencode/service.json on Unix)
 * - Fallback: %APPDATA%/opencode/service.json (or ~/.config/opencode/service.json)
 * Never logs password. Returns null if not found.
 */
export function discoverOpenCodeService(): OpenCodeServiceInfo | null {
  const candidates: string[] = [];
  const localState = path.join(os.homedir(), ".local", "state", "opencode", "service.json");
  const config = path.join(os.homedir(), ".config", "opencode", "service.json");
  // Windows variants
  if (process.env.LOCALAPPDATA) {
    candidates.push(path.join(process.env.LOCALAPPDATA, "..", ".local", "state", "opencode", "service.json"));
  }
  if (process.env.APPDATA) {
    candidates.push(path.join(process.env.APPDATA, "opencode", "service.json"));
  }
  candidates.push(localState, config);

  for (const p of candidates) {
    try {
      const st = fs.statSync(p);
      if (!st.isFile()) continue;
      const raw = fs.readFileSync(p, "utf8");
      const data = JSON.parse(raw) as Partial<OpenCodeServiceInfo> & { url?: string; password?: string };
      if (data.password && data.url) {
        return {
          id: data.id,
          version: data.version,
          url: data.url,
          pid: data.pid,
          password: data.password,
        };
      }
      // Sometimes only password is in one file - but we need url; continue
    } catch {
      // ignore
    }
  }
  return null;
}

export function getOpenCodeBaseUrl(svc: OpenCodeServiceInfo | null): string | null {
  if (!svc || !svc.url) return null;
  return svc.url.replace(/\/$/, "");
}
