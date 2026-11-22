import type { DragEvent } from 'react';
import type { YouTubeTrack } from '../../shared/types';

/** Drag a song from any list and drop it on a deck (load) or on the queue (add). */
export const TRACK_DRAG_MIME = 'application/x-proyecta-track';

export function startTrackDrag(e: DragEvent, track: YouTubeTrack): void {
  e.dataTransfer.setData(TRACK_DRAG_MIME, JSON.stringify(track));
  e.dataTransfer.setData('text/plain', track.title);
  e.dataTransfer.effectAllowed = 'copy';
}

export function isTrackDrag(e: DragEvent): boolean {
  return Array.from(e.dataTransfer.types).includes(TRACK_DRAG_MIME);
}

export function readDraggedTrack(e: DragEvent): YouTubeTrack | null {
  try {
    const raw = e.dataTransfer.getData(TRACK_DRAG_MIME);
    if (!raw) return null;
    const t = JSON.parse(raw) as YouTubeTrack;
    return t && typeof t.videoId === 'string' && typeof t.title === 'string' ? t : null;
  } catch {
    return null;
  }
}

/** Props that make a song row draggable. */
export function trackDragProps(track: YouTubeTrack): {
  draggable: true;
  onDragStart: (e: DragEvent) => void;
} {
  return { draggable: true, onDragStart: (e) => startTrackDrag(e, track) };
}
