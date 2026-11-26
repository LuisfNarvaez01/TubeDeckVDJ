import type { LantifyPrefs } from '../../shared/types';

/** Same defaults as the main process (`DEFAULT_LANTIFY_PREFS`), shown before the first status. */
export const DEFAULT_LANTIFY_PREFS_RENDERER: LantifyPrefs = {
  autoApprove: false,
  maxPerHour: 12,
  maxPerTable: 3,
  overlayEnabled: true
};
