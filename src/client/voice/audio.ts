import type { ApprovedOutput, OutputAudioChunk } from "../agent/guardrails";

export function encodePcm16(samples: Float32Array): string {
  if (samples.length === 0) return "";
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < samples.length; index += 1) {
    const clipped = Math.max(-1, Math.min(1, samples[index]));
    const pcm = clipped < 0 ? Math.round(clipped * 0x8000) : Math.round(clipped * 0x7fff);
    view.setInt16(index * 2, pcm, true);
  }
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function decodePcm16(base64: string): Float32Array {
  if (!base64) return new Float32Array();
  const binary = atob(base64);
  const usableBytes = binary.length - (binary.length % 2);
  const bytes = new Uint8Array(usableBytes);
  for (let index = 0; index < usableBytes; index += 1) bytes[index] = binary.charCodeAt(index);
  const view = new DataView(bytes.buffer);
  const samples = new Float32Array(usableBytes / 2);
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = view.getInt16(index * 2, true) / 0x8000;
  }
  return samples;
}

export type CaptureOptions = {
  onAudio: (base64Pcm16: string) => void;
  onVoiceStart: () => void;
  onVoiceEnd: () => void;
  onError: (error: Error) => void;
};

function cancelledCaptureError() {
  const error = new Error("Microphone startup was cancelled.");
  error.name = "AbortError";
  return error;
}

/** Captures mono microphone audio, downsamples it in AudioWorklet, and streams 16-kHz PCM16 chunks. */
export class MicrophoneCapture {
  private context?: AudioContext;
  private stream?: MediaStream;
  private source?: MediaStreamAudioSourceNode;
  private worklet?: AudioWorkletNode;
  private speaking = false;
  private lastVoiceAt = 0;
  private generation = 0;
  private startPromise?: Promise<void>;

  constructor(private readonly options: CaptureOptions) {}

  start(): Promise<void> {
    if (this.stream) return Promise.resolve();
    if (this.startPromise) return this.startPromise;
    const attempt = this.startCapture();
    this.startPromise = attempt;
    void attempt.then(
      () => { if (this.startPromise === attempt) this.startPromise = undefined; },
      () => { if (this.startPromise === attempt) this.startPromise = undefined; },
    );
    return attempt;
  }

  private async startCapture(): Promise<void> {
    const generation = ++this.generation;
    let acquiredStream: MediaStream | undefined;
    let context: AudioContext | undefined;
    let source: MediaStreamAudioSourceNode | undefined;
    let worklet: AudioWorkletNode | undefined;
    try {
      acquiredStream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
      if (generation !== this.generation) throw cancelledCaptureError();
      context = new AudioContext();
      await context.audioWorklet.addModule("/pcm-capture-processor.js");
      if (generation !== this.generation) throw cancelledCaptureError();
      source = context.createMediaStreamSource(acquiredStream);
      worklet = new AudioWorkletNode(context, "pcm16-capture", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        channelCount: 1,
        processorOptions: { targetSampleRate: 16_000, frameSize: 1_600 },
      });
      worklet.port.onmessage = (event: MessageEvent<Float32Array>) => this.onSamples(event.data);
      source.connect(worklet);
      worklet.connect(context.destination);
      this.stream = acquiredStream;
      this.context = context;
      this.source = source;
      this.worklet = worklet;
      await context.resume();
      if (generation !== this.generation) throw cancelledCaptureError();
    } catch (error) {
      const isCurrentAttempt = generation === this.generation;
      if (isCurrentAttempt) {
        await this.stop();
        if (!(error instanceof Error && error.name === "AbortError")) {
          this.options.onError(error instanceof Error ? error : new Error("Microphone could not start."));
        }
      } else {
        worklet?.port.close();
        worklet?.disconnect();
        source?.disconnect();
        for (const track of acquiredStream?.getTracks() ?? []) track.stop();
        if (context && context.state !== "closed") await context.close();
      }
      throw error;
    }
  }

  async stop(): Promise<void> {
    this.generation += 1;
    this.worklet?.port.close();
    this.worklet?.disconnect();
    this.source?.disconnect();
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = undefined;
    this.worklet = undefined;
    this.source = undefined;
    this.speaking = false;
    const context = this.context;
    this.context = undefined;
    if (context && context.state !== "closed") await context.close();
  }

  private onSamples(samples: Float32Array): void {
    if (!(samples instanceof Float32Array) || samples.length === 0) return;
    let energy = 0;
    for (const sample of samples) energy += sample * sample;
    const rms = Math.sqrt(energy / samples.length);
    const now = performance.now();
    if (rms >= 0.018) {
      this.lastVoiceAt = now;
      if (!this.speaking) {
        this.speaking = true;
        this.options.onVoiceStart();
      }
    } else if (this.speaking && now - this.lastVoiceAt >= 850) {
      this.speaking = false;
      this.options.onVoiceEnd();
    }

    const encoded = encodePcm16(samples);
    if (encoded) this.options.onAudio(encoded);
  }
}

/** Plays approved 24-kHz mono PCM only; muting keeps transcript behavior but skips all audio. */
export class PcmAudioPlayer {
  private context?: AudioContext;
  private source?: AudioBufferSourceNode;
  private generation = 0;
  private muted = false;
  private stream?: { id: string; generation: number; ended: boolean; started: boolean; pending: number; nextAt: number; queued: number; finished: () => void; onStarted: () => void; error: (error: Error) => void };
  private readonly streamSources = new Set<AudioBufferSourceNode>();
  private readonly startTimers = new Set<ReturnType<typeof setTimeout>>();

