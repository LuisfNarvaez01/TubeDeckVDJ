import { execFile } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { LocalDirListing, LocalPlace, LocalPlaceKind, YouTubeTrack } from '../../shared/types';
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

export function fileToTrack(filePath: string, mediaKind: 'video' | 'audio'): YouTubeTrack {
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

const HIDDEN_DIRS = new Set([
  '$recycle.bin',
  'system volume information',
  'node_modules',
  '$windows.~bt',
  '$windows.~ws'
]);
const RECURSIVE_FILE_LIMIT = 4000;
const RECURSIVE_DEPTH_LIMIT = 6;

function isHiddenEntry(name: string): boolean {
  return name.startsWith('.') || name.startsWith('~$') || HIDDEN_DIRS.has(name.toLowerCase());
}

function byName(a: string, b: string): number {
  return a.localeCompare(b, 'es', { numeric: true, sensitivity: 'base' });
}

interface WinDrive {
  DeviceID: string;
  DriveType: number;
  VolumeName?: string | null;
}

/** Windows drive types: 2 removable (USB/SD), 3 local disk, 4 network, 5 CD/DVD. */
function readWindowsDrives(): Promise<WinDrive[] | null> {
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        'Get-CimInstance Win32_LogicalDisk | Select-Object DeviceID,DriveType,VolumeName | ConvertTo-Json -Compress'
      ],
      { timeout: 5000, windowsHide: true },
      (err, stdout) => {
        if (err || !stdout.trim()) return resolve(null);
        try {
          const parsed = JSON.parse(stdout) as WinDrive | WinDrive[];
          resolve(Array.isArray(parsed) ? parsed : [parsed]);
        } catch {
          resolve(null);
        }
      }
    );
  });
}

function driveRoot(deviceId: string): string {
  return `${deviceId}${path.sep}`;
}

/** Disks, USB sticks/SD cards, network and optical drives the DJ can browse. */
export async function listDrivePlaces(platform = process.platform): Promise<LocalPlace[]> {
  if (platform !== 'win32') {
    const roots: LocalPlace[] = [{ kind: 'drive', label: 'Sistema', path: '/' }];
    for (const base of ['/media', '/Volumes', '/mnt']) {
      try {
        for (const name of await fs.promises.readdir(base)) {
          roots.push({ kind: 'removable', label: name, path: path.join(base, name) });
        }
      } catch {
        // not present on this OS
      }
    }
    return roots;
  }

  const typed = await readWindowsDrives();
  if (typed) {
    return typed
      .filter((d) => d.DriveType !== 5 || fs.existsSync(driveRoot(d.DeviceID)))
      .map((d): LocalPlace => {
        const kind: LocalPlaceKind =
          d.DriveType === 2
            ? 'removable'
            : d.DriveType === 4
              ? 'network'
              : d.DriveType === 5
                ? 'optical'
                : 'drive';
        const volume = d.VolumeName?.trim();
        const fallback = kind === 'removable' ? 'USB' : kind === 'network' ? 'Red' : 'Disco';
        return { kind, label: `${volume || fallback} (${d.DeviceID})`, path: driveRoot(d.DeviceID) };
      });
  }

  const letters: LocalPlace[] = [];
  for (let code = 67; code <= 90; code += 1) {
    const id = `${String.fromCharCode(code)}:`;
    if (fs.existsSync(driveRoot(id))) letters.push({ kind: 'drive', label: `Disco (${id})`, path: driveRoot(id) });
  }
  return letters;
}

/** Lists one folder: its sub-folders and the playable media inside (optionally all sub-folders too). */
export async function browseDirectory(dirPath: string, recursive = false): Promise<LocalDirListing> {
  const resolved = path.resolve(dirPath);
  const stat = await fs.promises.stat(resolved);
  if (!stat.isDirectory()) throw new Error('Esa ruta no es una carpeta.');

  const entries = await fs.promises.readdir(resolved, { withFileTypes: true });
  const folders = entries
    .filter((e) => e.isDirectory() && !isHiddenEntry(e.name))
    .map((e) => ({ name: e.name, path: path.join(resolved, e.name) }))
    .sort((a, b) => byName(a.name, b.name));

  const files: string[] = [];
  let truncated = false;
  const walk = async (dir: string, depth: number, preRead: fs.Dirent[] | null): Promise<void> => {
    let items = preRead;
    if (!items) {
      try {
        items = await fs.promises.readdir(dir, { withFileTypes: true });
      } catch {
        return; // permission denied, drive removed...
      }
    }
    for (const entry of items) {
      if (truncated) return;
      if (isHiddenEntry(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isFile() && getLocalMediaKind(full)) {
        if (files.length >= RECURSIVE_FILE_LIMIT) {
          truncated = true;
          return;
        }
        files.push(full);
      } else if (recursive && entry.isDirectory() && depth < RECURSIVE_DEPTH_LIMIT) {
        await walk(full, depth + 1, null);
      }
    }
  };
  await walk(resolved, 0, entries);

  const tracks = files
    .map((f) => fileToTrack(f, getLocalMediaKind(f) as 'video' | 'audio'))
    .sort((a, b) => byName(a.localFilePath ?? a.title, b.localFilePath ?? b.title));

  const parent = path.dirname(resolved);
  return {
    path: resolved,
    parent: parent !== resolved ? parent : null,
    folders,
    tracks,
    recursive,
    truncated
  };
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

