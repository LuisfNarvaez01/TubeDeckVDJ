import { describe, it, expect, vi } from 'vitest';
import {
  YouTubeSearchService,
  YouTubeTimeoutError,
  withTimeout,
  type InnertubeClientLike,
  type SearchResultPageLike
} from '../../../src/main/services/YouTubeSearchService';

const never = <T,>(): Promise<T> => new Promise<T>(() => {});

function page(videoId: string): SearchResultPageLike {
  return {
    has_continuation: false,
    results: [
      {
        type: 'Video',
        video_id: videoId,
        title: 'Song',
        author: { name: 'Artist' },
        duration: { seconds: 200 },
        thumbnails: [{ url: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` }]
      }
    ],
    getContinuation: vi.fn()
  };
}

function client(search: InnertubeClientLike['search']): InnertubeClientLike {
  return {
    search,
    getSearchSuggestions: vi.fn().mockResolvedValue([]),
    getPlaylist: vi.fn()
  };
}

describe('withTimeout', () => {
  it('rejects with YouTubeTimeoutError when the promise hangs', async () => {
    await expect(withTimeout(never(), 20, 'prueba')).rejects.toBeInstanceOf(YouTubeTimeoutError);
  });

  it('passes through values that settle in time', async () => {
    await expect(withTimeout(Promise.resolve(7), 50, 'prueba')).resolves.toBe(7);
  });
});

describe('YouTubeSearchService timeouts', () => {
  it('retries a hung search with a fresh client and returns its results', async () => {
    const hung = client(vi.fn(() => never<SearchResultPageLike>()));
    const healthy = client(vi.fn().mockResolvedValue(page('okVideo0001')));
    const factory = vi.fn().mockResolvedValueOnce(hung).mockResolvedValueOnce(healthy);
    const service = new YouTubeSearchService(factory, { timeoutMs: 30, retries: 1 });

    const result = await service.search('salsa');

    expect(result.items.map((t) => t.videoId)).toEqual(['okVideo0001']);
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('gives a clear Spanish error when YouTube keeps hanging', async () => {
    const factory = vi.fn().mockResolvedValue(client(vi.fn(() => never<SearchResultPageLike>())));
    const service = new YouTubeSearchService(factory, { timeoutMs: 20, retries: 1 });

    await expect(service.search('salsa')).rejects.toThrow('YouTube tardó demasiado en responder');
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('also bounds a hung client creation', async () => {
    const factory = vi.fn(() => never<InnertubeClientLike>());
    const service = new YouTubeSearchService(factory, { timeoutMs: 20, retries: 0 });

    await expect(service.search('salsa')).rejects.toThrow('YouTube tardó demasiado en responder');
  });
});
