import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, describe, expect, it } from 'vitest';
import { MixRecordingService } from '../../../src/main/services/MixRecordingService';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tubedeck-rec-'));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('MixRecordingService', () => {
  it('streams chunks into a dated file in the recordings folder', async () => {
    const svc = new MixRecordingService(path.join(dir, 'TubeDeck Grabaciones'));
    const { id, filePath } = svc.start('audio', new Date(2026, 10, 20, 22, 5, 9));
    expect(path.basename(filePath)).toBe('Mezcla 2026-11-20 22-05-09 (audio).webm');
    svc.append(id, new Uint8Array([1, 2, 3]));
    svc.append(id, new Uint8Array([4]));
    const res = await svc.stop(id);
    expect(res.bytes).toBe(4);
    expect(fs.readFileSync(filePath)).toEqual(Buffer.from([1, 2, 3, 4]));
    expect(svc.isOwnRecording(filePath)).toBe(true);
    expect(svc.isOwnRecording(path.join(dir, 'otro.webm'))).toBe(false);
  });

  it('never overwrites and drops empty recordings', async () => {
    const svc = new MixRecordingService(path.join(dir, 'b'));
    const when = new Date(2026, 0, 1, 1, 1, 1);
    const a = svc.start('video', when);
    const b = svc.start('video', when);
    expect(a.filePath).not.toBe(b.filePath);
    svc.append(a.id, new Uint8Array([9]));
    await svc.stop(a.id);
    await expect(svc.stop(b.id)).rejects.toThrow('vacía');
    expect(fs.existsSync(b.filePath)).toBe(false);
  });
});

