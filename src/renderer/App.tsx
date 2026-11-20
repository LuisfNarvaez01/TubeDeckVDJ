import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  CloudDownload,
  Disc3,
  Frame,
  Headphones,
  Keyboard,
  Monitor,
  Radio,
  Sliders,
  Sparkles,
  X
} from 'lucide-react';
import type {
  Crate,
  DeckId,
  MidiMapping,
  VideoQualityPreference,
  YouTubeTrack
} from '../shared/types';
import {
  AudioDspEngine,
  type AudioFxId,
  type CrossfaderCurve,
  type EqBand,
  type FxBeatDivision,
  type SamplerPadId
} from './audio/AudioDspEngine';
import { AudioOutputRouter } from './audio/AudioOutputRouter';
import { DualDeckMediaSync } from './audio/DualDeckMediaSync';
import { DeckFxSamplerModule } from './components/DeckFxSamplerModule';
import { DeckPanel } from './components/DeckPanel';
import { HistoryAndCratesTab } from './components/HistoryAndCratesTab';
import { InteractiveGuideModal } from './components/InteractiveGuideModal';
import { LocalLibraryTab } from './components/LocalLibraryTab';
import { MixerCenter } from './components/MixerCenter';
import { OverlayControls } from './components/OverlayControls';
import { QueueTab } from './components/QueueTab';
import { SearchBrowserTab } from './components/SearchBrowserTab';
import { SettingsTab } from './components/SettingsTab';
import { type RgbWaveSample } from './components/ui/RgbWaveformStrip';
import { VideoPreviewBar } from './components/VideoPreviewBar';
import { HotkeyManager, type HotkeyAction } from './controllers/HotkeyManager';
import { MidiLearnEngine, type MidiLearnMode } from './controllers/MidiLearnEngine';
import { BpmAndWaveformEngine } from './dj/BpmAndWaveformEngine';
import { CueLoopTempoController } from './dj/CueLoopTempoController';
import { type AutomixFadeType, QueueAndAutomixEngine } from './dj/QueueAndAutomixEngine';
import { useDeckStore } from './store/useDeckStore';
import { useLibraryStore } from './store/useLibraryStore';
import { useMixerStore } from './store/useMixerStore';
import { useSettingsStore } from './store/useSettingsStore';
import {
  OverlayCompositor,
  cleanTrackTitleForOsd,
  type OverlayConfig
} from './video/OverlayCompositor';
import { startOutputRtcSender } from './video/outputRtcBridge';
import { VideoFxPipeline, type VideoFxId } from './video/VideoFxPipeline';
import {
  WebGLVideoCompositor,
  type VideoCrossfaderMode,
  type VideoTransitionId
} from './video/WebGLVideoCompositor';

type BrowserTab = 'search' | 'local' | 'queue' | 'history';

const BROWSER_TABS: Array<{ id: BrowserTab; getLabel: (localCount: number, qCount: number) => string }> = [
  { id: 'search', getLabel: () => 'Buscador YouTube' },
  { id: 'local', getLabel: (localCount) => `Biblioteca Local (${localCount})` },
  { id: 'queue', getLabel: (_l, qCount) => `Cola (${qCount})` },
  { id: 'history', getLabel: () => 'Historial & Crates' }
];

interface CrossfadeAnimationState {
  active: boolean;
  startMs: number;
  durationMs: number;
  fromPos: number;
  toPos: number;
  fromDeck: DeckId;
  toDeck: DeckId;
  fadeType: AutomixFadeType;
  pauseOutgoingOnComplete: boolean;
}

