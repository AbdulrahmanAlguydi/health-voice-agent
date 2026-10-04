import { diagnosticDetails, type SessionDiagnostic } from "./sessionDiagnostic";

export const PROTOTYPE_LOG_STORAGE_KEY = "health-voice-agent:test-log:v1";
export const MAX_PROTOTYPE_LOG_ENTRIES = 500;
export const MAX_PROTOTYPE_LOG_MESSAGE_LENGTH = 1_200;

export type PrototypeLogEntryType = "patient" | "assistant" | "session" | "tool" | "audio" | "playback" | "diagnostic";

export type PrototypeLogEntry = Partial<SessionDiagnostic> & {
  id: string;
  timestamp: string;
  type: PrototypeLogEntryType;
  message: string;
};

function browserStorage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

function isEntry(value: unknown): value is PrototypeLogEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.id === "string" &&
    typeof entry.timestamp === "string" &&
    Number.isFinite(Date.parse(entry.timestamp)) &&
    ["patient", "assistant", "session", "tool", "audio", "playback", "diagnostic"].includes(String(entry.type)) &&
    typeof entry.message === "string";
}

export function appendPrototypeLog(
  entries: PrototypeLogEntry[],
  entry: PrototypeLogEntry,
): PrototypeLogEntry[] {
  const boundedEntry = {
    ...entry,
    message: entry.message.slice(0, MAX_PROTOTYPE_LOG_MESSAGE_LENGTH),
    ...(entry.details ? { details: boundedDetails(entry.details) } : {}),
  };
  return [...entries, boundedEntry].slice(-MAX_PROTOTYPE_LOG_ENTRIES);
}

function boundedDetails(details: Record<string, unknown>): Record<string, unknown> {
  const clean = diagnosticDetails(details) as Record<string, unknown>;
  const serialized = JSON.stringify(clean);
  return serialized.length <= 64_000 ? clean : { truncated: true, preview: serialized.slice(0, 64_000) };
}

export function loadPrototypeLog(storage: Storage | undefined = browserStorage()): PrototypeLogEntry[] {
  if (!storage) return [];
  try {
    const saved = storage.getItem(PROTOTYPE_LOG_STORAGE_KEY);
    if (!saved) return [];
    const parsed: unknown = JSON.parse(saved);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isEntry).map((entry) => ({
      ...entry,
      message: entry.message.slice(0, MAX_PROTOTYPE_LOG_MESSAGE_LENGTH),
      ...(entry.details ? { details: boundedDetails(entry.details) } : {}),
    })).slice(-MAX_PROTOTYPE_LOG_ENTRIES);
  } catch {
    return [];
  }
}

export function savePrototypeLog(
  entries: PrototypeLogEntry[],
  storage: Storage | undefined = browserStorage(),
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(PROTOTYPE_LOG_STORAGE_KEY, JSON.stringify(entries.slice(-MAX_PROTOTYPE_LOG_ENTRIES).map((entry) => ({ ...entry, ...(entry.details ? { details: boundedDetails(entry.details) } : {}) }))));
    return true;
  } catch {
    return false;
  }
}

export function clearPrototypeLog(storage: Storage | undefined = browserStorage()): boolean {
  if (!storage) return false;
  try {
    storage.removeItem(PROTOTYPE_LOG_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

export function formatPrototypeLog(entries: PrototypeLogEntry[]): string {
  return entries.map((entry) => `${entry.timestamp}  ${entry.message}${entry.event ? `  ${JSON.stringify({ event: entry.event, sessionId: entry.sessionId, turnId: entry.turnId, durationMs: entry.durationMs, details: entry.details ? boundedDetails(entry.details) : undefined })}` : ""}`).join("\n");
}
