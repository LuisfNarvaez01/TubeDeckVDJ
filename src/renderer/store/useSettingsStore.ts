import { create } from 'zustand';
import type {
  DeckId,
  DisplayInfo,
  UpdateStatus,
  VideoQualityPreference,
  VideoQualityTier,
  YtDlpStatus
} from '../../shared/types';
import type { AudioOutputDevice } from '../audio/AudioOutputRouter';
import { createDefaultOverlayConfig, type OverlayConfig } from '../video/OverlayCompositor';
import { createDefaultDeckFxState, type DeckFxState } from '../video/VideoFxPipeline';
import type { VideoCrossfaderMode, VideoTransitionId } from '../video/WebGLVideoCompositor';

interface SettingsStore {
  audioOutputs: AudioOutputDevice[];
  masterDeviceId: string;
  cueDeviceId: string;
  monoSplit: boolean;
  audioNotice: string | null;
  displays: DisplayInfo[];
  selectedDisplayId: number | null;
  outputOpen: boolean;
  outputResolution: '720p' | '1080p';
  videoQuality: VideoQualityPreference;
  activeDeckQuality: Record<DeckId, VideoQualityTier | null>;
  qualityNotice: string | null;
  ytDlpStatus: YtDlpStatus;
  overlayConfig: OverlayConfig;
  videoMode: VideoCrossfaderMode;
  videoMix: number;
  autoDurationSec: number;
  transition: VideoTransitionId;
  masterFx: DeckFxState;
  updaterStatus: UpdateStatus | null;
  setAudioOutputs: (devices: AudioOutputDevice[]) => void;
  setMasterDeviceId: (id: string) => void;
  setCueDeviceId: (id: string) => void;
  setMonoSplit: (enabled: boolean) => void;
  setAudioNotice: (msg: string | null) => void;
  setDisplays: (displays: DisplayInfo[]) => void;
  setSelectedDisplayId: (id: number | null) => void;
  setOutputOpen: (open: boolean) => void;
  setOutputResolution: (res: '720p' | '1080p') => void;
  setVideoQuality: (q: VideoQualityPreference) => void;
  setActiveDeckQuality: (deck: DeckId, tier: VideoQualityTier | null) => void;
  setQualityNotice: (msg: string | null) => void;
  setYtDlpStatus: (status: YtDlpStatus) => void;
  setOverlayConfig: (cfg: OverlayConfig) => void;
  setVideoMode: (mode: VideoCrossfaderMode) => void;
  setVideoMix: (mix: number) => void;
  setAutoDurationSec: (sec: number) => void;
  setTransition: (id: VideoTransitionId) => void;
  setMasterFx: (fx: DeckFxState) => void;
  setUpdaterStatus: (status: UpdateStatus | null) => void;
}

export const useSettingsStore = create<SettingsStore>((set) => ({
  audioOutputs: [{ deviceId: 'default', label: 'Salida predeterminada' }],
  masterDeviceId: 'default',
  cueDeviceId: 'default',
  monoSplit: false,
  audioNotice: null,
  displays: [],
  selectedDisplayId: null,
  outputOpen: false,
  outputResolution: '1080p',
  videoQuality: 'auto',
  activeDeckQuality: { A: null, B: null },
  qualityNotice: null,
  ytDlpStatus: { available: false, binaryPath: null, downloading: false, error: null },
  overlayConfig: createDefaultOverlayConfig(),
  videoMode: 'linked',
  videoMix: 0.5,
  autoDurationSec: 2,
  transition: 'dissolve',
  masterFx: createDefaultDeckFxState(),
  updaterStatus: null,
  setAudioOutputs: (audioOutputs) => set({ audioOutputs }),
  setMasterDeviceId: (masterDeviceId) => set({ masterDeviceId }),
  setCueDeviceId: (cueDeviceId) => set({ cueDeviceId }),
  setMonoSplit: (monoSplit) => set({ monoSplit }),
  setAudioNotice: (audioNotice) => set({ audioNotice }),
  setDisplays: (displays) => set({ displays }),
  setSelectedDisplayId: (selectedDisplayId) => set({ selectedDisplayId }),
  setOutputOpen: (outputOpen) => set({ outputOpen }),
  setOutputResolution: (outputResolution) => set({ outputResolution }),
  setVideoQuality: (videoQuality) => set({ videoQuality }),
  setActiveDeckQuality: (deck, tier) =>
    set((state) => ({
      activeDeckQuality: { ...state.activeDeckQuality, [deck]: tier }
    })),
  setQualityNotice: (qualityNotice) => set({ qualityNotice }),
  setYtDlpStatus: (ytDlpStatus) => set({ ytDlpStatus }),
  setOverlayConfig: (overlayConfig) => set({ overlayConfig }),
  setVideoMode: (videoMode) => set({ videoMode }),
  setVideoMix: (videoMix) => set({ videoMix }),
  setAutoDurationSec: (autoDurationSec) => set({ autoDurationSec }),
  setTransition: (transition) => set({ transition }),
  setMasterFx: (masterFx) => set({ masterFx }),
  setUpdaterStatus: (updaterStatus) => set({ updaterStatus })
}));
