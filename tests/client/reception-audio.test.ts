import { afterEach, expect, it, vi } from "vitest";
import { PcmAudioPlayer } from "../../src/client/voice/audio";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it('notifies the owner when mute interrupts an active stream',async()=>{
  const player=new PcmAudioPlayer();player.setMuted(true);
  const failed=vi.fn();await player.beginStream('reply',vi.fn(),vi.fn(),failed);
  player.setMuted(true);
  expect(failed).toHaveBeenCalledOnce();
});

it("streams chunks in order and finishes only when generation ends and scheduled audio drains", async () => {
  vi.useFakeTimers();
  const sources: Array<{ start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; onended?: (() => void) | null }> = [];
  vi.stubGlobal("AudioContext", class {
    currentTime = 0; state = "running"; destination = {};
    resume = async () => undefined; close = async () => undefined;
    createBuffer = (_channels: number, length: number, rate: number) => ({ duration: length / rate, copyToChannel: vi.fn() });
    createBufferSource() { const source = { start: vi.fn(), stop: vi.fn(), connect: vi.fn(), disconnect: vi.fn(), onended: undefined as (() => void) | null | undefined }; sources.push(source); return source; }
  });
  const player = new PcmAudioPlayer();
  const started = vi.fn(), finished = vi.fn();
  await player.beginStream("one", started, finished, vi.fn());
  await player.enqueueStream("one", { data: "AAAAAA==", mimeType: "audio/pcm;rate=24000" });
  await player.enqueueStream("one", { data: "AAAAAA==", mimeType: "audio/pcm;rate=24000" });
  expect(sources[1].start.mock.calls[0][0]).toBeGreaterThan(sources[0].start.mock.calls[0][0]);
  await vi.runOnlyPendingTimersAsync();
  expect(started).toHaveBeenCalledOnce();
  sources[0].onended?.(); sources[1].onended?.();
  expect(finished).not.toHaveBeenCalled();
  player.endStream("one");
  expect(finished).toHaveBeenCalledOnce();
});

it("muted streaming never reports audible exposure", async () => {
  const player = new PcmAudioPlayer();
  player.setMuted(true);
  const started = vi.fn(), finished = vi.fn();
  await player.beginStream("muted", started, finished, vi.fn());
  await player.enqueueStream("muted", { data: "AAAA", mimeType: "audio/pcm;rate=24000" });
  player.endStream("muted");
  expect(started).not.toHaveBeenCalled();
  expect(finished).toHaveBeenCalledOnce();
});

it("stop cancels every scheduled source and a stale stream cannot finish or enqueue later", async () => {
  const sources: any[] = [];
  vi.stubGlobal("AudioContext", class {
    currentTime = 0; state = "running"; destination = {};
    resume = async () => undefined; close = async () => undefined;
    createBuffer = () => ({ copyToChannel: vi.fn() });
    createBufferSource() { const source = { start: vi.fn(), stop: vi.fn(), connect: vi.fn(), disconnect: vi.fn(), onended: null }; sources.push(source); return source; }
  });
  const player = new PcmAudioPlayer(); const finished = vi.fn();
  await player.beginStream("old", vi.fn(), finished, vi.fn());
  await player.enqueueStream("old", { data: "AAAA", mimeType: "audio/pcm;rate=24000" });
  await player.enqueueStream("old", { data: "AAAA", mimeType: "audio/pcm;rate=24000" });
  player.stop();
  await player.enqueueStream("old", { data: "AAAA", mimeType: "audio/pcm;rate=24000" });
  player.endStream("old");
  expect(sources).toHaveLength(2);
  expect(sources.every((source) => source.stop.mock.calls.length === 1 && source.onended === null)).toBe(true);
  expect(finished).not.toHaveBeenCalled();
});
