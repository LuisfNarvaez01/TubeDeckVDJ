import { createDefaultOverlayConfig, type OverlayConfig } from './OverlayCompositor';

export const OVERLAY_SETTING_KEY = 'overlayConfig';

function isObject(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Rebuilds a full config from what was saved: unknown or missing fields fall back to the
 * defaults (older saves, new options), and the webcam never turns itself on at startup.
 */
export function mergeOverlayConfig(saved: unknown): OverlayConfig {
  const base = createDefaultOverlayConfig();
  if (!isObject(saved)) return base;
  const merged = { ...base } as Record<string, unknown>;
  for (const key of Object.keys(base) as Array<keyof OverlayConfig>) {
    const part = saved[key];
    if (isObject(part)) merged[key] = { ...base[key], ...part };
  }
  const out = merged as unknown as OverlayConfig;
  out.webcam = { ...out.webcam, enabled: false };
  return out;
}

/** What gets written: everything except the live webcam switch. */
export function toPersistedOverlayConfig(cfg: OverlayConfig): OverlayConfig {
  return { ...cfg, webcam: { ...cfg.webcam, enabled: false } };
}

let pending: ReturnType<typeof setTimeout> | null = null;

/** Debounced save (sliders fire many changes per second). */
export function persistOverlayConfig(cfg: OverlayConfig, delayMs = 500): void {
  if (pending) clearTimeout(pending);
  pending = setTimeout(() => {
    pending = null;
    void window.tubedeckAPI?.setSetting?.(OVERLAY_SETTING_KEY, toPersistedOverlayConfig(cfg));
  }, delayMs);
}
