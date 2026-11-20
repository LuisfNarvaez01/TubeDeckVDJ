import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { DatabaseService } from '../../../src/main/services/DatabaseService';
import { LocalLibraryService } from '../../../src/main/services/LocalLibraryService';

describe('LocalLibraryService', () => {
  let db: DatabaseService;
  let service: LocalLibraryService;
  let tmpDir: string;

  beforeEach(async () => {
    db = new DatabaseService(':memory:');
    await db.init();
    service = new LocalLibraryService(db);
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tubedeck-local-lib-'));
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('scans folders recursively and manages standalone local video and audio files', () => {
    const subDir = path.join(tmpDir, 'Karaoke Hits');
    fs.mkdirSync(subDir, { recursive: true });
    const mp4Path = path.join(subDir, 'Marc Anthony - Vivir Mi Vida [vid12345678].mp4');
    const mp3Path = path.join(tmpDir, 'Daft Punk - One More Time.mp3');
    const txtPath = path.join(tmpDir, 'readme.txt');

    fs.writeFileSync(mp4Path, 'video');
    fs.writeFileSync(mp3Path, 'audio');
    fs.writeFileSync(txtPath, 'ignored');

    service.addFolder(subDir);
    service.addFiles([mp3Path, txtPath]);

    const lib = service.listLibrary();
    expect(lib.folders).toEqual([subDir]);
    expect(lib.tracks).toHaveLength(2);

    const videoTrack = lib.tracks.find((t) => t.mediaKind === 'video');
    const audioTrack = lib.tracks.find((t) => t.mediaKind === 'audio');
    expect(videoTrack).toMatchObject({
      title: 'Vivir Mi Vida',
      channel: 'Marc Anthony',
      source: 'local',
      localFilePath: mp4Path,
      mediaKind: 'video'
    });
    expect(audioTrack).toMatchObject({
      title: 'One More Time',
      channel: 'Daft Punk',
      source: 'local',
      localFilePath: mp3Path,
      mediaKind: 'audio'
    });

    service.removeFolder(subDir);
    expect(service.listLibrary().tracks).toHaveLength(1);
  });
});
