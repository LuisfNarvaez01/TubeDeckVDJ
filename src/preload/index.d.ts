import type { TubeDeckAPI } from './index';

declare global {
  interface Window {
    tubedeckAPI: TubeDeckAPI;
  }
}

export {};
