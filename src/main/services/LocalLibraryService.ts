import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { YouTubeTrack } from '../../shared/types';
import type { DatabaseService } from './DatabaseService';

const VIDEO_EXTS = new Set(['.mp4', '.webm', '.mkv', '.mov', '.m4v']);
const AUDIO_EXTS = new Set(['.mp3', '.wav', '.flac', '.m4a', '.ogg', '.aac']);
const FOLDERS_KEY = 'local_library_folders';
const FILES_KEY = 'local_library_files';

export function getLocalMediaKind(filePath: string): 'video' | 'audio' | null {
  const ext = path.extname(filePath).toLowerCase();
  if (VIDEO_EXTS.has(ext)) return 'video';
  if (AUDIO_EXTS.has(ext)) return 'audio';
  return null;
}

function makeLocalId(resolvedPath: string): string {
  const digest = crypto
    .createHash('sha1')
    .update(resolvedPath.toLowerCase())
    .digest('hex')
    .slice(0, 12);
  return `local_${digest}`;
}

function fileToTrack(filePath: string, mediaKind: 'video' | 'audio'): YouTubeTrack {
  const resolved = path.resolve(filePath);
  const baseName = path.basename(resolved, path.extname(resolved)).replace(/\s*\[[A-Za-z0-9_-]{11}\]$/, '').trim();
  const dashIdx = baseName.indexOf(' - ');
  let channel = path.basename(path.dirname(resolved)) || 'Local';
  let title = baseName || path.basename(resolved);
  if (dashIdx > 1 && dashIdx < baseName.length - 4) {
    channel = baseName.slice(0, dashIdx).trim();
    title = baseName.slice(dashIdx + 3).trim();
  }

  return {
    videoId: makeLocalId(resolved),
    title,
    channel,
    durationSec: 0,
    thumbnailUrl: '',
    isLive: false,
    source: 'local',
    localFilePath: resolved,
    mediaKind
  };
}

function scanDirectory(dirPath: string, depth = 0, out: string[] = []): string[] {
  if (depth > 5 || !fs.existsSync(dirPath)) return out;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return out;
  }

  for (const entry of entries) {
    const full = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      scanDirectory(full, depth + 1, out);
    } else if (entry.isFile() && getLocalMediaKind(full)) {
      out.push(full);
    }
  }
  return out;
}

export class LocalLibraryService {
  private readonly db: DatabaseService;

  constructor(db: DatabaseService) {
    this.db = db;
  }

  private getFolders(): string[] {
    return this.db.getSetting<string[]>(FOLDERS_KEY, []);
  }

  private getStandaloneFiles(): string[] {
    return this.db.getSetting<string[]>(FILES_KEY, []);
  }

  addFolder(dirPath: string): void {
    const resolved = path.resolve(dirPath);
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
      throw new Error(`Invalid local media folder: ${resolved}`);
    }
    const existing = this.getFolders();
    if (!existing.some((f) => f.toLowerCase() === resolved.toLowerCase())) {
      this.db.setSetting(FOLDERS_KEY, [...existing, resolved]);
    }
  }

  removeFolder(dirPath: string): void {
    const target = path.resolve(dirPath).toLowerCase();
    const next = this.getFolders().filter((f) => path.resolve(f).toLowerCase() !== target);
    this.db.setSetting(FOLDERS_KEY, next);
  }

  addFiles(filePaths: string[]): void {
    const existing = this.getStandaloneFiles();
    const seen = new Set(existing.map((p) => path.resolve(p).toLowerCase()));
    const added = [...existing];
    for (const raw of filePaths) {
      const resolved = path.resolve(raw);
      if (fs.existsSync(resolved) && fs.statSync(resolved).isFile() && getLocalMediaKind(resolved)) {
        const key = resolved.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          added.push(resolved);
        }
      }
    }
    this.db.setSetting(FILES_KEY, added);
  }

  removeFile(filePath: string): void {
    const target = path.resolve(filePath).toLowerCase();
    const next = this.getStandaloneFiles().filter((p) => path.resolve(p).toLowerCase() !== target);
    this.db.setSetting(FILES_KEY, next);
  }

  listLibrary(): { folders: string[]; tracks: YouTubeTrack[] } {
    const folders = this.getFolders().filter((f) => fs.existsSync(f));
    const files = this.getStandaloneFiles().filter((f) => fs.existsSync(f));

    const discovered: string[] = [];
    for (const folder of folders) {
      scanDirectory(folder, 0, discovered);
    }
    for (const file of files) {
      if (getLocalMediaKind(file)) {
        discovered.push(file);
      }
    }

    const seenPaths = new Set<string>();
    const tracks: YouTubeTrack[] = [];
    for (const p of discovered) {
      const resolved = path.resolve(p);
      const key = resolved.toLowerCase();
      if (seenPaths.has(key)) continue;
      seenPaths.add(key);
      const kind = getLocalMediaKind(resolved);
      if (kind) {
        tracks.push(fileToTrack(resolved, kind));
      }
    }

    tracks.sort((a, b) => a.title.localeCompare(b.title));
    return { folders, tracks };
  }
}
