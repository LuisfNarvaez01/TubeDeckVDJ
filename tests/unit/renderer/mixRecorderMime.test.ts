import { describe, expect, it } from 'vitest';
import { pickRecorderMime } from '../../../src/renderer/audio/MixRecorder';

describe('pickRecorderMime', () => {
  it('prefers VP9+Opus for video and Opus for audio', () => {
    expect(pickRecorderMime('video', () => true)).toBe('video/webm;codecs=vp9,opus');
    expect(pickRecorderMime('audio', (t) => t === 'audio/webm')).toBe('audio/webm');
    expect(pickRecorderMime('video', () => false)).toBeNull();
  });
});
