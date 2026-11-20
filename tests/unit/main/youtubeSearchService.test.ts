import { describe, it, expect, vi } from 'vitest';
import {
  YouTubeSearchService,
  type InnertubeClientLike
} from '../../../src/main/services/YouTubeSearchService';

describe('YouTubeSearchService', () => {
  it('normalizes results, filters live/invalid durations, and supports pagination', async () => {
    const page2 = {
      has_continuation: false,
      results: [
        {
          type: 'Video',
          video_id: 'trackPage201',
          title: { toString: () => 'Page 2 Remix' },
          author: { name: 'DJ Two' },
          duration: { seconds: 240 },
          thumbnails: [{ url: 'https://i.ytimg.com/vi/trackPage201/hqdefault.jpg' }],
          is_live: false
        }
      ],
      getContinuation: vi.fn()
    };

    const page1 = {
      has_continuation: true,
      results: [
        {
          type: 'Video',
          video_id: 'liveStream1',
          title: { toString: () => '24/7 Live Radio' },
          author: { name: 'Live FM' },
          duration: { seconds: 0 },
          thumbnails: [{ url: 'https://i.ytimg.com/vi/liveStream1/hqdefault.jpg' }],
          is_live: true
        },
        {
          type: 'Video',
          video_id: 'dQw4w9WgXcQ',
          title: { toString: () => 'Club Edit Track' },
          author: { name: 'Club Official' },
          duration: { seconds: 195 },
          thumbnails: [
            { url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/default.jpg' },
            { url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg' }
          ],
          is_live: false
        }
      ],
      getContinuation: vi.fn().mockResolvedValue(page2)
    };

    const mockClient: InnertubeClientLike = {
      search: vi.fn().mockResolvedValue(page1),
      getSearchSuggestions: vi.fn().mockResolvedValue(['club edit', 'club remix']),
      getPlaylist: vi.fn().mockResolvedValue({
        has_continuation: false,
        items: [
          {
            type: 'PlaylistVideo',
            id: 'plTrack0001',
            title: { toString: () => 'Playlist Song 1' },
            author: { name: 'Playlist Artist' },
            duration: { seconds: 180 },
            thumbnails: [{ url: 'https://i.ytimg.com/vi/plTrack0001/hqdefault.jpg' }],
            is_live: false,
            is_playable: true
          },
          {
            type: 'PlaylistVideo',
            id: 'plUnplayable',
            title: { toString: () => 'Private Video' },
            author: { name: 'Unknown' },
            duration: { seconds: 150 },
            thumbnails: [],
            is_live: false,
            is_playable: false
          }
        ],
        getContinuation: vi.fn()
      }),
      getInfo: vi.fn().mockResolvedValue({
        watch_next_feed: [
          {
            type: 'LockupView',
            content_id: 'dQw4w9WgXcQ', // same as current/excluded seed -> filtered out
            content_type: 'VIDEO',
            metadata: { title: { toString: () => 'Already Playing Track' } },
            duration: { seconds: 200 }
          },
          {
            type: 'LockupView',
            content_id: 'mixList0001',
            content_type: 'PLAYLIST', // playlist lockup -> filtered out
            metadata: { title: { toString: () => 'My Mix' } }
          },
          {
            type: 'LockupView',
            content_id: 'shortClip01',
            content_type: 'VIDEO',
            metadata: { title: { toString: () => '10s Short' } },
            duration: { seconds: 10 } // < 30s -> filtered out
          },
          {
            type: 'LockupView',
            content_id: 'djV11Xbc914',
            content_type: 'VIDEO',
            metadata: {
              title: { toString: () => 'a-ha - Take On Me' },
              metadata: {
                metadata_rows: [{ metadata_parts: [{ text: { toString: () => 'a-ha Official' } }] }]
              }
            },
            content_image: {
              image: [{ url: 'https://i.ytimg.com/vi/djV11Xbc914/hqdefault.jpg' }],
              overlays: [{ badges: [{ text: '4:04' }] }]
            }
          },
          {
            type: 'CompactVideo',
            video_id: 'relTrack002',
            title: { toString: () => '80s Synthwave Classic' },
            author: { name: 'Synth DJ' },
            duration: { seconds: 215 },
            thumbnails: [{ url: 'https://i.ytimg.com/vi/relTrack002/hqdefault.jpg' }],
            is_live: false
          }
        ]
      })
    };

    const service = new YouTubeSearchService(async () => mockClient);

    const first = await service.search('club edit');
    expect(first.hasMore).toBe(true);
    expect(first.items).toEqual([
      {
        videoId: 'dQw4w9WgXcQ',
        title: 'Club Edit Track',
        channel: 'Club Official',
        durationSec: 195,
        thumbnailUrl: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg',
        isLive: false
      }
    ]);

    const second = await service.nextPage();
    expect(second.hasMore).toBe(false);
    expect(second.items[0].videoId).toBe('trackPage201');

    const suggestions = await service.getSuggestions('club');
    expect(suggestions).toEqual(['club edit', 'club remix']);

    const playlist = await service.getPlaylistTracks(
      'https://www.youtube.com/playlist?list=PL1234567890'
    );
    expect(mockClient.getPlaylist).toHaveBeenCalledWith('PL1234567890');
    expect(playlist).toHaveLength(1);
    expect(playlist[0].videoId).toBe('plTrack0001');

    const related = await service.getRelatedTracks('dQw4w9WgXcQ', ['relTrack999']);
    expect(mockClient.getInfo).toHaveBeenCalledWith('dQw4w9WgXcQ');
    expect(related).toEqual([
      {
        videoId: 'djV11Xbc914',
        title: 'a-ha - Take On Me',
        channel: 'a-ha Official',
        durationSec: 244,
        thumbnailUrl: 'https://i.ytimg.com/vi/djV11Xbc914/hqdefault.jpg',
        isLive: false
      },
      {
        videoId: 'relTrack002',
        title: '80s Synthwave Classic',
        channel: 'Synth DJ',
        durationSec: 215,
        thumbnailUrl: 'https://i.ytimg.com/vi/relTrack002/hqdefault.jpg',
        isLive: false
      }
    ]);
  });
});

