class PCM16CaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.targetSampleRate = options.processorOptions?.targetSampleRate ?? 16000;
    this.frameSize = options.processorOptions?.frameSize ?? 1600;
    this.step = sampleRate / this.targetSampleRate;
    this.position = 0;
    this.remainder = new Float32Array();
    this.pending = new Float32Array();
  }

  process(inputs, outputs) {
    const input = inputs[0]?.[0];
    const output = outputs[0]?.[0];
    if (output) output.fill(0);
    if (!input?.length) return true;

    const merged = new Float32Array(this.remainder.length + input.length);
    merged.set(this.remainder, 0);
    merged.set(input, this.remainder.length);
    const resampled = [];
    while (this.position + 1 < merged.length) {
      const index = Math.floor(this.position);
      const fraction = this.position - index;
      resampled.push(merged[index] * (1 - fraction) + merged[index + 1] * fraction);
      this.position += this.step;
    }
    const consumed = Math.floor(this.position);
    this.position -= consumed;
    this.remainder = merged.slice(consumed);

    if (resampled.length) {
      const next = new Float32Array(this.pending.length + resampled.length);
      next.set(this.pending, 0);
      next.set(resampled, this.pending.length);
      this.pending = next;
    }
    while (this.pending.length >= this.frameSize) {
      const frame = this.pending.slice(0, this.frameSize);
      this.pending = this.pending.slice(this.frameSize);
      this.port.postMessage(frame, [frame.buffer]);
    }
    return true;
  }
}

registerProcessor("pcm16-capture", PCM16CaptureProcessor);
