import { describe, it, expect } from 'vitest';
import { mergeOverlayConfig, toPersistedOverlayConfig } from '../../../src/renderer/video/overlayPersistence';
import { createDefaultOverlayConfig } from '../../../src/renderer/video/OverlayCompositor';

describe('overlay config persistence', () => {
  it('restores the saved frame and fills new fields from defaults', () => {
    const saved = {
      frame: { enabled: true, preset: 'gala-gold', titleText: 'Boda Ana y Leo' },
      webcam: { enabled: true }
    };
    const cfg = mergeOverlayConfig(saved);
    expect(cfg.frame.enabled).toBe(true);
    expect(cfg.frame.preset).toBe('gala-gold');
    expect(cfg.frame.titleText).toBe('Boda Ana y Leo');
    expect(cfg.frame.insetPercent).toBe(createDefaultOverlayConfig().frame.insetPercent);
    expect(cfg.marquee).toEqual(createDefaultOverlayConfig().marquee);
    expect(cfg.webcam.enabled).toBe(false);
  });

  it('falls back to defaults for garbage and never saves the webcam as on', () => {
    expect(mergeOverlayConfig('nope')).toEqual(createDefaultOverlayConfig());
    const live = createDefaultOverlayConfig();
    live.webcam.enabled = true;
    expect(toPersistedOverlayConfig(live).webcam.enabled).toBe(false);
  });
});
