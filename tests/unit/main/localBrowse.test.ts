import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { browseDirectory } from '../../../src/main/services/LocalLibraryService';

let root: string;

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'tubedeck-browse-'));
  fs.mkdirSync(path.join(root, 'Salsa', 'Clasicos'), { recursive: true });
  fs.mkdirSync(path.join(root, '.oculta'));
  fs.writeFileSync(path.join(root, 'Joe Arroyo - Rebelion.mp3'), '');
  fs.writeFileSync(path.join(root, 'notas.txt'), '');
  fs.writeFileSync(path.join(root, 'Salsa', 'Vivir Mi Vida.mp4'), '');
  fs.writeFileSync(path.join(root, 'Salsa', 'Clasicos', 'Idilio.flac'), '');
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('browseDirectory', () => {
  it('lists visible sub-folders and only playable files of the folder', async () => {
    const listing = await browseDirectory(root);
    expect(listing.folders.map((f) => f.name)).toEqual(['Salsa']);
    expect(listing.tracks.map((t) => t.title)).toEqual(['Rebelion']);
    expect(listing.tracks[0].channel).toBe('Joe Arroyo');
    expect(listing.parent).toBe(path.dirname(root));
  });

  it('includes sub-folder media when recursive', async () => {
    const listing = await browseDirectory(root, true);
    expect(listing.tracks.map((t) => t.title).sort()).toEqual(['Idilio', 'Rebelion', 'Vivir Mi Vida']);
    expect(listing.truncated).toBe(false);
  });

  it('rejects a file path', async () => {
    await expect(browseDirectory(path.join(root, 'notas.txt'))).rejects.toThrow('no es una carpeta');
  });
});
