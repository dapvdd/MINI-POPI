/**
 * Pure formatting and event mapping for unified multi-runtime streams (Phase M).
 *
 * Translates incoming raw RuntimeEvents from Hermes and OpenCode into concise,
 * operator-friendly event stream lines and detailed records.
 */

import type { RuntimeEvent, RuntimeId } from "./types";
import { runtimeLabel } from "../office-workers";

export interface FormattedOfficeEvent {
  id: string;
  runtime: RuntimeId;
  type: string;
  text: string;
  at: number;
  sourceId: string;
}

/**
 * Format a RuntimeEvent into a concise, readable summary string for the Event Stream panel.
 */
export function formatRuntimeEventSummary(event: RuntimeEvent): string {
  const rt = runtimeLabel(event.runtime);
  const type = event.type || "event";
  const p = event.payload || {};

  // Extract common details across runtimes
  let detail = "";
  if (typeof p.tool === "string") {
    detail = ` · ${p.tool}`;
  } else if (typeof p.command === "string") {
    detail = ` · ${p.command}`;
  } else if (typeof p.title === "string") {
    detail = ` · "${p.title}"`;
  } else if (typeof p.name === "string") {
    detail = ` · ${p.name}`;
  } else if (typeof p.goal === "string") {
    detail = ` · ${p.goal}`;
  } else if (typeof p.status === "string") {
    detail = ` (${p.status})`;
  }

  return `[${rt}] ${type}${detail}`;
}

/**
 * Convert a RuntimeEvent into a structured FormattedOfficeEvent.
 */
export function toFormattedOfficeEvent(
  event: RuntimeEvent,
  fallbackIndex = 0,
): FormattedOfficeEvent {
  const text = formatRuntimeEventSummary(event);
  const id = event.id || `${event.runtime}-${event.at}-${fallbackIndex}`;

  return {
    id,
    runtime: event.runtime,
    type: event.type,
    text,
    at: event.at || Date.now(),
    sourceId: event.sourceId || "unknown",
  };
}
