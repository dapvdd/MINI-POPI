import { discoverOpenCodeService } from "./discovery";

export function getOpenCodeAuthHeader(): { Authorization: string } | null {
  const svc = discoverOpenCodeService();
  if (!svc) return null;
  const token = Buffer.from(`opencode:${svc.password}`).toString("base64");
  return { Authorization: `Basic ${token}` };
}

export function getOpenCodeBaseUrl(): string | null {
  const svc = discoverOpenCodeService();
  if (!svc) return null;
  return svc.url.replace(/\/$/, "");
}
