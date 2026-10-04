import { describe, expect, it } from "vitest";
import {
  MAX_PROTOTYPE_LOG_ENTRIES,
  PROTOTYPE_LOG_STORAGE_KEY,
  appendPrototypeLog,
  clearPrototypeLog,
  formatPrototypeLog,
  loadPrototypeLog,
  savePrototypeLog,
  type PrototypeLogEntry,
} from "../../src/client/logging/prototypeLog";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); },
  };
}

function entry(id: string, message = `Event ${id}`): PrototypeLogEntry {
  return { id, timestamp: "2026-09-30T09:00:00.000Z", type: "session", message };
}

describe("prototype test log storage", () => {
  it("persists structured diagnostics and exports full details without nested credentials", () => {
    const storage = memoryStorage();
    const details = { args: { doctorIdentifier: "سعود" }, result: { description: "x".repeat(3000), token: "secret" }, apiKey: "secret-key", inlineData: { data: "PCM" } };
    const entries = appendPrototypeLog([], { ...entry("tool"), event: "tool_result", sessionId: "session-one", turnId: 2, durationMs: 7, details });
    savePrototypeLog(entries, storage);
    const loaded = loadPrototypeLog(storage);
    expect(loaded[0]).toMatchObject({ event: "tool_result", sessionId: "session-one", turnId: 2, durationMs: 7, details: { args: { doctorIdentifier: "سعود" }, result: { description: "x".repeat(3000), token: "[omitted]" } } });
    expect(formatPrototypeLog(loaded)).toContain('"durationMs":7');
    expect(formatPrototypeLog(loaded)).toContain("x".repeat(3000));
    expect(JSON.stringify(loaded)).not.toContain("secret");
    expect(JSON.stringify(loaded)).not.toContain("PCM");
  });
  it("persists and reloads ordered entries from this browser's storage", () => {
    const storage = memoryStorage();
    const entries = [entry("one"), entry("two")];

    expect(savePrototypeLog(entries, storage)).toBe(true);
    expect(storage.getItem(PROTOTYPE_LOG_STORAGE_KEY)).toContain('"one"');
    expect(loadPrototypeLog(storage)).toEqual(entries);
  });

  it("keeps only the most recent bounded entries and truncates unusually long messages", () => {
    const entries = Array.from({ length: MAX_PROTOTYPE_LOG_ENTRIES + 3 }, (_, index) => entry(String(index)));
    const bounded = appendPrototypeLog(entries, entry("last", "x".repeat(2_000)));

    expect(bounded).toHaveLength(MAX_PROTOTYPE_LOG_ENTRIES);
    expect(bounded[0]?.id).toBe("4");
    expect(bounded.at(-1)?.id).toBe("last");
    expect(bounded.at(-1)?.message).toHaveLength(1_200);
  });

  it("ignores malformed or invalid saved data without throwing", () => {
    const storage = memoryStorage();
    storage.setItem(PROTOTYPE_LOG_STORAGE_KEY, "not-json");
    expect(loadPrototypeLog(storage)).toEqual([]);

    storage.setItem(PROTOTYPE_LOG_STORAGE_KEY, JSON.stringify([{ id: 3, timestamp: "bad", type: "tool", message: {} }]));
    expect(loadPrototypeLog(storage)).toEqual([]);
  });

  it("clears only its own log key", () => {
    const storage = memoryStorage();
    storage.setItem("another-app-key", "keep");
    savePrototypeLog([entry("one")], storage);

    expect(clearPrototypeLog(storage)).toBe(true);
    expect(loadPrototypeLog(storage)).toEqual([]);
    expect(storage.getItem("another-app-key")).toBe("keep");
  });

  it("formats a readable copy of chronological events", () => {
    expect(formatPrototypeLog([
      { ...entry("one", "Patient (microphone): السلام عليكم"), type: "patient" },
      { ...entry("two", "Tool search_doctors → ok"), type: "tool" },
    ])).toBe("2026-09-30T09:00:00.000Z  Patient (microphone): السلام عليكم\n2026-09-30T09:00:00.000Z  Tool search_doctors → ok");
  });

  it("keeps the live UI usable when browser storage throws", () => {
    const unavailableStorage = {
      get length() { throw new Error("blocked"); },
      clear() { throw new Error("blocked"); },
      getItem() { throw new Error("blocked"); },
      key() { throw new Error("blocked"); },
      removeItem() { throw new Error("blocked"); },
      setItem() { throw new Error("blocked"); },
    } as unknown as Storage;

    expect(loadPrototypeLog(unavailableStorage)).toEqual([]);
    expect(savePrototypeLog([entry("one")], unavailableStorage)).toBe(false);
    expect(clearPrototypeLog(unavailableStorage)).toBe(false);
  });
});