  async beginStream(outputId: string, onStarted: () => void, onFinished: () => void, onError: (error: Error) => void): Promise<void> {
    this.stop();
    const stream = { id: outputId, generation: this.generation, ended: false, started: false, pending: 0, nextAt: 0, queued: 0, finished: onFinished, onStarted, error: onError };
    this.stream = stream;
    if (this.muted) return;
    try { await this.prepare(); } catch (error) {
      if (this.stream !== stream) return;
      this.stream = undefined;
      onError(error instanceof Error ? error : new Error("Audio playback is unavailable."));
    }
  }

  async enqueueStream(outputId: string, chunk: OutputAudioChunk): Promise<void> {
    const stream = this.stream;
    if (!stream || stream.id !== outputId || stream.ended) return;
    if (this.muted) { stream.queued += 1; return; }
    stream.pending += 1;
    try {
      if (readSampleRate([chunk]) !== 24_000) throw new Error("Unexpected Gemini audio sample rate.");
      const samples = decodePcm16(chunk.data);
      if (!samples.length) throw new Error("Gemini returned no playable audio.");
      await this.prepare();
      if (this.stream !== stream || stream.generation !== this.generation) return;
      const context = this.context!;
      const buffer = context.createBuffer(1, samples.length, 24_000);
      buffer.copyToChannel(new Float32Array(samples), 0);
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      const startsAt = Math.max(context.currentTime, stream.nextAt);
      stream.nextAt = startsAt + samples.length / 24_000;
      stream.queued += 1;
      this.streamSources.add(source);
      const reportStart = () => {
        if (this.stream !== stream || stream.generation !== this.generation || stream.started || this.muted) return;
        // A timer can run early while an AudioContext is suspended. Exposure
        // belongs to actual audio time, never merely to buffer scheduling.
        const remaining = startsAt - context.currentTime;
        if (remaining > 0 && context.state !== "closed") {
          const timer = setTimeout(() => { this.startTimers.delete(timer); reportStart(); }, Math.max(1, remaining * 1000));
          this.startTimers.add(timer);
          return;
        }
        if (context.state !== "running") return;
        stream.started = true;
        stream.onStarted();
      };
      source.onended = () => {
        this.streamSources.delete(source);
        source.disconnect();
        if (this.stream !== stream) return;
        stream.pending -= 1;
        this.finishStream(stream);
      };
      source.start(startsAt);
      reportStart();
    } catch (error) {
      if (this.stream !== stream) return;
      this.stop();
      stream.error(error instanceof Error ? error : new Error("Generated audio could not be played."));
    }
  }

  endStream(outputId: string): void {
    const stream = this.stream;
    if (!stream || stream.id !== outputId) return;
    stream.ended = true;
    this.finishStream(stream);
  }

  private finishStream(stream: NonNullable<PcmAudioPlayer["stream"]>): void {
    if (this.stream !== stream || !stream.ended || stream.pending !== 0) return;
    this.stream = undefined;
    if (!this.muted && stream.queued === 0) { stream.error(new Error("Gemini returned no playable audio.")); return; }
    stream.finished();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (muted) {
      const interrupted = this.stream;
      this.stop();
      interrupted?.error(new Error("Audio playback was muted before the reply finished."));
    }
  }

  async prepare(): Promise<void> {
    this.context ??= new AudioContext();
    await this.context.resume();
  }

  async play(output: ApprovedOutput, onComplete: () => void, onError?: (error: Error) => void): Promise<void> {
    this.stop();
    const generation = this.generation;
    if (this.muted) {
      onComplete();
      return;
    }
    try {
      const sampleRate = readSampleRate(output.audio);
      if (sampleRate !== 24_000) throw new Error("Unexpected Gemini audio sample rate.");
      const chunks = output.audio.map((chunk) => decodePcm16(chunk.data));
      const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
      if (length === 0) throw new Error("Gemini returned no playable audio.");
      const samples = new Float32Array(length);
      let offset = 0;
      for (const chunk of chunks) {
        samples.set(chunk, offset);
        offset += chunk.length;
      }
      this.context ??= new AudioContext();
      await this.context.resume();
      if (generation !== this.generation) return;
      const buffer = this.context.createBuffer(1, samples.length, sampleRate);
      buffer.copyToChannel(samples, 0);
      const source = this.context.createBufferSource();
      this.source = source;
      source.buffer = buffer;
      source.connect(this.context.destination);
      source.onended = () => {
        if (generation !== this.generation) return;
        this.source = undefined;
        onComplete();
      };
      source.start();
    } catch (error) {
      if (generation !== this.generation) return;
      onError?.(error instanceof Error ? error : new Error("Generated audio could not be played."));
    }
  }

  stop(): void {
    this.generation += 1;
    this.stream = undefined;
    for (const timer of this.startTimers) clearTimeout(timer);
    this.startTimers.clear();
    for (const scheduled of this.streamSources) {
      scheduled.onended = null;
      try { scheduled.stop(); scheduled.disconnect(); } catch { /* best-effort cancellation */ }
    }
    this.streamSources.clear();
    const source = this.source;
    this.source = undefined;
    if (!source) return;
    source.onended = null;
    try {
      source.stop();
      source.disconnect();
    } catch {
      // The source may already have ended; stopping it is best-effort cleanup.
    }
  }

  async close(): Promise<void> {
    this.stop();
    const context = this.context;
    this.context = undefined;
    if (context && context.state !== "closed") await context.close();
  }
}

function readSampleRate(chunks: OutputAudioChunk[]): number {
  const rate = chunks[0]?.mimeType.match(/rate=(\d+)/i)?.[1];
  if (!rate || chunks.some((chunk) => chunk.mimeType !== chunks[0]?.mimeType)) return -1;
  return Number(rate);
}
