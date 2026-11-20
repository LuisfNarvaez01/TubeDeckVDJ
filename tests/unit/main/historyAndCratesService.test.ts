import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseService } from '../../../src/main/services/DatabaseService';
import { HistoryAndCratesService } from '../../../src/main/services/HistoryAndCratesService';
import type { YouTubeTrack } from '../../../src/shared/types';

describe('HistoryAndCratesService', () => {
  let db: DatabaseService;
  let service: HistoryAndCratesService;

  beforeEach(async () => {
    db = new DatabaseService(':memory:');
    await db.init();
    service = new HistoryAndCratesService(db);
  });

  afterEach(() => {
    db.close();
  });

  it('creates sessions, logs tracks chronologically, manages crates without duplicates, and persists MIDI mappings', () => {
    const session = service.startSession('Fiesta Viernes');
    expect(session.title).toBe('Fiesta Viernes');
    expect(session.endedAt).toBeNull();

    service.logTrackPlay({
      sessionId: session.id,
      deck: 'A',
      videoId: 'vid00000001',
      title: 'Track 1',
      channel: 'Chan 1',
      durationSec: 200,
      playedAt: 1000,
      bpm: 124,
      transitionUsed: 'dissolve'
    });

    service.logTrackPlay({
      sessionId: session.id,
      deck: 'B',
      videoId: 'vid00000002',
      title: 'Track 2',
      channel: 'Chan 2',
      durationSec: 185,
      playedAt: 2000,
      bpm: 126,
      transitionUsed: 'wipe-h'
    });

    const entries = service.getSessionHistory(session.id);
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.videoId)).toEqual(['vid00000001', 'vid00000002']);

    service.endSession(session.id);
    const sessions = service.listSessions();
    expect(sessions[0].endedAt).not.toBeNull();

    // Crates
    const crate = service.createCrate('Reggaeton Clásico', '#FF8A00');
    const track: YouTubeTrack = {
      videoId: 'vid00000001',
      title: 'Track 1',
      channel: 'Chan 1',
      durationSec: 200,
      thumbnailUrl: 'https://i.ytimg.com/vi/vid00000001/hqdefault.jpg',
      isLive: false
    };
    service.addTrackToCrate(crate.id, track);
    service.addTrackToCrate(crate.id, track); // duplicate ignored
    expect(service.getCrateTracks(crate.id)).toHaveLength(1);
    expect(service.listCrates()[0].trackCount).toBe(1);

    // MIDI mappings
    const saved = service.saveMidiMapping({
      deviceName: 'Pioneer DDJ-FLX4',
      controlKey: 'mixer.crossfader',
      channel: 0,
      statusType: 'cc',
      ccOrNote: 10,
      mode: 'absolute',
      minVal: 0,
      maxVal: 1
    });
    expect(service.listMidiMappings('Pioneer DDJ-FLX4')).toHaveLength(1);
    service.deleteMidiMapping(saved.id);
    expect(service.listMidiMappings('Pioneer DDJ-FLX4')).toHaveLength(0);
  });

  it('builds a weighted HistoryTasteProfile extracting preferred channels, keywords and recent IDs', () => {
    const s = service.startSession('Karaoke Salsa Night');
    service.logTrackPlay({
      sessionId: s.id,
      deck: 'A',
      videoId: 'salsa000001',
      title: 'Grupo Niche - Cali Pachanguero Karaoke Oficial',
      channel: 'Salsa Karaoke TV',
      durationSec: 250,
      playedAt: 1000
    });
    service.logTrackPlay({
      sessionId: s.id,
      deck: 'B',
      videoId: 'salsa000002',
      title: 'Marc Anthony - Vivir Mi Vida Karaoke',
      channel: 'Salsa Karaoke TV',
      durationSec: 260,
      playedAt: 2000
    });
    service.logTrackPlay({
      sessionId: s.id,
      deck: 'A',
      videoId: 'rock0000003',
      title: 'Soda Stereo - De Musica Ligera',
      channel: 'Rock Nacional',
      durationSec: 210,
      playedAt: 3000
    });

    const profile = service.buildTasteProfile(50);
    expect(profile.totalPlays).toBe(3);
    expect(profile.topChannels[0]).toEqual({ name: 'Salsa Karaoke TV', count: 2 });
    expect(profile.topKeywords.some((k) => k.word === 'karaoke')).toBe(true);
    expect(profile.topKeywords.some((k) => k.word === 'salsa')).toBe(true);
    expect(profile.recentVideoIds).toEqual(['rock0000003', 'salsa000002', 'salsa000001']);
    expect(profile.avgDurationSec).toBe(240);
  });
});

