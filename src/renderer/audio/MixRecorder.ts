export type MixRecordingKind = 'audio' | 'video';

export interface MixRecorderSink {
  start: (kind: MixRecordingKind) => Promise<{ id: string; filePath: string }>;
  append: (id: string, chunk: Uint8Array) => Promise<void>;
  stop: (id: string) => Promise<{ filePath: string; bytes: number }>;
}

const VIDEO_TYPES = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
const AUDIO_TYPES = ['audio/webm;codecs=opus', 'audio/webm'];

export function pickRecorderMime(
  kind: MixRecordingKind,
  isSupported: (type: string) => boolean = (t) =>
    typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)
): string | null {
  return (kind === 'video' ? VIDEO_TYPES : AUDIO_TYPES).find(isSupported) ?? null;
}

/**
 * Records the master mix (and optionally the Screen 2 program video) with MediaRecorder,
 * streaming one-second chunks to the main process in order so nothing piles up in RAM.
 */
export class MixRecorder {
  private recorder: MediaRecorder | null = null;
  private id: string | null = null;
  private writeChain: Promise<void> = Promise.resolve();
  private writeError: Error | null = null;
  private startedAtMs = 0;
  kind: MixRecordingKind = 'audio';

  constructor(private readonly sink: MixRecorderSink) {}

  isRecording(): boolean {
    return this.recorder !== null;
  }

  elapsedSec(nowMs = performance.now()): number {
    return this.recorder ? (nowMs - this.startedAtMs) / 1000 : 0;
  }

  async start(kind: MixRecordingKind, audio: MediaStream, video: MediaStream | null): Promise<string> {
    if (this.recorder) throw new Error('Ya hay una grabación en curso.');
    const effectiveKind: MixRecordingKind = kind === 'video' && video ? 'video' : 'audio';
    const mimeType = pickRecorderMime(effectiveKind);
    if (!mimeType) throw new Error('Este equipo no puede grabar en WebM.');

    const tracks = [...audio.getAudioTracks(), ...(effectiveKind === 'video' && video ? video.getVideoTracks() : [])];
    const recorder = new MediaRecorder(new MediaStream(tracks), {
      mimeType,
      audioBitsPerSecond: 256_000,
      videoBitsPerSecond: effectiveKind === 'video' ? 8_000_000 : undefined
    });

    const { id, filePath } = await this.sink.start(effectiveKind);
    this.id = id;
    this.kind = effectiveKind;
    this.writeError = null;
    this.writeChain = Promise.resolve();
    recorder.ondataavailable = (e: BlobEvent) => {
      if (!e.data || e.data.size === 0) return;
      const blob = e.data;
      this.writeChain = this.writeChain.then(async () => {
        if (this.writeError) return;
        try {
          await this.sink.append(id, new Uint8Array(await blob.arrayBuffer()));
        } catch (err) {
          this.writeError = err instanceof Error ? err : new Error(String(err));
        }
      });
    };
    recorder.start(1000);
    this.recorder = recorder;
    this.startedAtMs = performance.now();
    return filePath;
  }

  async stop(): Promise<{ filePath: string; bytes: number }> {
    const recorder = this.recorder;
    const id = this.id;
    if (!recorder || !id) throw new Error('No hay grabación en curso.');
    await new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
      recorder.stop();
    });
    this.recorder = null;
    this.id = null;
    await this.writeChain;
    const result = await this.sink.stop(id);
    if (this.writeError) throw this.writeError;
    return result;
  }
}
