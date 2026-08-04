export interface RecordedVoice {
  blob: Blob;
  mimeType: string;
  durationMs: number;
}

export interface StartVoiceRecordingOptions {
  preferredMimeTypes: string[];
  maxDurationSeconds: number;
  onAutoStop?: (recording: RecordedVoice) => void;
  onError?: (error: Error) => void;
}

const FALLBACK_AUDIO_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/ogg;codecs=opus",
  "audio/mp4",
  "audio/webm",
];

export class MediaRecorderAdapter {
  private recorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private chunks: Blob[] = [];
  private startedAt = 0;
  private maximumDurationTimer: number | null = null;
  private cancelled = false;
  private automaticStop = false;
  private manualStop = false;
  private stopPromise: Promise<RecordedVoice | null> | null = null;
  private resolveStop: ((value: RecordedVoice | null) => void) | null = null;
  private onAutoStop: ((recording: RecordedVoice) => void) | null = null;
  private onError: ((error: Error) => void) | null = null;
  private disposed = false;
  private startGeneration = 0;

  get isRecording(): boolean {
    return this.recorder?.state === "recording";
  }

  async start(options: StartVoiceRecordingOptions): Promise<string> {
    if (this.disposed) throw new Error("Запись уже отменена");
    if (this.recorder) throw new Error("Запись уже запущена");
    if (!navigator.mediaDevices?.getUserMedia || !globalThis.MediaRecorder) {
      throw new Error("Браузер не поддерживает запись голосовых сообщений");
    }

    const generation = ++this.startGeneration;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
      },
      video: false,
    });
    if (this.disposed || generation !== this.startGeneration) {
      stream.getTracks().forEach((track) => track.stop());
      throw new Error("Запись отменена");
    }
    this.stream = stream;
    this.chunks = [];
    this.cancelled = false;
    this.automaticStop = false;
    this.manualStop = false;
    this.onAutoStop = options.onAutoStop ?? null;
    this.onError = options.onError ?? null;

    try {
      const requestedMimeType = selectSupportedVoiceMimeType(
        options.preferredMimeTypes,
      );
      const recorder = requestedMimeType
        ? new MediaRecorder(stream, { mimeType: requestedMimeType })
        : new MediaRecorder(stream);
      this.recorder = recorder;
      this.stopPromise = new Promise<RecordedVoice | null>((resolve) => {
        this.resolveStop = resolve;
      });
      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) this.chunks.push(event.data);
      });
      recorder.addEventListener("error", () => {
        this.finishWithError();
      });
      recorder.addEventListener("stop", () => this.finishRecording());
      this.startedAt = performance.now();
      recorder.start(1_000);

      const durationMs = Math.max(
        250,
        Math.max(1, options.maxDurationSeconds) * 1_000 - 500,
      );
      this.maximumDurationTimer = window.setTimeout(() => {
        if (!this.recorder || this.recorder.state === "inactive") return;
        this.automaticStop = true;
        this.recorder.stop();
      }, durationMs);
      return recorder.mimeType || requestedMimeType;
    } catch (error) {
      this.releaseStream();
      this.resetRecorderState();
      throw error;
    }
  }

  async stop(): Promise<RecordedVoice> {
    const recorder = this.recorder;
    const completion = this.stopPromise;
    if (!recorder || !completion || this.cancelled) {
      throw new Error("Запись голосового не запущена");
    }
    this.clearMaximumDurationTimer();
    this.manualStop = true;
    if (recorder.state !== "inactive") recorder.stop();
    const result = await completion;
    if (!result) throw new Error("Запись голосового отменена");
    return result;
  }

  cancel(): void {
    this.startGeneration += 1;
    this.cancelled = true;
    this.automaticStop = false;
    this.onAutoStop = null;
    this.clearMaximumDurationTimer();
    if (this.recorder && this.recorder.state !== "inactive") {
      this.recorder.stop();
      return;
    }
    this.resolveStop?.(null);
    this.releaseStream();
    this.resetRecorderState();
  }

  dispose(): void {
    this.disposed = true;
    this.cancel();
  }

  private finishRecording(): void {
    this.clearMaximumDurationTimer();
    const recorder = this.recorder;
    const durationMs = Math.max(1, Math.round(performance.now() - this.startedAt));
    const mimeType = recorder?.mimeType || this.chunks[0]?.type || "audio/webm";
    const recording = this.cancelled
      ? null
      : {
          blob: new Blob(this.chunks, { type: mimeType }),
          mimeType,
          durationMs,
        };
    const autoStop = this.automaticStop;
    const manualStop = this.manualStop;
    const onAutoStop = this.onAutoStop;
    this.resolveStop?.(recording);
    this.releaseStream();
    this.resetRecorderState();
    if (recording && (autoStop || !manualStop)) onAutoStop?.(recording);
  }

  private finishWithError(): void {
    this.clearMaximumDurationTimer();
    const onError = this.onError;
    this.resolveStop?.(null);
    this.releaseStream();
    this.resetRecorderState();
    onError?.(new Error("Браузер прервал запись голосового"));
  }

  private clearMaximumDurationTimer(): void {
    if (this.maximumDurationTimer !== null) {
      window.clearTimeout(this.maximumDurationTimer);
      this.maximumDurationTimer = null;
    }
  }

  private releaseStream(): void {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
  }

  private resetRecorderState(): void {
    this.recorder = null;
    this.chunks = [];
    this.startedAt = 0;
    this.stopPromise = null;
    this.resolveStop = null;
    this.onAutoStop = null;
    this.onError = null;
    this.cancelled = false;
    this.automaticStop = false;
    this.manualStop = false;
  }
}

export function selectSupportedVoiceMimeType(
  preferredMimeTypes: string[],
): string {
  if (!globalThis.MediaRecorder?.isTypeSupported) return "";
  const candidates = Array.from(
    new Set([...preferredMimeTypes, ...FALLBACK_AUDIO_MIME_TYPES]),
  );
  return (
    candidates.find((mimeType) => MediaRecorder.isTypeSupported(mimeType)) ?? ""
  );
}
