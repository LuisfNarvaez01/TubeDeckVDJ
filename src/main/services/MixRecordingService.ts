import fs from 'fs';
import path from 'path';

export type MixRecordingKind = 'audio' | 'video';

interface ActiveRecording {
  filePath: string;
  stream: fs.WriteStream;
  bytes: number;
}

function stamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

/**
 * Writes the DJ's mix to disk as it is being recorded (chunks streamed from the
 * renderer's MediaRecorder), so a crash mid-set still leaves a playable file.
 */
export class MixRecordingService {
  private readonly active = new Map<string, ActiveRecording>();
  private counter = 0;

  constructor(private readonly recordingsDir: string) {}

  getDirectory(): string {
    return this.recordingsDir;
  }

  start(kind: MixRecordingKind, now = new Date()): { id: string; filePath: string } {
    fs.mkdirSync(this.recordingsDir, { recursive: true });
    const base = `Mezcla ${stamp(now)}${kind === 'audio' ? ' (audio)' : ''}`;
    let filePath = path.join(this.recordingsDir, `${base}.webm`);
    let fd = -1;
    for (let n = 2; fd < 0; n += 1) {
      try {
        fd = fs.openSync(filePath, 'wx'); // exclusive create: never clobber an earlier mix
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EEXIST' || n > 999) throw err;
        filePath = path.join(this.recordingsDir, `${base} ${n}.webm`);
      }
    }
    this.counter += 1;
    const id = `rec-${Date.now()}-${this.counter}`;
    this.active.set(id, { filePath, stream: fs.createWriteStream('', { fd }), bytes: 0 });
    return { id, filePath };
  }

  append(id: string, chunk: Uint8Array): number {
    const rec = this.active.get(id);
    if (!rec) throw new Error('La grabación ya terminó.');
    rec.stream.write(Buffer.from(chunk));
    rec.bytes += chunk.byteLength;
    return rec.bytes;
  }

  async stop(id: string): Promise<{ filePath: string; bytes: number }> {
    const rec = this.active.get(id);
    if (!rec) throw new Error('La grabación ya terminó.');
    this.active.delete(id);
    await new Promise<void>((resolve, reject) => {
      rec.stream.end((err?: Error | null) => (err ? reject(err) : resolve()));
    });
    if (rec.bytes === 0) {
      fs.rmSync(rec.filePath, { force: true });
      throw new Error('La grabación quedó vacía.');
    }
    return { filePath: rec.filePath, bytes: rec.bytes };
  }

  /** Only files inside the recordings folder may be revealed. */
  isOwnRecording(filePath: string): boolean {
    const rel = path.relative(this.recordingsDir, path.resolve(filePath));
    return Boolean(rel) && !rel.startsWith('..') && !path.isAbsolute(rel);
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.active.keys()].map((id) => this.stop(id).catch(() => undefined)));
  }
}
