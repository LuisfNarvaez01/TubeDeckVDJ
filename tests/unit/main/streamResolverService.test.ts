import { describe, it, expect, vi } from 'vitest';
import {
  StreamResolverService,
  type YtDlpRunner
} from '../../../src/main/services/StreamResolverService';

describe('StreamResolverService', () => {
  const expireEpochSec = Math.floor(Date.now() / 1000) + 3600;

  it('prefers muxed mp4 <=1080p and caches until near expiry', async () => {
    const runner = vi.fn<YtDlpRunner>().mockResolvedValue({
      formats: [
        {
          format_id: '18',
          ext: 'mp4',
          height: 360,
          vcodec: 'avc1',
          acodec: 'mp4a',
          url: `https://cdn.example/muxed360?expire=${expireEpochSec}`,
          fps: 30
        },
        {
          format_id: '22',
          ext: 'mp4',
          height: 720,
          vcodec: 'avc1',
          acodec: 'mp4a',
          url: `https://cdn.example/muxed720?expire=${expireEpochSec}`,
          fps: 30
        },
        {
          format_id: '299',
          ext: 'mp4',
          height: 1080,
          vcodec: 'avc1',
          acodec: 'none',
          url: `https://cdn.example/video1080?expire=${expireEpochSec}`,
          fps: 60
        }
      ]
    });

    const service = new StreamResolverService(runner);
    const first = await service.resolve('dQw4w9WgXcQ');
    expect(first.mode).toBe('muxed');
    expect(first.muxedUrl).toContain('muxed720');
    expect(first.expiresAtMs).toBe(expireEpochSec * 1000);

    const second = await service.resolve('dQw4w9WgXcQ');
    expect(second.muxedUrl).toBe(first.muxedUrl);
    expect(runner).toHaveBeenCalledTimes(1);

    await service.invalidateAndResolve('dQw4w9WgXcQ');
    expect(runner).toHaveBeenCalledTimes(2);
  });

  it('falls back to dash-split <=1080p when no muxed format exists', async () => {
    const runner = vi.fn<YtDlpRunner>().mockResolvedValue({
      formats: [
        {
          format_id: '313',
          ext: 'webm',
          height: 2160,
          vcodec: 'vp9',
          acodec: 'none',
          url: `https://cdn.example/video2160?expire=${expireEpochSec}`,
          fps: 60
        },
        {
          format_id: '137',
          ext: 'mp4',
          height: 1080,
          vcodec: 'avc1',
          acodec: 'none',
          url: `https://cdn.example/video1080?expire=${expireEpochSec}`,
          fps: 30
        },
        {
          format_id: '140',
          ext: 'm4a',
          vcodec: 'none',
          acodec: 'mp4a.40.2',
          abr: 128,
          url: `https://cdn.example/audio140?expire=${expireEpochSec}`
        }
      ]
    });

    const service = new StreamResolverService(runner);
    const resolved = await service.resolve('abcDEF_1234');
    expect(resolved.mode).toBe('dash-split');
    expect(resolved.videoUrl).toContain('video1080');
    expect(resolved.audioUrl).toContain('audio140');
  });

  it('rejects invalid videoId and falls back to Innertube when yt-dlp fails', async () => {
    const runner = vi.fn<YtDlpRunner>().mockRejectedValue(new Error('yt-dlp exited 1'));
    const fallback = vi.fn().mockResolvedValue({
      videoId: 'abcDEF_1234',
      mode: 'muxed' as const,
      muxedUrl: `https://cdn.example/fallback?expire=${expireEpochSec}`,
      expiresAtMs: expireEpochSec * 1000,
      mimeTypes: { muxed: 'video/mp4' }
    });

    const service = new StreamResolverService(runner, fallback);
    await expect(service.resolve('../bad-id')).rejects.toThrow(/Invalid videoId/);

    const resolved = await service.resolve('abcDEF_1234');
    expect(resolved.muxedUrl).toContain('fallback');
    expect(fallback).toHaveBeenCalledWith('abcDEF_1234');
  });
});
