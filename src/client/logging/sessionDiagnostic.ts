export type SessionDiagnostic = {
  event: string;
  sessionId: string;
  turnId?: number;
  timestamp: string;
  durationMs?: number;
  details?: Record<string, unknown>;
};

// Test callers can supply arbitrary results. Never retain credentials or PCM.
export function diagnosticDetails(value: unknown, depth = 0): unknown {
  if (depth > 12) return "[depth limit]";
  if (Array.isArray(value)) return value.map((item) => diagnosticDetails(item, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
      /token|api.?key|authorization|secret|password/i.test(key) || ["audio", "inlineData"].includes(key)
        ? "[omitted]" : diagnosticDetails(item, depth + 1)]));
  }
  return value;
}
