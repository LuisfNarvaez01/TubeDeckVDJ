import fs from 'fs/promises';
import type { HistoryEntry, MixSession } from '../../shared/types';

export type ExportFormat = 'json' | 'csv' | 'm3u';

function escapeCsvCell(value: string | number | null | undefined): string {
  const str = value === null || value === undefined ? '' : String(value);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export class SessionExporter {
  formatSession(
    session: MixSession,
    entries: HistoryEntry[],
    format: ExportFormat
  ): string {
    if (format === 'json') {
      return JSON.stringify({ session, entries }, null, 2);
    }

    if (format === 'csv') {
      const header = [
        'played_at_iso',
        'deck',
        'video_id',
        'title',
        'channel',
        'duration_sec',
        'bpm',
        'transition_used',
        'youtube_url'
      ].join(',');

      const lines = entries.map((e) =>
        [
          escapeCsvCell(new Date(e.playedAt).toISOString()),
          escapeCsvCell(e.deck),
          escapeCsvCell(e.videoId),
          escapeCsvCell(e.title),
          escapeCsvCell(e.channel),
          escapeCsvCell(e.durationSec),
          escapeCsvCell(e.bpm),
          escapeCsvCell(e.transitionUsed),
          escapeCsvCell(`https://www.youtube.com/watch?v=${e.videoId}`)
        ].join(',')
      );
      return [header, ...lines].join('\r\n');
    }

    // M3U
    const rows: string[] = [`#EXTM3U`, `#PLAYLIST:${session.title}`];
    for (const entry of entries) {
      const dur = Math.max(0, Math.round(entry.durationSec));
      rows.push(`#EXTINF:${dur},${entry.channel} - ${entry.title}`);
      rows.push(`https://www.youtube.com/watch?v=${entry.videoId}`);
    }
    return rows.join('\n');
  }

  async exportToFile(
    targetPath: string,
    session: MixSession,
    entries: HistoryEntry[],
    format: ExportFormat
  ): Promise<void> {
    const content = this.formatSession(session, entries, format);
    await fs.writeFile(targetPath, content, 'utf8');
  }
}

