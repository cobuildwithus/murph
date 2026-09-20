export type VoiceLevels = { inputLevel: number; outputLevel: number };
type Meter = { source: MediaStreamAudioSourceNode; analyser: AnalyserNode; samples: Float32Array<ArrayBuffer>; level: number };

/** Measures local amplitude only. Never connects the microphone to speakers. */
export class LiveVoiceAudio {
  private context?: AudioContext;
  private input?: Meter;
  private output?: Meter;
  private timer?: ReturnType<typeof setInterval>;

  constructor(private readonly update: (levels: VoiceLevels) => void) {
    try {
      this.context = new AudioContext();
      void this.context.resume().catch(() => {});
    } catch { /* Optional visual feedback must not prevent a call. */ }
  }

  attach(kind: "input" | "output", stream: MediaStream) {
    const context = this.context;
    if (!context || context.state === "closed") return;
    try {
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      this[kind]?.source.disconnect();
      this[kind]?.analyser.disconnect();
      this[kind] = { source, analyser, samples: new Float32Array(analyser.fftSize), level: 0 };
    } catch { /* Audio playback remains available without visual metering. */ }
  }

  setActive(active: boolean) {
    clearInterval(this.timer);
    this.timer = undefined;
    if (this.input) this.input.level = 0;
    if (this.output) this.output.level = 0;
    if (!active || !this.context) return;
    void this.context.resume().catch(() => {});
    this.timer = setInterval(() => this.update({ inputLevel: readLevel(this.input), outputLevel: readLevel(this.output) }), 50);
  }

  dispose() {
    this.setActive(false);
    for (const meter of [this.input, this.output]) {
      meter?.source.disconnect();
      meter?.analyser.disconnect();
    }
    this.input = this.output = undefined;
    if (this.context && this.context.state !== "closed") void this.context.close().catch(() => {});
    this.context = undefined;
  }
}

function readLevel(meter?: Meter) {
  if (!meter) return 0;
  meter.analyser.getFloatTimeDomainData(meter.samples);
  let sum = 0;
  for (const sample of meter.samples) sum += sample * sample;
  // Reject quiet room noise, then normalize speech to the visual's 0–1 range.
  const target = Math.min(1, Math.max(0, (Math.sqrt(sum / meter.samples.length) - 0.008) * 8));
  meter.level += (target - meter.level) * (target > meter.level ? 0.65 : 0.25);
  if (meter.level < 0.005) meter.level = 0;
  return meter.level;
}