export function App(): ReactElement {
  const [activeTab, setActiveTab] = useState<BrowserTab>('search');
  const [guideOpen, setGuideOpen] = useState(false);
  const [framesDrawerOpen, setFramesDrawerOpen] = useState(false);
  const [settingsDrawerOpen, setSettingsDrawerOpen] = useState(false);

  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [crates, setCrates] = useState<Crate[]>([]);
  const [midiDevices, setMidiDevices] = useState<string[]>([]);
  const [midiMappings, setMidiMappings] = useState<MidiMapping[]>([]);
  const [learningControlKey, setLearningControlKey] = useState<string | null>(null);

  const hotkeyManagerRef = useRef(new HotkeyManager());
  const midiEngineRef = useRef(new MidiLearnEngine());
  const activeSessionIdRef = useRef<string | null>(null);
  const onAirMsRef = useRef<Record<DeckId, number>>({ A: 0, B: 0 });
  const lastLoggedTrackRef = useRef<Record<DeckId, string>>({ A: '', B: '' });

  const dspRef = useRef<AudioDspEngine | null>(null);
  const routerRef = useRef<AudioOutputRouter | null>(null);
  const decksSyncRef = useRef<Record<DeckId, DualDeckMediaSync> | null>(null);
  const cueCtrlsRef = useRef<Record<DeckId, CueLoopTempoController> | null>(null);
  const bpmEnginesRef = useRef<Record<DeckId, BpmAndWaveformEngine>>({
    A: new BpmAndWaveformEngine(),
    B: new BpmAndWaveformEngine()
  });
  const energySamplesRef = useRef<Record<DeckId, number[]>>({ A: [], B: [] });
  const liveRgbRef = useRef<Record<DeckId, RgbWaveSample[]>>({ A: [], B: [] });
  const autoGainEmaRef = useRef<Record<DeckId, number>>({ A: 0.42, B: 0.42 });
  const brakeTimersRef = useRef<Record<DeckId, number | null>>({ A: null, B: null });
  const queueEngineRef = useRef(new QueueAndAutomixEngine());

  const masterCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const compositorRef = useRef<WebGLVideoCompositor | null>(null);
  const fxPipelineRef = useRef(new VideoFxPipeline());
  const overlayCompRef = useRef(new OverlayCompositor(1280, 720));
  const webcamVideoRef = useRef<HTMLVideoElement | null>(null);
  const webcamStreamRef = useRef<MediaStream | null>(null);

  const crossfadeAnimRef = useRef<CrossfadeAnimationState | null>(null);
  const videoAutoAnimRef = useRef<{
    active: boolean;
    startMs: number;
    durationMs: number;
    fromSide: 'A' | 'B';
  } | null>(null);

  const masterSinkAudioRef = useRef<HTMLAudioElement | null>(null);
  const cueSinkAudioRef = useRef<HTMLAudioElement | null>(null);
  const cuePreviewAudioRef = useRef<HTMLAudioElement | null>(null);
  const previewContainersRef = useRef<Record<DeckId, HTMLDivElement | null>>({ A: null, B: null });
  const activeDominantDeckRef = useRef<DeckId>('A');

  const setDeckPatch = useDeckStore((s) => s.setDeckPatch);
  const mixerStore = useMixerStore();
  const settings = useSettingsStore();
  const libraryStore = useLibraryStore();

  const ensureAudioInitialized = useCallback(async () => {
    if (!dspRef.current) {
      dspRef.current = new AudioDspEngine();
    }
    if (!decksSyncRef.current) {
      decksSyncRef.current = {
        A: new DualDeckMediaSync('A'),
        B: new DualDeckMediaSync('B')
      };
    }

    const dsp = dspRef.current;
    await dsp.init();
    const { masterDest, cueDest } = dsp.getOutputDestinations();

    if (masterSinkAudioRef.current && masterSinkAudioRef.current.srcObject !== masterDest.stream) {
      masterSinkAudioRef.current.srcObject = masterDest.stream;
      void Promise.resolve(masterSinkAudioRef.current.play?.()).catch(() => {});
    }
    if (cueSinkAudioRef.current && cueSinkAudioRef.current.srcObject !== cueDest.stream) {
      cueSinkAudioRef.current.srcObject = cueDest.stream;
      void Promise.resolve(cueSinkAudioRef.current.play?.()).catch(() => {});
    }
    if (cuePreviewAudioRef.current) {
      dsp.attachCuePreviewElement(cuePreviewAudioRef.current);
    }

    if (!routerRef.current && masterSinkAudioRef.current && cueSinkAudioRef.current) {
      const router = new AudioOutputRouter(
        dsp,
        masterSinkAudioRef.current,
        cueSinkAudioRef.current
      );
      routerRef.current = router;
      const outputs = await router.enumerateOutputs();
      useSettingsStore.getState().setAudioOutputs(outputs);
      router.startWatchingDevices((info) => {
        const parts: string[] = [];
        if (info.masterFallback) parts.push('Master');
        if (info.cueFallback) parts.push('Audífonos');
        useSettingsStore
          .getState()
          .setAudioNotice(
            `Dispositivo desconectado (${parts.join(' / ')}): revertido a salida predeterminada.`
          );
      });
    }

    if (!cueCtrlsRef.current) {
      const persistMeta = (
        videoId: string,
        hotCues: ReturnType<CueLoopTempoController['getHotCues']>,
        loop: ReturnType<CueLoopTempoController['getLoop']>
      ) => {
        void window.tubedeckAPI?.upsertTrackMeta({ videoId, hotCues, loop });
      };
      cueCtrlsRef.current = {
        A: new CueLoopTempoController('A', decksSyncRef.current.A, persistMeta),
        B: new CueLoopTempoController('B', decksSyncRef.current.B, persistMeta)
      };
    }

    (['A', 'B'] as DeckId[]).forEach((id) => {
      const sync = decksSyncRef.current![id];
      for (const el of sync.getAllMediaElements()) {
        dsp.attachDeckElement(id, el);
      }
      const container = previewContainersRef.current[id];
      const videoEl = sync.getVideoElement();
      if (container && videoEl.parentElement !== container) {
        container.replaceChildren(videoEl);
      }
    });

    return { dsp, decks: decksSyncRef.current, cueCtrls: cueCtrlsRef.current };
  }, []);

  const attachPreviewContainer = useCallback((deck: DeckId, container: HTMLDivElement | null) => {
    previewContainersRef.current[deck] = container;
    const sync = decksSyncRef.current?.[deck];
    if (container && sync) {
      const videoEl = sync.getVideoElement();
      if (videoEl.parentElement !== container) {
        container.replaceChildren(videoEl);
      }
    }
  }, []);

  const stopCuePreview = useCallback(() => {
    const el = cuePreviewAudioRef.current;
    if (el) {
      el.pause();
      el.src = '';
    }
    useLibraryStore.getState().setPreviewState(null, false);
  }, []);

  const handleCuePreview = useCallback(
    async (track: YouTubeTrack) => {
      const curPreview = useLibraryStore.getState().previewingVideoId;
      if (curPreview === track.videoId) {
        stopCuePreview();
        return;
      }

      stopCuePreview();
      useLibraryStore.getState().setPreviewState(track.videoId, true);

      try {
        await ensureAudioInitialized();
        const streamRes =
          track.source === 'local' && track.localFilePath && window.tubedeckAPI.resolveLocalFile
            ? await window.tubedeckAPI.resolveLocalFile(track.localFilePath)
            : await window.tubedeckAPI.resolveStream(track.videoId);

        if (useLibraryStore.getState().previewingVideoId !== track.videoId) {
          return;
        }
        if (!streamRes.success) {
          stopCuePreview();
          return;
        }

        const url = streamRes.data.audioUrl ?? streamRes.data.muxedUrl;
        const audioEl = cuePreviewAudioRef.current;
        if (!url || !audioEl) {
          stopCuePreview();
          return;
        }

        audioEl.crossOrigin = 'anonymous';
        audioEl.src = url;
        audioEl.currentTime = 0;
        await audioEl.play();
        useLibraryStore.getState().setPreviewState(track.videoId, false);
      } catch {
        stopCuePreview();
      }
    },
    [ensureAudioInitialized, stopCuePreview]
  );

  const cancelAutoCrossfade = useCallback(() => {
    if (crossfadeAnimRef.current?.active) {
      const fromDeck = crossfadeAnimRef.current.fromDeck;
      decksSyncRef.current?.[fromDeck].setTemporaryBend(1);
      crossfadeAnimRef.current = null;
      useMixerStore.getState().setAutoFadeState(false, null);
    }
  }, []);

  const startUnifiedCrossfade = useCallback(
    async (
      toDeck: DeckId,
      durationSec: number,
      fadeType: AutomixFadeType = 'smart-crossfade',
      pauseOutgoingOnComplete = true
    ) => {
      const fromDeck: DeckId = toDeck === 'A' ? 'B' : 'A';
      const syncs = decksSyncRef.current;
      const toTrack = useDeckStore.getState().decks[toDeck].track;

      if (syncs && toTrack && syncs[toDeck].isPaused()) {
        try {
          await syncs[toDeck].play();
          setDeckPatch(toDeck, { playing: true });
        } catch {
          // ignore if stream is still buffering
        }
      }

      const curPos = useMixerStore.getState().crossfader;
      const toPos = toDeck === 'B' ? 1 : 0;
      const durMs = fadeType === 'cut' ? 120 : Math.max(250, durationSec * 1000);

      useMixerStore.getState().setAutoFadeState(true, toDeck);
      crossfadeAnimRef.current = {
        active: true,
        startMs: performance.now(),
        durationMs: durMs,
        fromPos: curPos,
        toPos,
        fromDeck,
        toDeck,
        fadeType,
        pauseOutgoingOnComplete
      };
    },
    [setDeckPatch]
  );

  // Initialize displays, yt-dlp, updater, local library, taste profile, batch download progress, MIDI, WebGL & WebRTC
  useEffect(() => {
    const api = window.tubedeckAPI;
    let unsubDisplays = () => {};
    let unsubClosed = () => {};
    let unsubUpdater = () => {};
    let unsubBatch = () => {};
    let rtcHandle: ReturnType<typeof startOutputRtcSender> | null = null;

    if (api) {
      void api.startSession().then((res) => {
        if (res.success) {
          activeSessionIdRef.current = res.data.id;
          setActiveSessionId(res.data.id);
        }
      });
      void api.listCrates().then((res) => {
        if (res.success) setCrates(res.data);
      });
      void api.listMidiMappings().then((res) => {
        if (res.success) {
          setMidiMappings(res.data);
          midiEngineRef.current.loadMappings(res.data);
        }
      });
      void api.listDisplays().then((res) => {
        if (res.success) {
          useSettingsStore.getState().setDisplays(res.data);
          const ext = res.data.find((d) => !d.isPrimary) ?? res.data[0] ?? null;
          useSettingsStore.getState().setSelectedDisplayId(ext ? ext.id : null);
        }
      });
      void api.getYtDlpStatus().then((res) => {
        if (res.success) useSettingsStore.getState().setYtDlpStatus(res.data);
      });
      void api.getUpdateStatus().then((res) => {
        if (res.success && res.data) useSettingsStore.getState().setUpdaterStatus(res.data);
      });
      void api.listLocalLibrary?.().then((res) => {
        if (res.success) {
          useLibraryStore.getState().setLocalLibrary(res.data.folders, res.data.tracks);
        }
      });
      void api.getHistoryTasteProfile?.().then((res) => {
        if (res.success) {
          useLibraryStore.getState().setTasteProfile(res.data);
        }
      });

      unsubDisplays = api.onDisplaysChanged((list) => {
        useSettingsStore.getState().setDisplays(list);
      });
      unsubClosed = api.onOutputClosed(() => {
        useSettingsStore.getState().setOutputOpen(false);
      });
      unsubUpdater = api.onUpdateStatus((status) => {
        useSettingsStore.getState().setUpdaterStatus(status);
      });
      unsubBatch =
        api.onBatchDownloadProgress?.((prog) => {
          useLibraryStore.getState().setBatchDownload(prog);
          if (prog.status === 'done') {
            void api.listLocalLibrary?.().then((res) => {
              if (res.success) {
                useLibraryStore.getState().setLocalLibrary(res.data.folders, res.data.tracks);
              }
            });
          }
        }) ?? (() => {});
    }

    if (masterCanvasRef.current && !compositorRef.current) {
      const comp = new WebGLVideoCompositor(masterCanvasRef.current);
      comp.setResolution(1920, 1080);
      comp.init();
      compositorRef.current = comp;

      if (api && typeof RTCPeerConnection !== 'undefined') {
        rtcHandle = startOutputRtcSender(
          () => compositorRef.current?.captureOutputStream(60) ?? null,
          (sig) => api.sendSignalToOutput(sig),
          (cb) => api.onSignalFromOutput(cb)
        );
      }
    }

    return () => {
      unsubDisplays();
      unsubClosed();
      unsubUpdater();
      unsubBatch();
      rtcHandle?.dispose();
      compositorRef.current?.dispose();
      compositorRef.current = null;
    };
  }, []);

  const loadTrackOntoDeck = useCallback(
    async (deck: DeckId, track: YouTubeTrack) => {
      liveRgbRef.current[deck] = [];
      autoGainEmaRef.current[deck] = 0.42;
      queueEngineRef.current.markDeckChanged(deck);
      queueEngineRef.current.recordPlayed(track.videoId);
      useLibraryStore.getState().markTrackPlayed(track.videoId);

      setDeckPatch(deck, {
        track,
        loading: true,
        error: null,
        playing: false,
        currentTimeSec: 0,
        hotCues: [],
        loop: null,
        bpm: null,
        waveformPeaks: null,
        mainCueSec: 0,
        autoGainDb: 0,
        synced: false,
        bufferRatio: 0,
        customOsdTitle: null,
        keyShiftSemitones: 0
      });

      const { dsp, decks, cueCtrls } = await ensureAudioInitialized();
      dsp.setDeckAutoGain(deck, 1);
      dsp.setKeyShift(deck, 0);

      const resolvePromise =
        track.source === 'local' && track.localFilePath && window.tubedeckAPI.resolveLocalFile
          ? window.tubedeckAPI.resolveLocalFile(track.localFilePath)
          : window.tubedeckAPI.resolveStream(track.videoId);

      const [streamRes, metaRes] = await Promise.all([
        resolvePromise,
        window.tubedeckAPI.getTrackMeta(track.videoId)
      ]);

      if (!streamRes.success) {
        setDeckPatch(deck, { loading: false, error: streamRes.error });
        throw new Error(streamRes.error);
      }

      const preferredQuality = useSettingsStore.getState().videoQuality;
      await decks[deck].load({
        ...streamRes.data,
        preferredQuality,
        mediaKind: track.mediaKind ?? streamRes.data.mediaKind ?? 'video',
        onQualityDowngraded: (tier, reason) => {
          const st = useSettingsStore.getState();
          st.setActiveDeckQuality(deck, tier);
          st.setQualityNotice(`Deck ${deck}: ${reason}`);
        }
      });

      useSettingsStore.getState().setActiveDeckQuality(deck, decks[deck].getActiveQuality());

      const savedMeta = metaRes.success ? metaRes.data : null;
      const cues = savedMeta?.hotCues ?? [];
      const loop = savedMeta?.loop ?? null;
      cueCtrls[deck].loadTrackState(track.videoId, cues, loop);
      energySamplesRef.current[deck] = [];

      const st = useDeckStore.getState().decks[deck];
      decks[deck].setPlaybackRate(1 + st.pitchPercent / 100, st.keyLock);
      setDeckPatch(deck, {
        loading: false,
        durationSec: decks[deck].getDuration() || track.durationSec,
        currentTimeSec: 0,
        bufferRatio: decks[deck].getBufferedRatio(),
        hotCues: cues,
        loop,
        bpm: savedMeta?.bpm ?? null,
        waveformPeaks: savedMeta?.waveformPeaks ?? null,
        mainCueSec: cueCtrls[deck].getMainCueSec()
      });
    },
    [ensureAudioInitialized, setDeckPatch]
  );

  // Main 60fps engine: Audio+Video fade, anti-freeze watchdog, waveforms, buffer health, Automix, WebGL master & Audio Visualizer
  useEffect(() => {
    let rafId = 0;
    let lastUiUpdate = 0;
    let lastEnergySample = 0;
    let lastWaveSample = 0;
    let lastAutomixTick = 0;

    const tick = (now: number) => {
      const syncs = decksSyncRef.current;
      const cueCtrls = cueCtrlsRef.current;
      const dsp = dspRef.current;
      const stSettings = useSettingsStore.getState();
      const stMixer = useMixerStore.getState();
      const stDecks = useDeckStore.getState().decks;

      let effectiveVideoMix =
        stSettings.videoMode === 'linked' ? stMixer.crossfader : stSettings.videoMix;

      const cAnim = crossfadeAnimRef.current;
      if (cAnim?.active) {
        const rawP = Math.min(1, (now - cAnim.startMs) / cAnim.durationMs);
        let eased = rawP;
        if (cAnim.fadeType === 'smart-crossfade') {
          eased = rawP * rawP * (3 - 2 * rawP);
        } else if (cAnim.fadeType === 'cut') {
          eased = rawP >= 0.99 ? 1 : 0;
        } else if (cAnim.fadeType === 'backspin') {
          eased = rawP * rawP * (3 - 2 * rawP);
          syncs?.[cAnim.fromDeck].setTemporaryBend(Math.max(0.5, 1 - rawP * 0.5));
        }

        const pos = Math.min(
          1,
          Math.max(0, cAnim.fromPos + (cAnim.toPos - cAnim.fromPos) * eased)
        );
        dsp?.setCrossfader(pos, stMixer.crossfaderCurve);
        if (Math.abs(pos - stMixer.crossfader) > 0.004 || rawP >= 1) {
          useMixerStore.getState().setCrossfader(pos);
        }
        if (stSettings.videoMode === 'linked') {
          effectiveVideoMix = pos;
        } else {
          effectiveVideoMix = pos;
          useSettingsStore.getState().setVideoMix(pos);
        }

        if (rawP >= 1) {
          syncs?.[cAnim.fromDeck].setTemporaryBend(1);
          if (cAnim.pauseOutgoingOnComplete && syncs) {
            syncs[cAnim.fromDeck].pause();
            setDeckPatch(cAnim.fromDeck, { playing: false });
          }
          crossfadeAnimRef.current = null;
          useMixerStore.getState().setAutoFadeState(false, null);
        }
      } else if (videoAutoAnimRef.current?.active && compositorRef.current) {
        const vAnim = videoAutoAnimRef.current;
        const progress = Math.min(1, (now - vAnim.startMs) / vAnim.durationMs);
        effectiveVideoMix = compositorRef.current.stepAutoTransition(progress, vAnim.fromSide);
        useSettingsStore.getState().setVideoMix(effectiveVideoMix);
        if (progress >= 1) {
          videoAutoAnimRef.current.active = false;
        }
      }

      const nextDom: DeckId = effectiveVideoMix < 0.5 ? 'A' : 'B';
      if (nextDom !== activeDominantDeckRef.current) {
        activeDominantDeckRef.current = nextDom;
        const domDeckState = stDecks[nextDom];
        if (domDeckState.track) {
          overlayCompRef.current.triggerTrackOsd(
            domDeckState.customOsdTitle ?? domDeckState.track.title,
            domDeckState.track.channel,
            now,
            Boolean(domDeckState.customOsdTitle)
          );
        }
      }

      if (syncs) {
        (['A', 'B'] as DeckId[]).forEach((id) => {
          const s = syncs[id];
          if (!s.isPaused()) {
            s.syncDrift(now);
            s.checkVideoHealth(now);
            void cueCtrls?.[id].checkLoopBoundary(s.getCurrentTime());
          }
        });

        if (dsp && now - lastWaveSample >= 45) {
          lastWaveSample = now;
          (['A', 'B'] as DeckId[]).forEach((id) => {
            if (!syncs[id].isPaused()) {
              const bands = dsp.readDeckFrequencyBands(id);
              const arr = liveRgbRef.current[id];
              arr.push(bands);
              if (arr.length > 140) arr.shift();

              if (stMixer.autoGainEnabled) {
                const vu = dsp.readVuLevel(id);
                if (vu > 0.03) {
                  const ema = autoGainEmaRef.current[id] * 0.94 + vu * 0.06;
                  autoGainEmaRef.current[id] = ema;
                  const targetGain = Math.min(1.65, Math.max(0.65, 0.42 / Math.max(0.18, ema)));
                  dsp.setDeckAutoGain(id, targetGain);
                  const db = Number((20 * Math.log10(targetGain)).toFixed(1));
                  const prevDb = useDeckStore.getState().decks[id].autoGainDb;
                  if (Math.abs(db - prevDb) >= 0.4) {
                    setDeckPatch(id, { autoGainDb: db });
                  }
                }
              }
            }
          });
        }

        if (dsp && now - lastEnergySample >= 40) {
          lastEnergySample = now;
          (['A', 'B'] as DeckId[]).forEach((id) => {
            if (!syncs[id].isPaused()) {
              const analyser = dsp.getDeckAnalyser(id);
              const bands = fxPipelineRef.current.extractAudioBands(analyser);
              const hist = energySamplesRef.current[id];
              hist.push(bands.low);
              if (hist.length > 250) hist.shift();
              if (hist.length === 150 && !useDeckStore.getState().decks[id].bpm) {
                const detected = bpmEnginesRef.current[id].detectBpmFromEnergyHistory(hist, 0.04);
                if (detected) {
                  setDeckPatch(id, { bpm: detected });
                  const vid = useDeckStore.getState().decks[id].track?.videoId;
                  if (vid) void window.tubedeckAPI?.upsertTrackMeta({ videoId: vid, bpm: detected });
                }
              }
            }
          });
        }

        if (now - lastUiUpdate >= 100) {
          const dtMs = lastUiUpdate === 0 ? 100 : now - lastUiUpdate;
          lastUiUpdate = now;
          (['A', 'B'] as DeckId[]).forEach((id) => {
            const s = syncs[id];
            const currentTimeSec = s.getCurrentTime();
            const durationSec = s.getDuration();
            const playing = !s.isPaused();
            const bufferRatio = s.getBufferedRatio();
            const prev = useDeckStore.getState().decks[id];
            if (
              Math.abs(prev.currentTimeSec - currentTimeSec) > 0.08 ||
              Math.abs(prev.durationSec - durationSec) > 0.2 ||
              Math.abs(prev.bufferRatio - bufferRatio) > 0.03 ||
              prev.playing !== playing
            ) {
              setDeckPatch(id, { currentTimeSec, durationSec, playing, bufferRatio });
            }

            const chFader = stMixer.channels[id].fader;
            const crossGain = id === 'A' ? 1 - stMixer.crossfader : stMixer.crossfader;
            if (playing && chFader > 0.05 && crossGain > 0.1 && prev.track) {
              onAirMsRef.current[id] += dtMs;
              const playKey = `${activeSessionIdRef.current}:${prev.track.videoId}`;
              if (
                onAirMsRef.current[id] >= 10_000 &&
                lastLoggedTrackRef.current[id] !== playKey &&
                activeSessionIdRef.current
              ) {
                lastLoggedTrackRef.current[id] = playKey;
                useLibraryStore.getState().markTrackPlayed(prev.track.videoId);
                void window.tubedeckAPI
                  ?.logTrackPlay({
                    sessionId: activeSessionIdRef.current,
                    deck: id,
                    videoId: prev.track.videoId,
                    title: prev.track.title,
                    channel: prev.track.channel,
                    durationSec: prev.track.durationSec,
                    playedAt: Date.now(),
                    endedAt: null,
                    bpm: prev.bpm,
                    transitionUsed: stSettings.transition
                  })
                  .then(() => {
                    void window.tubedeckAPI?.getHistoryTasteProfile?.().then((res) => {
                      if (res.success) {
                        useLibraryStore.getState().setTasteProfile(res.data);
                      }
                    });
                  });
              }
            } else if (!playing) {
              onAirMsRef.current[id] = 0;
            }
          });
        }

        if (now - lastAutomixTick >= 250) {
          lastAutomixTick = now;
          const isTransitioning = Boolean(crossfadeAnimRef.current?.active);
          const activeDeck: DeckId = isTransitioning
            ? crossfadeAnimRef.current!.toDeck
            : stMixer.crossfader <= 0.5
              ? 'A'
              : 'B';
          const otherDeck: DeckId = activeDeck === 'A' ? 'B' : 'A';
          const deckState = useDeckStore.getState().decks[activeDeck];
          const otherState = useDeckStore.getState().decks[otherDeck];
          const isEnded = syncs[activeDeck].isEnded();
          const remainingSec = isEnded
            ? 0
            : Math.max(0, deckState.durationSec - deckState.currentTimeSec);
          const lib = useLibraryStore.getState();

          if (lib.automixEnabled && deckState.track && deckState.durationSec > 0) {
            void queueEngineRef.current
              .tick(
                {
                  activeDeck,
                  activeVideoId: deckState.track.videoId,
                  otherDeckVideoId: otherState.track?.videoId ?? null,
                  elapsedSec: deckState.currentTimeSec,
                  remainingSec,
                  isActivePlaying: deckState.playing,
                  isActiveEnded: isEnded,
                  isTransitioning
                },
                {
                  enabled: true,
                  preloadLeadSec: 30,
                  preloadMode: lib.preloadMode,
                  crossfadeDurationSec: lib.automixFadeDurationSec,
                  outroTriggerSec: Math.min(lib.automixFadeDurationSec, 12),
                  autoRadioEnabled: lib.autoRadioEnabled,
                  fadeType: lib.automixFadeType
                },
                {
                  loadDeck: async (targetDeck, track) => {
                    await loadTrackOntoDeck(targetDeck, track);
                    useLibraryStore.getState().setQueue(queueEngineRef.current.getQueue());
                  },
                  startTransition: async (_fromDeck, toDeck, durationSec, fadeType) => {
                    await startUnifiedCrossfade(toDeck, durationSec, fadeType, true);
                    useLibraryStore.getState().setQueue(queueEngineRef.current.getQueue());
                  },
                  onTrackSkipped: (item, reason) => {
                    useLibraryStore
                      .getState()
                      .setAutomixStatusNote(`Saltado "${item.track.title}": ${reason}`);
                    useLibraryStore.getState().setQueue(queueEngineRef.current.getQueue());
                  },
                  fetchSuggestedTracks: async (seedVideoId, excludeIds) => {
                    const res = await (window.tubedeckAPI?.getRecommendedTracks
                      ? window.tubedeckAPI.getRecommendedTracks(seedVideoId, excludeIds)
                      : window.tubedeckAPI?.getRelatedTracks(seedVideoId, excludeIds));
                    return res?.success ? res.data : [];
                  },
                  onRadioQueued: (track) => {
                    useLibraryStore
                      .getState()
                      .setAutomixStatusNote(`Radio YT sugirió "${track.title}"`);
                    useLibraryStore.getState().setQueue(queueEngineRef.current.getQueue());
                  }
                }
              )
              .then(() => {
                useLibraryStore.getState().setQueue(queueEngineRef.current.getQueue());
              });
          }
        }
      }

      if (compositorRef.current) {
        const domDeck: DeckId = effectiveVideoMix < 0.5 ? 'A' : 'B';
        const domSt = stDecks[domDeck];
        const domBpm = domSt.bpm ?? 120;
        const bands = fxPipelineRef.current.extractAudioBands(dsp?.getMasterAnalyser() ?? null);
        const domVideoEl = syncs?.[domDeck].getVideoElement() ?? null;
        const isAudioOnlyActive = Boolean(
          domSt.track &&
            (domSt.track.mediaKind === 'audio' ||
              (domSt.playing && (!domVideoEl || domVideoEl.videoWidth === 0)))
        );

        const audioVis =
          isAudioOnlyActive && domSt.track
            ? {
                active: true,
                bands,
                spectrum: dsp?.readMasterSpectrum() ?? null,
                accentColor: domDeck === 'A' ? '#0EA5E9' : '#F59E0B',
                title: domSt.customOsdTitle ?? domSt.track.title,
                channel: domSt.track.channel
              }
            : null;

        const ovCanvas = overlayCompRef.current.getCanvas();
        const ovCtx = ovCanvas.getContext('2d');
        if (ovCtx) {
          overlayCompRef.current.render(ovCtx, now, webcamVideoRef.current, audioVis);
        }

        const rawUniforms = fxPipelineRef.current.getFxUniforms(
          stSettings.masterFx,
          bands,
          now / 1000,
          domBpm
        );
        const fxScale = Math.max(0.1, Math.min(1, stSettings.videoFxIntensity ?? 0.7));
        const scaledUniforms = {
          ...rawUniforms,
          u_fxBlur: (rawUniforms.u_fxBlur ?? 0) * fxScale,
          u_fxHue: (rawUniforms.u_fxHue ?? 0) * fxScale,
          u_fxBw: (rawUniforms.u_fxBw ?? 0) * fxScale,
          u_fxPixelate: (rawUniforms.u_fxPixelate ?? 0) * fxScale,
          u_fxAudioShader: (rawUniforms.u_fxAudioShader ?? 0) * fxScale
        };

        compositorRef.current.renderFrame({
          mix: effectiveVideoMix,
          transition: stSettings.transition,
          videoA: syncs?.A.getVideoElement() ?? null,
          videoB: syncs?.B.getVideoElement() ?? null,
          overlayCanvas: ovCanvas,
          videoRect: overlayCompRef.current.getVideoInsetRect(),
          timeSec: now / 1000,
          audioBands: bands,
          fxUniforms: scaledUniforms
        });
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(rafId);
      routerRef.current?.dispose();
      decksSyncRef.current?.A.dispose();
      decksSyncRef.current?.B.dispose();
      void dspRef.current?.dispose();
    };
  }, [loadTrackOntoDeck, setDeckPatch, startUnifiedCrossfade]);

  const handleLoadToDeck = async (deck: DeckId, track: YouTubeTrack) => {
    try {
      await loadTrackOntoDeck(deck, track);
      if (deck === (useMixerStore.getState().crossfader <= 0.5 ? 'A' : 'B')) {
        overlayCompRef.current.triggerTrackOsd(track.title, track.channel, performance.now());
      }
    } catch {
      // error already stored in deck state
    }
  };

  const handlePlayNextInQueue = (track: YouTubeTrack) => {
    const item = queueEngineRef.current.enqueue(track);
    queueEngineRef.current.moveToNext(item.queueId);
    libraryStore.setQueue(queueEngineRef.current.getQueue());
    libraryStore.setAutomixStatusNote(`"${track.title}" movido a Siguiente.`);
  };

  const handleTogglePlay = useCallback(
    async (deck: DeckId) => {
      const { decks, cueCtrls } = await ensureAudioInitialized();
      const sync = decks[deck];
      if (sync.isPaused()) {
        cueCtrls[deck].cancelCuePreview();
        await sync.play();
        setDeckPatch(deck, { playing: true });
      } else {
        sync.pause();
        setDeckPatch(deck, { playing: false });
      }
    },
    [ensureAudioInitialized, setDeckPatch]
  );

  const handleSeek = useCallback(
    async (deck: DeckId, timeSec: number) => {
      const sync = decksSyncRef.current?.[deck];
      if (!sync) return;
      await sync.seek(timeSec);
      setDeckPatch(deck, { currentTimeSec: timeSec });
    },
    [setDeckPatch]
  );

  const handlePitchChange = useCallback(
    async (deck: DeckId, pitchPercent: number, keyLock: boolean) => {
      const { cueCtrls } = await ensureAudioInitialized();
      cueCtrls[deck].setPitchPercent(pitchPercent, keyLock);
      setDeckPatch(deck, { pitchPercent, keyLock, synced: false });
    },
    [ensureAudioInitialized, setDeckPatch]
  );

  const handleKeyShiftChange = useCallback(
    async (deck: DeckId, semitones: number) => {
      const { dsp } = await ensureAudioInitialized();
      dsp.setKeyShift(deck, semitones);
      setDeckPatch(deck, { keyShiftSemitones: semitones });
    },
    [ensureAudioInitialized, setDeckPatch]
  );

  const handleSync = useCallback(
    async (deck: DeckId) => {
      const other: DeckId = deck === 'A' ? 'B' : 'A';
      const selfSt = useDeckStore.getState().decks[deck];
      const otherSt = useDeckStore.getState().decks[other];
      if (!selfSt.bpm || !otherSt.bpm) return;
      const targetBpm = otherSt.bpm * (1 + otherSt.pitchPercent / 100);
      const rate = bpmEnginesRef.current[deck].computeSyncPlaybackRate(selfSt.bpm, targetBpm);
      const pitchPercent = Number(((rate - 1) * 100).toFixed(1));
      const { cueCtrls } = await ensureAudioInitialized();
      cueCtrls[deck].setPitchPercent(pitchPercent, selfSt.keyLock);
      setDeckPatch(deck, { pitchPercent, keyLock: selfSt.keyLock, synced: true });
    },
    [ensureAudioInitialized, setDeckPatch]
  );

  const handleCueDown = useCallback(
    async (deck: DeckId) => {
      const { decks, cueCtrls } = await ensureAudioInitialized();
      const sync = decks[deck];
      const res = await cueCtrls[deck].handleCueDown(sync.getCurrentTime(), !sync.isPaused());
      setDeckPatch(deck, {
        mainCueSec: cueCtrls[deck].getMainCueSec(),
        currentTimeSec: sync.getCurrentTime(),
        playing: res.action === 'preview'
      });
    },
    [ensureAudioInitialized, setDeckPatch]
  );

  const handleCueUp = useCallback(
    async (deck: DeckId) => {
      const cueCtrl = cueCtrlsRef.current?.[deck];
      const sync = decksSyncRef.current?.[deck];
      if (!cueCtrl || !sync) return;
      const reverted = await cueCtrl.handleCueUp();
      if (reverted) {
        setDeckPatch(deck, { playing: false, currentTimeSec: sync.getCurrentTime() });
      }
    },
    [setDeckPatch]
  );

  const handleBrake = useCallback(
    (deck: DeckId) => {
      const sync = decksSyncRef.current?.[deck];
      if (!sync || sync.isPaused()) return;
      if (brakeTimersRef.current[deck]) {
        window.clearInterval(brakeTimersRef.current[deck]!);
      }
      const start = performance.now();
      const durationMs = 550;
      const timerId = window.setInterval(() => {
        const p = Math.min(1, (performance.now() - start) / durationMs);
        sync.setTemporaryBend(Math.max(0.45, 1 - p * 0.55));
        if (p >= 1) {
          window.clearInterval(timerId);
          brakeTimersRef.current[deck] = null;
          sync.pause();
          sync.setTemporaryBend(1);
          setDeckPatch(deck, { playing: false });
        }
      }, 30);
      brakeTimersRef.current[deck] = timerId;
    },
    [setDeckPatch]
  );

  const handleDeckFxChange = useCallback(
    async (
      d: DeckId,
      fx: AudioFxId,
      enabled: boolean,
      wet: number,
      beatDiv?: FxBeatDivision
    ) => {
      const { dsp } = await ensureAudioInitialized();
      const st = useDeckStore.getState().decks[d];
      const resolvedDiv = beatDiv ?? st.audioFx[fx].beatDiv;
      dsp.setDeckFx(d, fx, enabled, wet, st.bpm, resolvedDiv);
      setDeckPatch(d, {
        audioFx: {
          ...st.audioFx,
          [fx]: { enabled, wet, beatDiv: resolvedDiv }
        }
      });
    },
    [ensureAudioInitialized, setDeckPatch]
  );

  const handleTriggerSample = useCallback(
    async (pad: SamplerPadId) => {
      const { dsp } = await ensureAudioInitialized();
      dsp.triggerSample(pad, 0.85);
    },
    [ensureAudioInitialized]
  );

  const handleTriggerAutoVideo = useCallback(() => {
    const st = useSettingsStore.getState();
    const curMix = st.videoMode === 'linked' ? useMixerStore.getState().crossfader : st.videoMix;
    const toDeck: DeckId = curMix < 0.5 ? 'B' : 'A';
    if (st.videoMode === 'linked') {
      void startUnifiedCrossfade(toDeck, st.autoDurationSec, 'smart-crossfade', false);
      return;
    }
    videoAutoAnimRef.current = {
      active: true,
      startMs: performance.now(),
      durationMs: st.autoDurationSec * 1000,
      fromSide: curMix < 0.5 ? 'A' : 'B'
    };
  }, [startUnifiedCrossfade]);

  const handleMidiControl = useCallback(
    (controlKey: string, val01: number) => {
      if (controlKey === 'mixer.crossfader') {
        cancelAutoCrossfade();
        const curve = useMixerStore.getState().crossfaderCurve;
        dspRef.current?.setCrossfader(val01, curve);
        useMixerStore.getState().setCrossfader(val01);
        return;
      }
      if (controlKey === 'deckA.fader') {
        dspRef.current?.setChannelFader('A', val01);
        useMixerStore.getState().setChannelPatch('A', { fader: val01 });
        return;
      }
      if (controlKey === 'deckB.fader') {
        dspRef.current?.setChannelFader('B', val01);
        useMixerStore.getState().setChannelPatch('B', { fader: val01 });
        return;
      }
      if (controlKey === 'deckA.playPause') {
        void handleTogglePlay('A');
        return;
      }
      if (controlKey === 'deckB.playPause') {
        void handleTogglePlay('B');
        return;
      }
      if (controlKey === 'video.autoTransition') {
        handleTriggerAutoVideo();
      }
    },
    [cancelAutoCrossfade, handleTogglePlay, handleTriggerAutoVideo]
  );

  useEffect(() => {
    const dispatchHotkey = (action: HotkeyAction) => {
      if (action === 'deckA.playPause') void handleTogglePlay('A');
      else if (action === 'deckB.playPause') void handleTogglePlay('B');
      else if (action === 'deckA.cue') void handleCueDown('A');
      else if (action === 'deckB.cue') void handleCueDown('B');
      else if (action === 'deckA.sync') void handleSync('A');
      else if (action === 'deckB.sync') void handleSync('B');
      else if (action === 'video.autoTransition') handleTriggerAutoVideo();
      else if (
        action === 'crossfader.left' ||
        action === 'crossfader.right' ||
        action === 'crossfader.center'
      ) {
        cancelAutoCrossfade();
        const cur = useMixerStore.getState().crossfader;
        const next =
          action === 'crossfader.center'
            ? 0.5
            : Math.min(1, Math.max(0, cur + (action === 'crossfader.right' ? 0.05 : -0.05)));
        dspRef.current?.setCrossfader(next, useMixerStore.getState().crossfaderCurve);
        useMixerStore.getState().setCrossfader(next);
      } else if (action.startsWith('deckA.hotCue.') || action.startsWith('deckB.hotCue.')) {
        const deck: DeckId = action.startsWith('deckA') ? 'A' : 'B';
        const slot = Number(action.split('.').pop());
        if (slot >= 1 && slot <= 8 && cueCtrlsRef.current && decksSyncRef.current) {
          void cueCtrlsRef.current[deck]
            .triggerHotCue(slot, decksSyncRef.current[deck].getCurrentTime())
            .then(() => {
              setDeckPatch(deck, { hotCues: cueCtrlsRef.current![deck].getHotCues() });
            });
        }
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setGuideOpen(false);
        setFramesDrawerOpen(false);
        setSettingsDrawerOpen(false);
        return;
      }
      const action = hotkeyManagerRef.current.handleKeyEvent(e);
      if (action) {
        e.preventDefault();
        dispatchHotkey(action);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    void midiEngineRef.current.init(handleMidiControl).then((devs) => {
      setMidiDevices(devs);
    });

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      midiEngineRef.current.dispose();
    };
  }, [
    cancelAutoCrossfade,
    handleCueDown,
    handleMidiControl,
    handleSync,
    handleTogglePlay,
    handleTriggerAutoVideo,
    setDeckPatch
  ]);

  const handleToggleCueMonitor = async (deck: DeckId) => {
    const { dsp } = await ensureAudioInitialized();
    const next = !useDeckStore.getState().decks[deck].cueEnabled;
    dsp.setCueEnabled(deck, next);
    setDeckPatch(deck, { cueEnabled: next });
  };

  const handleOverlayConfigChange = async (next: OverlayConfig) => {
    settings.setOverlayConfig(next);
    overlayCompRef.current.updateConfig(next);

    if (next.webcam.enabled && !webcamStreamRef.current && navigator.mediaDevices?.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        webcamStreamRef.current = stream;
        const vid = document.createElement('video');
        vid.muted = true;
        vid.playsInline = true;
        vid.srcObject = stream;
        await vid.play();
        webcamVideoRef.current = vid;
      } catch {
        settings.setOverlayConfig({ ...next, webcam: { ...next.webcam, enabled: false } });
      }
    } else if (!next.webcam.enabled && webcamStreamRef.current) {
      webcamStreamRef.current.getTracks().forEach((t) => t.stop());
      webcamStreamRef.current = null;
      webcamVideoRef.current = null;
    }
  };

  const handleVideoQualityChange = (q: VideoQualityPreference) => {
    settings.setVideoQuality(q);
    if (decksSyncRef.current) {
      (['A', 'B'] as DeckId[]).forEach((d) => {
        const tier = decksSyncRef.current![d].setPreferredQuality(q);
        settings.setActiveDeckQuality(d, tier);
      });
    }
  };

  const handleToggleOsdNow = () => {
    const nextEnabled = !settings.overlayConfig.osd.enabled;
    const nextCfg: OverlayConfig = {
      ...settings.overlayConfig,
      osd: { ...settings.overlayConfig.osd, enabled: nextEnabled }
    };
    void handleOverlayConfigChange(nextCfg);
    if (nextEnabled) {
      const domDeck = activeDominantDeckRef.current;
      const st = useDeckStore.getState().decks[domDeck];
      if (st.track) {
        overlayCompRef.current.triggerTrackOsd(
          st.customOsdTitle ?? st.track.title,
          st.track.channel,
          performance.now(),
          Boolean(st.customOsdTitle)
        );
      }
    } else {
      overlayCompRef.current.hideTrackOsd();
    }
  };

  const renderDeck = (deckId: DeckId) => (
    <DeckPanel
      key={deckId}
      deckId={deckId}
      activeQuality={settings.activeDeckQuality[deckId]}
      showHotkeys={settings.showHotkeys}
      liveRgbRef={liveRgbRef}
      onTogglePlay={handleTogglePlay}
      onSeek={handleSeek}
      onToggleCueMonitor={handleToggleCueMonitor}
      onPitchChange={handlePitchChange}
      onKeyShiftChange={handleKeyShiftChange}
      onCustomOsdTitleChange={(d, customTitle) => {
        const st = useDeckStore.getState().decks[d];
        if (d === activeDominantDeckRef.current && st.track) {
          overlayCompRef.current.triggerTrackOsd(
            customTitle ?? st.track.title,
            st.track.channel,
            performance.now(),
            Boolean(customTitle)
          );
        }
      }}
      onCueDown={handleCueDown}
      onCueUp={handleCueUp}
      onJogNudge={(d, mult) => decksSyncRef.current?.[d].setTemporaryBend(mult)}
      onJogScrub={(d, deltaSec) => {
        const sync = decksSyncRef.current?.[d];
        if (!sync) return;
        const target = Math.max(
          0,
          Math.min(sync.getDuration() || 9999, sync.getCurrentTime() + deltaSec)
        );
        void handleSeek(d, target);
      }}
      onBrake={handleBrake}
      onHotCueTrigger={async (d, slot) => {
        const { cueCtrls, decks } = await ensureAudioInitialized();
        await cueCtrls[d].triggerHotCue(slot, decks[d].getCurrentTime());
        setDeckPatch(d, { hotCues: cueCtrls[d].getHotCues() });
      }}
      onHotCueClear={async (d, slot) => {
        const { cueCtrls } = await ensureAudioInitialized();
        cueCtrls[d].clearHotCue(slot);
        setDeckPatch(d, { hotCues: cueCtrls[d].getHotCues() });
      }}
      onAutoLoop={async (d, beats) => {
        const { cueCtrls, decks } = await ensureAudioInitialized();
        const bpm = useDeckStore.getState().decks[d].bpm ?? 120;
        const loop = cueCtrls[d].triggerAutoLoop(beats, decks[d].getCurrentTime(), bpm);
        setDeckPatch(d, { loop });
      }}
      onToggleLoopExit={async (d) => {
        const { cueCtrls } = await ensureAudioInitialized();
        cueCtrls[d].toggleLoopExit();
        setDeckPatch(d, { loop: cueCtrls[d].getLoop() });
      }}
      onLoopIn={async (d) => {
        const { cueCtrls, decks } = await ensureAudioInitialized();
        cueCtrls[d].setLoopIn(decks[d].getCurrentTime());
        setDeckPatch(d, { loop: cueCtrls[d].getLoop() });
      }}
      onLoopOut={async (d) => {
        const { cueCtrls, decks } = await ensureAudioInitialized();
        cueCtrls[d].setLoopOut(decks[d].getCurrentTime());
        setDeckPatch(d, { loop: cueCtrls[d].getLoop() });
      }}
      onBeatJump={async (d, beats) => {
        const { cueCtrls, decks } = await ensureAudioInitialized();
        const st = useDeckStore.getState().decks[d];
        const nextT = await cueCtrls[d].beatJump(
          beats,
          decks[d].getCurrentTime(),
          st.bpm ?? 120,
          decks[d].getDuration()
        );
        setDeckPatch(d, { currentTimeSec: nextT });
      }}
      onLoopRollStart={async (d, beats) => {
        const { cueCtrls, decks } = await ensureAudioInitialized();
        const bpm = useDeckStore.getState().decks[d].bpm ?? 120;
        const loop = cueCtrls[d].startLoopRoll(beats, decks[d].getCurrentTime(), bpm);
        setDeckPatch(d, { loop });
      }}
      onLoopRollEnd={async (d) => {
        const cueCtrl = cueCtrlsRef.current?.[d];
        if (!cueCtrl) return;
        const restored = await cueCtrl.endLoopRoll();
        setDeckPatch(d, { loop: restored });
      }}
      onTriggerSample={handleTriggerSample}
      onDeckFxChange={handleDeckFxChange}
      onTapBpm={(d) => {
        const tapped = bpmEnginesRef.current[d].recordTap(performance.now());
        if (tapped) {
          setDeckPatch(d, { bpm: tapped });
          const vid = useDeckStore.getState().decks[d].track?.videoId;
          if (vid) void window.tubedeckAPI?.upsertTrackMeta({ videoId: vid, bpm: tapped });
        }
      }}
      onAdjustBpmHalfDouble={(d, factor) => {
        const cur = useDeckStore.getState().decks[d].bpm;
        if (!cur) return;
        setDeckPatch(d, { bpm: bpmEnginesRef.current[d].adjustHalfDouble(cur, factor) });
      }}
      onSync={handleSync}
    />
  );

  const upd = settings.updaterStatus;
  const nextQueuedItem = libraryStore.queue[0] ?? null;
  const frameEnabled = Boolean(
    settings.overlayConfig.frame?.enabled && settings.overlayConfig.frame.preset !== 'none'
  );
  const activeTabIndex = Math.max(
    0,
    BROWSER_TABS.findIndex((t) => t.id === activeTab)
  );

  return (
    <div className="flex h-screen w-screen flex-col gap-2 bg-[#08090C] p-2 text-[#F8FAFC]">
      <audio ref={masterSinkAudioRef} className="hidden" />
      <audio ref={cueSinkAudioRef} className="hidden" />
      <audio
        ref={cuePreviewAudioRef}
        onEnded={() => stopCuePreview()}
        className="hidden"
      />

      {/* Top Pro Hardware Obsidian Header Bar */}
      <header className="flex h-10 shrink-0 items-center justify-between gap-2 rounded-lg border border-white/[0.06] bg-[#0F1117] px-3 text-xs">
        <div className="flex shrink-0 items-center gap-2">
          <Disc3 className="h-4 w-4 text-[#0EA5E9]" />
          <span className="font-bold tracking-wide text-[#F8FAFC]">TubeDeck VDJ</span>
          <span className="rounded border border-white/[0.06] bg-[#08090C] px-1.5 py-0.5 font-mono-tabular text-[10px] text-[#94A3B8]">
            v{upd?.currentVersion ?? '2.2.0'}
          </span>

          <select
            aria-label="Calidad Video Global"
            value={settings.videoQuality}
            onChange={(e) => handleVideoQualityChange(e.target.value as VideoQualityPreference)}
            title="Calidad de video YouTube global (Auto evita congelamientos)"
            className="rounded border border-white/[0.06] bg-[#08090C] px-2 py-1 text-[10px] text-[#F8FAFC] focus:border-white/25 focus:outline-none cursor-pointer"
          >
            <option value="auto">Video Auto (Fluido 720p)</option>
            <option value="720p">720p HD</option>
            <option value="480p">480p Ligero</option>
            <option value="360p">360p Internet Lento</option>
            <option value="1080p">1080p Máxima</option>
          </select>
        </div>

        {/* Center: Up Next banner + CUE preview stop + quality downgrade notice */}
        <div className="flex min-w-0 flex-1 items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => setActiveTab('queue')}
            title="Ir a Cola de Reproducción"
            className="flex min-w-0 max-w-md items-center gap-1.5 rounded-md border border-white/[0.06] bg-[#08090C] px-2.5 py-1 text-[11px] hover:border-white/20 cursor-pointer"
          >
            <ArrowRight className="h-3 w-3 shrink-0 text-[#10B981]" />
            <span className="shrink-0 font-semibold text-[#64748B]">Siguiente:</span>
            {nextQueuedItem ? (
              <>
                <span className="truncate font-semibold text-[#F8FAFC]">
                  {cleanTrackTitleForOsd(nextQueuedItem.track.title)}
                </span>
                <span
                  className={`shrink-0 rounded border px-1 text-[9px] font-bold ${
                    nextQueuedItem.track.source === 'local'
                      ? 'border-white/[0.1] bg-[#151821] text-[#CBD5E1]'
                      : 'border-white/[0.08] bg-[#151821] text-[#94A3B8]'
                  }`}
                >
                  {nextQueuedItem.track.source === 'local'
                    ? 'LOCAL'
                    : nextQueuedItem.source === 'youtube-radio'
                      ? 'RADIO'
                      : 'YT'}
                </span>
              </>
            ) : (
              <span className="truncate text-[#64748B]">
                {libraryStore.autoRadioEnabled ? 'Radio YT lista' : 'Cola vacía'}
              </span>
            )}
          </button>

          {libraryStore.previewingVideoId ? (
            <button
              type="button"
              onClick={stopCuePreview}
              className="inline-flex items-center gap-1 rounded border border-[#10B981]/50 bg-[#10B981]/15 px-2 py-0.5 text-[10px] font-semibold text-[#10B981] cursor-pointer"
              title="Detener pre-escucha por audífonos"
            >
              <Headphones className="h-3 w-3" />
              Detener CUE
              <X className="h-3 w-3" />
            </button>
          ) : null}

          {settings.qualityNotice ? (
            <div className="flex items-center gap-1 rounded border border-white/[0.12] bg-[#151821] px-2 py-0.5 text-[10px] text-[#F59E0B]">
              <AlertTriangle className="h-3 w-3 shrink-0" />
              <span className="max-w-44 truncate">{settings.qualityNotice}</span>
              <button
                type="button"
                aria-label="Cerrar aviso de calidad"
                onClick={() => settings.setQualityNotice(null)}
                className="text-[#94A3B8] hover:text-[#F8FAFC] cursor-pointer"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ) : null}
        </div>

        {/* Right: Live Badges + KEYS Overlay Toggle + Drawers */}
        <div className="flex shrink-0 items-center gap-1.5 text-[11px]">
          <span
            className={`hidden xl:inline-flex items-center gap-1 rounded border border-white/[0.06] px-2 py-0.5 font-semibold ${
              libraryStore.automixEnabled
                ? 'bg-[#10B981]/15 text-[#10B981]'
                : 'bg-[#08090C] text-[#64748B]'
            }`}
          >
            <Sparkles className="h-3 w-3" />
            Automix
          </span>

          <span
            className={`hidden xl:inline-flex items-center gap-1 rounded border border-white/[0.06] px-2 py-0.5 font-semibold ${
              libraryStore.autoRadioEnabled
                ? 'bg-[#151821] text-[#CBD5E1]'
                : 'bg-[#08090C] text-[#64748B]'
            }`}
          >
            <Radio className="h-3 w-3" />
            Radio
          </span>

          <span
            className={`inline-flex items-center gap-1 rounded border border-white/[0.06] px-2 py-0.5 font-semibold ${
              settings.outputOpen
                ? 'bg-[#10B981]/15 text-[#10B981]'
                : 'bg-[#08090C] text-[#64748B]'
            }`}
          >
            <Monitor className="h-3 w-3" />
            {settings.outputOpen ? 'P2 LIVE' : 'P2 OFF'}
          </span>

          {upd?.state === 'available' || upd?.state === 'downloaded' ? (
            <button
              type="button"
              onClick={() => {
                setFramesDrawerOpen(false);
                setSettingsDrawerOpen(true);
              }}
              className="inline-flex items-center gap-1 rounded border border-[#10B981]/60 bg-[#10B981]/15 px-2 py-1 font-semibold text-[#10B981] cursor-pointer"
            >
              <CloudDownload className="h-3 w-3" />
              {upd.state === 'downloaded'
                ? `Instalar v${upd.availableVersion}`
                : `v${upd.availableVersion}`}
            </button>
          ) : null}

          <button
            type="button"
            aria-label="Mostrar Atajos"
            aria-pressed={settings.showHotkeys}
            onClick={() => settings.setShowHotkeys(!settings.showHotkeys)}
            className={`inline-flex items-center gap-1 rounded border px-2 py-1 font-semibold cursor-pointer ${
              settings.showHotkeys
                ? 'border-white/30 bg-[#1C202B] text-[#F8FAFC]'
                : 'border-white/[0.06] bg-[#08090C] text-[#94A3B8] hover:text-[#F8FAFC]'
            }`}
            title="Mostrar/ocultar teclas rápidas sobre los controles"
          >
            <Keyboard className="h-3.5 w-3.5" />
            KEYS
          </button>

          <button
            type="button"
            onClick={() => {
              setSettingsDrawerOpen(false);
              setFramesDrawerOpen((v) => !v);
            }}
            className={`inline-flex items-center gap-1 rounded border px-2.5 py-1 font-semibold cursor-pointer ${
              framesDrawerOpen || frameEnabled
                ? 'border-white/30 bg-[#1C202B] text-[#F8FAFC]'
                : 'border-white/[0.06] bg-[#08090C] text-[#94A3B8] hover:text-[#F8FAFC]'
            }`}
          >
            <Frame className="h-3.5 w-3.5" />
            Marcos
          </button>

          <button
            type="button"
            onClick={() => setGuideOpen(true)}
            className="inline-flex items-center gap-1 rounded border border-white/[0.06] bg-[#08090C] px-2.5 py-1 font-semibold text-[#94A3B8] hover:border-white/20 hover:text-[#F8FAFC] cursor-pointer"
          >
            <BookOpen className="h-3.5 w-3.5" />
            Guía
          </button>

          <button
            type="button"
            onClick={() => {
              setFramesDrawerOpen(false);
              setSettingsDrawerOpen((v) => !v);
            }}
            className={`inline-flex items-center gap-1 rounded border px-2.5 py-1 font-semibold cursor-pointer ${
              settingsDrawerOpen
                ? 'border-white/30 bg-[#1C202B] text-[#F8FAFC]'
                : 'border-white/[0.06] bg-[#08090C] text-[#94A3B8] hover:text-[#F8FAFC]'
            }`}
          >
            <Sliders className="h-3.5 w-3.5" />
            Ajustes
          </button>
        </div>
      </header>

      {/* Top Row: Deck A | Compact Video Master + Stacked Previews | Deck B */}
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(390px,450px)_minmax(0,1fr)] gap-2">
        {renderDeck('A')}

        <VideoPreviewBar
          masterCanvasRef={masterCanvasRef}
          attachPreviewContainer={attachPreviewContainer}
          videoMix={settings.videoMode === 'linked' ? mixerStore.crossfader : settings.videoMix}
          videoMode={settings.videoMode}
          autoDurationSec={settings.autoDurationSec}
          transition={settings.transition}
          activeFx={settings.masterFx.enabled}
          fxIntensity={settings.videoFxIntensity}
          osdEnabled={settings.overlayConfig.osd.enabled}
          displays={settings.displays}
          selectedDisplayId={settings.selectedDisplayId}
          outputOpen={settings.outputOpen}
          frameEnabled={frameEnabled}
          activeQualityA={settings.activeDeckQuality.A}
          activeQualityB={settings.activeDeckQuality.B}
          showHotkeys={settings.showHotkeys}
          onVideoMixChange={(m) => settings.setVideoMix(m)}
          onVideoModeChange={(mode: VideoCrossfaderMode) => settings.setVideoMode(mode)}
          onAutoDurationChange={(sec) => settings.setAutoDurationSec(sec)}
          onTriggerAutoTransition={handleTriggerAutoVideo}
          onTransitionChange={(id: VideoTransitionId) => settings.setTransition(id)}
          onToggleFx={(fxId: VideoFxId) => {
            const cur = settings.masterFx;
            settings.setMasterFx({
              ...cur,
              enabled: { ...cur.enabled, [fxId]: !cur.enabled[fxId] }
            });
          }}
          onFxIntensityChange={(val) => settings.setVideoFxIntensity(val)}
          onToggleOsdNow={handleToggleOsdNow}
          onSelectDisplay={(id) => {
            settings.setSelectedDisplayId(id);
            if (settings.outputOpen) {
              void window.tubedeckAPI?.moveOutputToDisplay(id, true);
            }
          }}
          onToggleOutputWindow={async () => {
            if (!window.tubedeckAPI) return;
            if (settings.outputOpen) {
              await window.tubedeckAPI.closeOutputWindow();
              settings.setOutputOpen(false);
            } else {
              const res = await window.tubedeckAPI.openOutputWindow(
                settings.selectedDisplayId,
                true
              );
              if (res.success && res.data) {
                settings.setOutputOpen(true);
              }
            }
          }}
          onOpenFramesDrawer={() => {
            setSettingsDrawerOpen(false);
            setFramesDrawerOpen(true);
          }}
        />

        {renderDeck('B')}
      </div>

      {/* Middle Row (100% full width, 3 symmetrical modules): Deck A FX & Sampler | Mixer Central | Deck B FX & Sampler */}
      <div className="grid grid-cols-[minmax(0,33%)_minmax(420px,34%)_minmax(0,33%)] xl:grid-cols-[minmax(0,34%)_minmax(0,32%)_minmax(0,34%)] gap-2">
        <DeckFxSamplerModule
          deckId="A"
          onDeckFxChange={handleDeckFxChange}
          onTriggerSample={handleTriggerSample}
        />

        <MixerCenter
          showHotkeys={settings.showHotkeys}
          onTrimChange={async (d, v) => {
            const { dsp } = await ensureAudioInitialized();
            dsp.setTrim(d, v);
            mixerStore.setChannelPatch(d, { trim: v });
          }}
          onEqChange={async (d, b: EqBand, db) => {
            const { dsp } = await ensureAudioInitialized();
            dsp.setEq(d, b, db);
            mixerStore.setEqValue(d, b, db);
          }}
          onEqKillToggle={async (d, b: EqBand, kill) => {
            const { dsp } = await ensureAudioInitialized();
            dsp.setEqKill(d, b, kill);
            mixerStore.setEqKill(d, b, kill);
          }}
          onColorFilterChange={async (d, a) => {
            const { dsp } = await ensureAudioInitialized();
            dsp.setColorFilter(d, a);
            mixerStore.setChannelPatch(d, { colorFilter: a });
          }}
          onFaderChange={async (d, level) => {
            const { dsp } = await ensureAudioInitialized();
            dsp.setChannelFader(d, level);
            mixerStore.setChannelPatch(d, { fader: level });
          }}
          onCrossfaderChange={async (pos, curve: CrossfaderCurve) => {
            cancelAutoCrossfade();
            const { dsp } = await ensureAudioInitialized();
            dsp.setCrossfader(pos, curve);
            mixerStore.setCrossfader(pos);
            mixerStore.setCrossfaderCurve(curve);
          }}
          onMasterGainChange={async (level) => {
            const { dsp } = await ensureAudioInitialized();
            dsp.setMasterGain(level);
            mixerStore.setMasterGain(level);
          }}
          onCueMixChange={async (blend) => {
            const { dsp } = await ensureAudioInitialized();
            dsp.setCueMix(blend);
            mixerStore.setCueMix(blend);
          }}
          onCueGainChange={async (level) => {
            const { dsp } = await ensureAudioInitialized();
            dsp.setCueGain(level);
            mixerStore.setCueGain(level);
          }}
          getVuLevel={(target) => dspRef.current?.readVuLevel(target) ?? 0}
          getStereoVuLevels={(target) => dspRef.current?.readStereoVuLevels(target) ?? [0, 0]}
          onAutoMixSwitch={() => {
            const target: DeckId = useMixerStore.getState().crossfader <= 0.5 ? 'B' : 'A';
            const lib = useLibraryStore.getState();
            void startUnifiedCrossfade(
              target,
              lib.automixFadeDurationSec,
              lib.automixFadeType,
              true
            );
          }}
          onToggleAutoGain={(enabled) => {
            mixerStore.setAutoGainEnabled(enabled);
            if (!enabled) {
              dspRef.current?.setDeckAutoGain('A', 1);
              dspRef.current?.setDeckAutoGain('B', 1);
              setDeckPatch('A', { autoGainDb: 0 });
              setDeckPatch('B', { autoGainDb: 0 });
            }
          }}
          videoLinked={settings.videoMode === 'linked'}
          onToggleVideoLinked={(linked) =>
            settings.setVideoMode(linked ? 'linked' : 'independent')
          }
        />

        <DeckFxSamplerModule
          deckId="B"
          onDeckFxChange={handleDeckFxChange}
          onTriggerSample={handleTriggerSample}
        />
      </div>

      {/* Bottom Row: 4-Tab Workspace with Sliding Pill */}
      <section className="flex flex-1 min-h-0 flex-col gap-2 rounded-xl border border-white/[0.06] bg-[#0F1117] p-2.5">
        <nav className="relative grid w-fit grid-cols-4 rounded-lg border border-white/[0.06] bg-[#08090C] p-0.5 text-xs">
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0.5 left-0.5 rounded-md bg-[#1C202B] ring-1 ring-white/[0.12] transition-transform duration-150 ease-[cubic-bezier(0.16,1,0.3,1)]"
            style={{
              width: 'calc(25% - 2px)',
              transform: `translateX(${activeTabIndex * 100}%)`
            }}
          />
          {BROWSER_TABS.map(({ id, getLabel }) => (
            <button
              key={id}
              type="button"
              onClick={() => setActiveTab(id)}
              className={`relative z-10 whitespace-nowrap rounded-md px-3 py-1 font-semibold cursor-pointer ${
                activeTab === id ? 'text-[#F8FAFC]' : 'text-[#94A3B8] hover:text-[#CBD5E1]'
              }`}
            >
              {getLabel(libraryStore.localTracks.length, libraryStore.queue.length)}
            </button>
          ))}
        </nav>

        <div className="flex-1 min-h-0">
          {activeTab === 'search' ? (
            <SearchBrowserTab
              onLoadToDeck={handleLoadToDeck}
              onAddToQueue={(tracks) => {
                queueEngineRef.current.enqueueMany(tracks, 'user');
                libraryStore.setQueue(queueEngineRef.current.getQueue());
              }}
              onPlayNextInQueue={handlePlayNextInQueue}
              onCuePreview={handleCuePreview}
              crates={crates}
              onAddToCrate={async (crateId, track) => {
                await window.tubedeckAPI?.addTrackToCrate(crateId, track);
                const res = await window.tubedeckAPI?.listCrates();
                if (res?.success) setCrates(res.data);
              }}
            />
          ) : null}

          {activeTab === 'local' ? (
            <LocalLibraryTab
              onPickFiles={async () => {
                const res = await window.tubedeckAPI?.pickLocalFiles();
                if (res?.success) {
                  libraryStore.setLocalLibrary(res.data.folders, res.data.tracks);
                }
              }}
              onPickFolder={async () => {
                const res = await window.tubedeckAPI?.pickLocalFolder();
                if (res?.success) {
                  libraryStore.setLocalLibrary(res.data.folders, res.data.tracks);
                }
              }}
              onRemoveFolder={async (folderPath) => {
                const res = await window.tubedeckAPI?.removeLocalFolder(folderPath);
                if (res?.success) {
                  libraryStore.setLocalLibrary(res.data.folders, res.data.tracks);
                }
              }}
              onLoadToDeck={handleLoadToDeck}
              onAddToQueue={(tracks) => {
                queueEngineRef.current.enqueueMany(tracks, 'local');
                libraryStore.setQueue(queueEngineRef.current.getQueue());
              }}
              onPlayNextInQueue={handlePlayNextInQueue}
              onCuePreview={handleCuePreview}
            />
          ) : null}

          {activeTab === 'queue' ? (
            <QueueTab
              onLoadFromQueue={async (deck, queueId) => {
                const item = queueEngineRef.current.dequeueById(queueId);
                if (!item) return;
                libraryStore.setQueue(queueEngineRef.current.getQueue());
                await handleLoadToDeck(deck, item.track);
              }}
              onReorderQueue={(from, to) => {
                queueEngineRef.current.reorder(from, to);
                libraryStore.setQueue(queueEngineRef.current.getQueue());
              }}
              onMoveToNext={(queueId) => {
                queueEngineRef.current.moveToNext(queueId);
                libraryStore.setQueue(queueEngineRef.current.getQueue());
              }}
              onRemoveQueueItem={(queueId) => {
                queueEngineRef.current.remove(queueId);
                libraryStore.setQueue(queueEngineRef.current.getQueue());
              }}
              onClearQueue={() => {
                queueEngineRef.current.clear();
                libraryStore.setQueue(queueEngineRef.current.getQueue());
                libraryStore.setAutomixStatusNote('Cola limpiada por completo.');
              }}
              onInterleaveQueue={() => {
                queueEngineRef.current.interleaveBySource();
                libraryStore.setQueue(queueEngineRef.current.getQueue());
                libraryStore.setAutomixStatusNote('Cola intercalada entre Local y YouTube.');
              }}
              onToggleAutomix={(enabled) => {
                libraryStore.setAutomixEnabled(enabled);
                libraryStore.setAutomixStatusNote(null);
              }}
              onToggleAutoRadio={(enabled) => {
                libraryStore.setAutoRadioEnabled(enabled);
              }}
              onFadeTypeChange={(ft) => libraryStore.setAutomixFadeType(ft)}
              onFadeDurationChange={(sec) => libraryStore.setAutomixFadeDurationSec(sec)}
              onPreloadModeChange={(mode) => libraryStore.setPreloadMode(mode)}
              onFetchSuggestionsNow={async () => {
                const activeDeck: DeckId = useMixerStore.getState().crossfader <= 0.5 ? 'A' : 'B';
                const seedTrack =
                  useDeckStore.getState().decks[activeDeck].track ??
                  useDeckStore.getState().decks[activeDeck === 'A' ? 'B' : 'A'].track;
                if (!seedTrack || !window.tubedeckAPI) {
                  libraryStore.setAutomixStatusNote(
                    'Carga primero una pista en Deck A o B para pedir recomendaciones.'
                  );
                  return;
                }
                const existingIds = [
                  seedTrack.videoId,
                  ...queueEngineRef.current.getQueue().map((q) => q.track.videoId)
                ];
                const res = await (window.tubedeckAPI.getRecommendedTracks
                  ? window.tubedeckAPI.getRecommendedTracks(seedTrack.videoId, existingIds)
                  : window.tubedeckAPI.getRelatedTracks(seedTrack.videoId, existingIds));
                if (res.success && res.data.length > 0) {
                  queueEngineRef.current.enqueueMany(res.data.slice(0, 3), 'youtube-radio');
                  libraryStore.setQueue(queueEngineRef.current.getQueue());
                  libraryStore.setAutomixStatusNote(
                    `Radio YT agregó ${Math.min(3, res.data.length)} canciones según tu historial.`
                  );
                }
              }}
            />
          ) : null}

          {activeTab === 'history' ? (
            <HistoryAndCratesTab
              activeSessionId={activeSessionId}
              onNewSession={async (title) => {
                const res = await window.tubedeckAPI?.startSession(title);
                if (res?.success) {
                  activeSessionIdRef.current = res.data.id;
                  setActiveSessionId(res.data.id);
                }
              }}
              onEndActiveSession={async () => {
                if (!activeSessionIdRef.current) return;
                await window.tubedeckAPI?.endSession(activeSessionIdRef.current);
                activeSessionIdRef.current = null;
                setActiveSessionId(null);
              }}
              onAddTracksToQueue={(tracks) => {
                queueEngineRef.current.enqueueMany(tracks, 'user');
                libraryStore.setQueue(queueEngineRef.current.getQueue());
                setActiveTab('queue');
              }}
              onLoadToDeck={handleLoadToDeck}
              crates={crates}
              onRefreshCrates={async () => {
                const res = await window.tubedeckAPI?.listCrates();
                if (res?.success) setCrates(res.data);
              }}
              onStartBatchDownload={async (sessionId, format) => {
                const res = await window.tubedeckAPI?.startBatchDownload(sessionId, format);
                if (res?.success && res.data) {
                  libraryStore.setBatchDownload(res.data);
                }
              }}
              onCancelBatchDownload={async () => {
                await window.tubedeckAPI?.cancelBatchDownload();
              }}
            />
          ) : null}
        </div>
      </section>

      {/* Slide-over Drawer: Marcos y Visuales */}
      {framesDrawerOpen ? (
        <div className="fixed inset-0 z-40 flex justify-end bg-black/65 backdrop-blur-[2px]">
          <div
            className="flex-1"
            onClick={() => setFramesDrawerOpen(false)}
            aria-hidden="true"
          />
          <aside
            role="dialog"
            aria-label="Marcos y Visuales"
            className="animate-drawer-in flex h-full w-[440px] max-w-[95vw] flex-col border-l border-white/[0.08] bg-[#0F1117]/95 backdrop-blur-md shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
              <div className="flex items-center gap-2">
                <Frame className="h-4 w-4 text-[#94A3B8]" />
                <h2 className="text-sm font-bold text-[#F8FAFC]">Marcos y Overlays en Vivo</h2>
              </div>
              <button
                type="button"
                aria-label="Cerrar Marcos"
                onClick={() => setFramesDrawerOpen(false)}
                className="rounded-lg border border-white/[0.06] bg-[#151821] p-1 text-[#94A3B8] hover:text-[#F8FAFC] cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-3">
              <OverlayControls
                config={settings.overlayConfig}
                onChange={handleOverlayConfigChange}
              />
            </div>
          </aside>
        </div>
      ) : null}

      {/* Slide-over Drawer: Ajustes del Sistema */}
      {settingsDrawerOpen ? (
        <div className="fixed inset-0 z-40 flex justify-end bg-black/65 backdrop-blur-[2px]">
          <div
            className="flex-1"
            onClick={() => setSettingsDrawerOpen(false)}
            aria-hidden="true"
          />
          <aside
            role="dialog"
            aria-label="Ajustes del Sistema"
            className="animate-drawer-in flex h-full w-[540px] max-w-[95vw] flex-col border-l border-white/[0.08] bg-[#0F1117]/95 backdrop-blur-md shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
              <div className="flex items-center gap-2">
                <Sliders className="h-4 w-4 text-[#94A3B8]" />
                <h2 className="text-sm font-bold text-[#F8FAFC]">
                  Ajustes (Audio / Pantalla / MIDI / Actualizaciones)
                </h2>
              </div>
              <button
                type="button"
                aria-label="Cerrar Ajustes"
                onClick={() => setSettingsDrawerOpen(false)}
                className="rounded-lg border border-white/[0.06] bg-[#151821] p-1 text-[#94A3B8] hover:text-[#F8FAFC] cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-3">
              <SettingsTab
                onRefreshAudioDevices={async () => {
                  await ensureAudioInitialized();
                  if (routerRef.current) {
                    settings.setAudioOutputs(await routerRef.current.enumerateOutputs());
                  }
                }}
                onSelectMasterDevice={async (id) => {
                  await ensureAudioInitialized();
                  await routerRef.current?.setMasterDevice(id);
                  settings.setMasterDeviceId(id);
                }}
                onSelectCueDevice={async (id) => {
                  await ensureAudioInitialized();
                  await routerRef.current?.setCueDevice(id);
                  settings.setCueDeviceId(id);
                }}
                onToggleMonoSplit={async (enabled) => {
                  await ensureAudioInitialized();
                  routerRef.current?.setMonoSplit(enabled);
                  settings.setMonoSplit(enabled);
                }}
                onEnsureYtDlp={async () => {
                  if (!window.tubedeckAPI) return;
                  settings.setYtDlpStatus({ ...settings.ytDlpStatus, downloading: true });
                  const res = await window.tubedeckAPI.ensureYtDlp();
                  if (res.success) {
                    settings.setYtDlpStatus(res.data);
                  } else {
                    settings.setYtDlpStatus({
                      available: false,
                      binaryPath: null,
                      downloading: false,
                      error: res.error
                    });
                  }
                }}
                onResolutionChange={(res) => {
                  settings.setOutputResolution(res);
                  if (res === '1080p') compositorRef.current?.setResolution(1920, 1080);
                  else compositorRef.current?.setResolution(1280, 720);
                }}
                onVideoQualityChange={handleVideoQualityChange}
                midiDevices={midiDevices}
                midiMappings={midiMappings}
                learningControlKey={learningControlKey}
                onInitMidi={async () => {
                  const devs = await midiEngineRef.current.init(handleMidiControl);
                  setMidiDevices(devs);
                }}
                onStartMidiLearn={(controlKey, mode: MidiLearnMode) => {
                  setLearningControlKey(controlKey);
                  midiEngineRef.current.startLearn(controlKey, mode, (learned) => {
                    setLearningControlKey(null);
                    void window.tubedeckAPI?.saveMidiMapping(learned).then((res) => {
                      if (res.success) {
                        void window.tubedeckAPI?.listMidiMappings().then((listRes) => {
                          if (listRes.success) {
                            setMidiMappings(listRes.data);
                            midiEngineRef.current.loadMappings(listRes.data);
                          }
                        });
                      }
                    });
                  });
                }}
                onDeleteMidiMapping={async (id) => {
                  await window.tubedeckAPI?.deleteMidiMapping(id);
                  const listRes = await window.tubedeckAPI?.listMidiMappings();
                  if (listRes?.success) {
                    setMidiMappings(listRes.data);
                    midiEngineRef.current.loadMappings(listRes.data);
                  }
                }}
                onCheckForUpdates={async () => {
                  const res = await window.tubedeckAPI?.checkForUpdates();
                  if (res?.success && res.data) {
                    settings.setUpdaterStatus(res.data);
                  }
                }}
                onDownloadUpdate={async () => {
                  const res = await window.tubedeckAPI?.downloadUpdate();
                  if (res?.success && res.data) {
                    settings.setUpdaterStatus(res.data);
                  }
                }}
                onInstallUpdate={async () => {
                  await window.tubedeckAPI?.installUpdate();
                }}
              />
            </div>
          </aside>
        </div>
      ) : null}

      {/* Modal: Guía Interactiva de Cabina */}
      <InteractiveGuideModal open={guideOpen} onClose={() => setGuideOpen(false)} />
    </div>
  );
}
