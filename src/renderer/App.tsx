import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactElement
} from 'react';
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  CloudDownload,
  Frame,
  Headphones,
  Keyboard,
  Maximize2,
  Minimize2,
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
  FeedbackSignal,
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
import { DeckPanel } from './components/DeckPanel';
import { HistoryAndCratesTab } from './components/HistoryAndCratesTab';
import { InteractiveGuideModal } from './components/InteractiveGuideModal';
import { TasteSetupModal } from './components/TasteSetupModal';
import { BrandMark } from './components/ui/BrandMark';
import { LocalLibraryTab } from './components/LocalLibraryTab';
import { MixerCenter } from './components/MixerCenter';
import { OverlayControls } from './components/OverlayControls';
import { QueueTab } from './components/QueueTab';
import { SearchBrowserTab } from './components/SearchBrowserTab';
import { SettingsTab } from './components/SettingsTab';
import { type RgbWaveSample } from './components/ui/RgbWaveformStrip';
import { VideoPreviewBar } from './components/VideoPreviewBar';
import { PhaseMeter } from './components/ui/PhaseMeter';
import { RecordButton } from './components/RecordButton';
import { MixRecorder, type MixRecordingKind } from './audio/MixRecorder';
import { HotkeyManager, type HotkeyAction } from './controllers/HotkeyManager';
import { MidiLearnEngine, type MidiLearnMode } from './controllers/MidiLearnEngine';
import { BpmAndWaveformEngine } from './dj/BpmAndWaveformEngine';
import {
  beatPhase,
  estimateBeatAnchor,
  phaseCorrectionSec,
  phaseOffsetBeats,
  type OnsetSample
} from './dj/BeatPhase';
import { ChromaAccumulator } from './dj/HarmonicKey';
import { CueLoopTempoController } from './dj/CueLoopTempoController';
import {
  type AutomixFadeType,
  DeckLoadSupersededError,
  QueueAndAutomixEngine
} from './dj/QueueAndAutomixEngine';
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

type BrowserTab = 'search' | 'local' | 'history';

const DOCK_HEIGHT_STORAGE_KEY = 'tubedeck.dockHeight';
const DOCK_MIN_HEIGHT = 120;

const BROWSER_TABS: Array<{ id: BrowserTab; getLabel: (localCount: number, qCount: number) => string }> = [
  { id: 'search', getLabel: () => 'Buscador YouTube' },
  { id: 'local', getLabel: (localCount) => `Biblioteca Local (${localCount})` },
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

function formatClock(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** Time until the on-air track ends, i.e. when the next queued song takes over. */
function NextCountdown(): ReactElement | null {
  const crossfader = useMixerStore((s) => s.crossfader);
  const active: DeckId = crossfader <= 0.5 ? 'A' : 'B';
  const remaining = useDeckStore((s) => {
    const d = s.decks[active];
    return d.track && d.playing && d.durationSec > 0
      ? Math.max(0, Math.round(d.durationSec - d.currentTimeSec))
      : -1;
  });
  if (remaining < 0) return null;
  return (
    <span
      className={`shrink-0 font-mono-tabular text-[11px] ${remaining <= 15 ? 'text-live' : 'text-muted'}`}
      title="Tiempo para que termine la canción al aire"
    >
      en {formatClock(remaining)}
    </span>
  );
}

type FeedbackTrack = Pick<YouTubeTrack, 'videoId' | 'title' | 'channel' | 'artists'>;

function sendFeedback(track: FeedbackTrack, signal: FeedbackSignal): void {
  void window.tubedeckAPI?.sendTrackFeedback?.({
    track: {
      videoId: track.videoId,
      title: track.title,
      channel: track.channel,
      ...(track.artists ? { artists: track.artists } : {})
    },
    signal
  });
}

/**
 * Implicit signals, like YouTube does: a radio suggestion dropped within 30 s of being
 * audible counts as a skip; any track heard for most of its length counts as completed.
 */
function reportImplicitFeedback(track: YouTubeTrack, audibleSec: number): void {
  const duration = track.durationSec > 0 ? track.durationSec : 210;
  if (audibleSec >= Math.max(60, duration * 0.6)) {
    sendFeedback(track, 'complete');
  } else if (track.recommendReason && audibleSec >= 3 && audibleSec < 30) {
    sendFeedback(track, 'skip');
  }
}

export function App(): ReactElement {
  const [activeTab, setActiveTab] = useState<BrowserTab>('search');
  // On-air state per deck (re-renders only when the A/B membership changes)
  const decksPlayingKey = useDeckStore(
    (s) => `${s.decks.A.playing ? 'A' : ''}${s.decks.B.playing ? 'B' : ''}`
  );
  const audibleKey = useMixerStore(
    (s) =>
      `${s.channels.A.fader > 0.05 && 1 - s.crossfader > 0.1 ? 'A' : ''}${
        s.channels.B.fader > 0.05 && s.crossfader > 0.1 ? 'B' : ''
      }`
  );
  /** Explicit browser-dock height in px; null = cabin keeps its natural height. */
  const [dockHeight, setDockHeight] = useState<number | null>(() => {
    try {
      const raw = window.localStorage.getItem(DOCK_HEIGHT_STORAGE_KEY);
      const n = raw ? Number(raw) : NaN;
      return Number.isFinite(n) && n > 0 ? n : null;
    } catch {
      return null;
    }
  });
  const dockSectionRef = useRef<HTMLElement | null>(null);
  const upNextRef = useRef<HTMLElement | null>(null);

  const updateDockHeight = useCallback((next: number | null) => {
    const clamped =
      next === null
        ? null
        : Math.round(Math.min(window.innerHeight - 180, Math.max(DOCK_MIN_HEIGHT, next)));
    setDockHeight(clamped);
    try {
      if (clamped === null) window.localStorage.removeItem(DOCK_HEIGHT_STORAGE_KEY);
      else window.localStorage.setItem(DOCK_HEIGHT_STORAGE_KEY, String(clamped));
    } catch {
      // storage unavailable: keep the in-memory height only
    }
  }, []);

  const handleDockResizeStart = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      const startY = e.clientY;
      const startHeight = dockSectionRef.current?.offsetHeight ?? 280;
      const target = e.currentTarget;
      target.setPointerCapture(e.pointerId);
      const onMove = (ev: PointerEvent) => updateDockHeight(startHeight + (startY - ev.clientY));
      const onUp = () => {
        target.removeEventListener('pointermove', onMove);
        target.removeEventListener('pointerup', onUp);
        target.removeEventListener('pointercancel', onUp);
      };
      target.addEventListener('pointermove', onMove);
      target.addEventListener('pointerup', onUp);
      target.addEventListener('pointercancel', onUp);
    },
    [updateDockHeight]
  );
  const [guideOpen, setGuideOpen] = useState(false);
  const [tasteSetupOpen, setTasteSetupOpen] = useState(false);
  const [tasteSetupFirstRun, setTasteSetupFirstRun] = useState(false);
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
  /** Total audible time of the current track per deck (not reset on pause) — used for skip/complete signals. */
  const audibleMsRef = useRef<Record<DeckId, number>>({ A: 0, B: 0 });
  /** Bumped on every load/eject so a slower, older load can never overwrite a newer one. */
  const loadSeqRef = useRef<Record<DeckId, number>>({ A: 0, B: 0 });
  const lastLoggedTrackRef = useRef<Record<DeckId, string>>({ A: '', B: '' });

  const dspRef = useRef<AudioDspEngine | null>(null);
  const routerRef = useRef<AudioOutputRouter | null>(null);
  const decksSyncRef = useRef<Record<DeckId, DualDeckMediaSync> | null>(null);
  const cueCtrlsRef = useRef<Record<DeckId, CueLoopTempoController> | null>(null);
  const chromaRef = useRef<Record<DeckId, ChromaAccumulator>>({
    A: new ChromaAccumulator(),
    B: new ChromaAccumulator()
  });
  const onsetRef = useRef<Record<DeckId, OnsetSample[]>>({ A: [], B: [] });
  const analysisTickRef = useRef<Record<DeckId, number>>({ A: 0, B: 0 });
  const keyFrameBufRef = useRef<Float32Array<ArrayBuffer> | null>(null);
  const beatMatchRef = useRef<(deck: DeckId) => Promise<void>>(async () => {});
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
      void Promise.all([
        api.getTasteSeeds?.(),
        api.getSetting?.<boolean>('tasteSetupDismissed', false)
      ]).then(([seedsRes, dismissedRes]) => {
        const hasSeeds = seedsRes?.success && seedsRes.data.length > 0;
        const dismissed = dismissedRes?.success && dismissedRes.data === true;
        if (!hasSeeds && !dismissed) {
          setTasteSetupFirstRun(true);
          setTasteSetupOpen(true);
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

  const handleDeckTrackFeedback = useCallback((deck: DeckId, signal: 'like' | 'dislike') => {
    const track = useDeckStore.getState().decks[deck].track;
    if (!track) return;
    sendFeedback(track, signal);
    if (signal === 'dislike') queueEngineRef.current.invalidateRadioPool();
    useLibraryStore
      .getState()
      .setAutomixStatusNote(
        signal === 'like'
          ? `Anotado: te gusta "${track.title}".`
          : `Anotado: no te gusta "${track.title}". La radio evitará canciones así.`
      );
  }, []);

  const loadTrackOntoDeck = useCallback(
    async (deck: DeckId, track: YouTubeTrack) => {
      const outgoing = useDeckStore.getState().decks[deck].track;
      const audibleSec = audibleMsRef.current[deck] / 1000;
      audibleMsRef.current[deck] = 0;
      if (outgoing && outgoing.source !== 'local' && outgoing.videoId !== track.videoId) {
        reportImplicitFeedback(outgoing, audibleSec);
      }
      const seq = (loadSeqRef.current[deck] += 1);
      const isStale = (): boolean => loadSeqRef.current[deck] !== seq;
      liveRgbRef.current[deck] = [];
      autoGainEmaRef.current[deck] = 0.42;

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
        keyShiftSemitones: 0,
        musicalKey: null,
        beatAnchorSec: null
      });

      const { dsp, decks, cueCtrls } = await ensureAudioInitialized();
      if (isStale()) throw new DeckLoadSupersededError(deck);
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

      if (isStale()) throw new DeckLoadSupersededError(deck);
      if (!streamRes.success) {
        setDeckPatch(deck, { loading: false, error: streamRes.error });
        throw new Error(streamRes.error);
      }

      const preferredQuality = useSettingsStore.getState().videoQuality;
      try {
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
      } catch (err) {
        if (isStale()) throw new DeckLoadSupersededError(deck);
        throw err;
      }
      if (isStale()) throw new DeckLoadSupersededError(deck);
      queueEngineRef.current.recordPlayed(track.videoId, track.title);
      useLibraryStore.getState().markTrackPlayed(track.videoId);

      useSettingsStore.getState().setActiveDeckQuality(deck, decks[deck].getActiveQuality());

      const savedMeta = metaRes.success ? metaRes.data : null;
      const cues = savedMeta?.hotCues ?? [];
      const loop = savedMeta?.loop ?? null;
      cueCtrls[deck].loadTrackState(track.videoId, cues, loop);
      energySamplesRef.current[deck] = [];
      onsetRef.current[deck] = [];
      chromaRef.current[deck].reset();

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
        musicalKey: savedMeta?.musicalKey ?? null,
        beatAnchorSec: savedMeta?.beatOffsetSec ?? null,
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
              const deckNow = useDeckStore.getState().decks[id];
              const vidNow = deckNow.track?.videoId;
              if (deckNow.beatAnchorSec === null) {
                const onsets = onsetRef.current[id];
                onsets.push({ trackTimeSec: syncs[id].getCurrentTime(), lowEnergy: bands.low });
                if (onsets.length > 600) onsets.shift();
                if (deckNow.bpm && onsets.length >= 250 && analysisTickRef.current[id] % 50 === 0) {
                  const anchor = estimateBeatAnchor(onsets, deckNow.bpm);
                  if (anchor !== null) {
                    setDeckPatch(id, { beatAnchorSec: anchor });
                    if (vidNow) void window.tubedeckAPI?.upsertTrackMeta({ videoId: vidNow, beatOffsetSec: anchor });
                  }
                }
              }
              analysisTickRef.current[id] += 1;
              if (deckNow.musicalKey === null && analysisTickRef.current[id] % 6 === 0) {
                const keyAnalyser = dsp.getDeckKeyAnalyser(id);
                if (keyAnalyser) {
                  if (!keyFrameBufRef.current || keyFrameBufRef.current.length !== keyAnalyser.frequencyBinCount) {
                    keyFrameBufRef.current = new Float32Array(new ArrayBuffer(keyAnalyser.frequencyBinCount * 4));
                  }
                  keyAnalyser.getFloatFrequencyData(keyFrameBufRef.current);
                  const acc = chromaRef.current[id];
                  acc.addFrame(keyFrameBufRef.current, dsp.getSampleRate());
                  if (acc.frames >= 80 && acc.frames % 20 === 0) {
                    const est = acc.estimate();
                    if (est && est.confidence >= 0.04) {
                      setDeckPatch(id, { musicalKey: est.camelot });
                      if (vidNow) void window.tubedeckAPI?.upsertTrackMeta({ videoId: vidNow, musicalKey: est.camelot });
                    }
                  }
                }
              }
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
            // A deck whose stream failed is never "playing", whatever the media element reports.
            const playing = !s.isPaused() && !useDeckStore.getState().decks[id].error;
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
              audibleMsRef.current[id] += dtMs;
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
                    if (fadeType !== 'cut' && fadeType !== 'backspin') {
                      void beatMatchRef.current(toDeck);
                    }
                    useLibraryStore.getState().setQueue(queueEngineRef.current.getQueue());
                  },
                  onTrackSkipped: (item, reason) => {
                    useLibraryStore
                      .getState()
                      .setAutomixStatusNote(`Saltado "${item.track.title}": ${reason}`);
                    useLibraryStore.getState().setQueue(queueEngineRef.current.getQueue());
                  },
                  fetchSuggestedTracks: async (seedVideoId, excludeIds) => {
                    const decksNow = useDeckStore.getState().decks;
                    const seedTitle = [decksNow.A.track, decksNow.B.track].find(
                      (t) => t?.videoId === seedVideoId
                    )?.title;
                    const res = await (window.tubedeckAPI?.getRecommendedTracks
                      ? window.tubedeckAPI.getRecommendedTracks(seedVideoId, excludeIds, seedTitle)
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
                accentColor: domDeck === 'A' ? '#22E1F0' : '#FF4FA8',
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
      queueEngineRef.current.claimDeckForManualLoad(deck, track);
      libraryStore.setQueue(queueEngineRef.current.getQueue());
      await loadTrackOntoDeck(deck, track);
      if (deck === (useMixerStore.getState().crossfader <= 0.5 ? 'A' : 'B')) {
        overlayCompRef.current.triggerTrackOsd(track.title, track.channel, performance.now());
      }
    } catch {
      // error already stored in deck state
    }
  };

  const handleEjectDeck = (deck: DeckId) => {
    const st = useDeckStore.getState().decks[deck];
    if (!st.track && !st.loading) return;
    const outgoing = st.track;
    const audibleSec = audibleMsRef.current[deck] / 1000;
    audibleMsRef.current[deck] = 0;
    if (outgoing && outgoing.source !== 'local') reportImplicitFeedback(outgoing, audibleSec);
    loadSeqRef.current[deck] += 1; // cancels any load still in flight on this deck
    decksSyncRef.current?.[deck].unload();
    liveRgbRef.current[deck] = [];
    queueEngineRef.current.releaseDeck(deck);
    libraryStore.setQueue(queueEngineRef.current.getQueue());
    setDeckPatch(deck, {
      track: null,
      loading: false,
      error: null,
      playing: false,
      currentTimeSec: 0,
      durationSec: 0,
      hotCues: [],
      loop: null,
      bpm: null,
      waveformPeaks: null,
      mainCueSec: 0,
      autoGainDb: 0,
      synced: false,
      bufferRatio: 0,
      customOsdTitle: null,
      keyShiftSemitones: 0,
      musicalKey: null,
      beatAnchorSec: null
    });
    if (outgoing) libraryStore.setAutomixStatusNote(`Deck ${deck} vacío: quitaste "${outgoing.title}".`);
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

  const mixRecorderRef = useRef<MixRecorder | null>(null);
  const [recording, setRecording] = useState(false);
  const [recordingSavedPath, setRecordingSavedPath] = useState<string | null>(null);
  const [recordingError, setRecordingError] = useState<string | null>(null);

  const getMixRecorder = (): MixRecorder => {
    if (!mixRecorderRef.current) {
      mixRecorderRef.current = new MixRecorder({
        start: async (kind) => {
          const res = await window.tubedeckAPI.startMixRecording(kind);
          if (!res.success) throw new Error(res.error);
          return res.data;
        },
        append: async (id, chunk) => {
          const res = await window.tubedeckAPI.appendMixRecording(id, chunk);
          if (!res.success) throw new Error(res.error);
        },
        stop: async (id) => {
          const res = await window.tubedeckAPI.stopMixRecording(id);
          if (!res.success) throw new Error(res.error);
          return res.data;
        }
      });
    }
    return mixRecorderRef.current;
  };

  const handleStartRecording = async (kind: MixRecordingKind) => {
    setRecordingError(null);
    setRecordingSavedPath(null);
    try {
      const { dsp } = await ensureAudioInitialized();
      const audio = dsp.getRecordingStream();
      if (!audio) throw new Error('El audio aún no está listo.');
      const video = kind === 'video' ? (masterCanvasRef.current?.captureStream(30) ?? null) : null;
      await getMixRecorder().start(kind, audio, video);
      setRecording(true);
    } catch (err) {
      setRecordingError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleStopRecording = async () => {
    try {
      const res = await getMixRecorder().stop();
      setRecordingSavedPath(res.filePath);
    } catch (err) {
      setRecordingError(err instanceof Error ? err.message : String(err));
    } finally {
      setRecording(false);
    }
  };

  const getRecordingElapsed = useCallback(() => mixRecorderRef.current?.elapsedSec() ?? 0, []);

  const getDeckTrackTime = useCallback(
    (deck: DeckId): number | null => decksSyncRef.current?.[deck].getCurrentTime() ?? null,
    []
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
      const { cueCtrls, decks } = await ensureAudioInitialized();
      cueCtrls[deck].setPitchPercent(pitchPercent, selfSt.keyLock);
      setDeckPatch(deck, { pitchPercent, keyLock: selfSt.keyLock, synced: true });

      // Phase: land this deck's beats on the other deck's beats (both grids known, both playing).
      if (
        selfSt.beatAnchorSec !== null &&
        otherSt.beatAnchorSec !== null &&
        !decks[deck].isPaused() &&
        !decks[other].isPaused()
      ) {
        const tSelf = decks[deck].getCurrentTime();
        const offset = phaseOffsetBeats(
          beatPhase(decks[other].getCurrentTime(), otherSt.bpm, otherSt.beatAnchorSec),
          beatPhase(tSelf, selfSt.bpm, selfSt.beatAnchorSec)
        );
        if (Math.abs(offset) > 0.03) {
          const target = Math.max(0, tSelf + phaseCorrectionSec(offset, selfSt.bpm));
          await decks[deck].seek(target);
          setDeckPatch(deck, { currentTimeSec: target });
        }
      }
    },
    [ensureAudioInitialized, setDeckPatch]
  );

  /** Automix beat-match: only when tempos are close enough to sync without chipmunking. */
  beatMatchRef.current = async (deck: DeckId) => {
    const other: DeckId = deck === 'A' ? 'B' : 'A';
    const a = useDeckStore.getState().decks[deck].bpm;
    const b = useDeckStore.getState().decks[other].bpm;
    if (!a || !b) return;
    const ratio = (b * (1 + useDeckStore.getState().decks[other].pitchPercent / 100)) / a;
    if (Math.abs(ratio - 1) <= 0.08) await handleSync(deck);
  };

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

  const renderDeck = (deckId: DeckId, layout: 'full' | 'strip' | 'controls' = 'full') => (
    <DeckPanel
      layout={layout}
      onAir={decksPlayingKey.includes(deckId) && audibleKey.includes(deckId)}
      offAirDimmed={
        !(decksPlayingKey.includes(deckId) && audibleKey.includes(deckId)) &&
        (['A', 'B'] as const).some(
          (d) => d !== deckId && decksPlayingKey.includes(d) && audibleKey.includes(d)
        )
      }
      onRetryLoad={(d) => {
        const t = useDeckStore.getState().decks[d].track;
        if (!t) return;
        queueEngineRef.current.claimDeckForManualLoad(d, t);
        void loadTrackOntoDeck(d, t).catch(() => {});
      }}
      onEject={handleEjectDeck}
      onTrackFeedback={handleDeckTrackFeedback}
      key={`${deckId}-${layout}`}
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
    <div className="flex h-screen w-screen flex-col gap-2 bg-ground p-2 text-ink">
      <audio ref={masterSinkAudioRef} className="hidden" />
      <audio ref={cueSinkAudioRef} className="hidden" />
      <audio
        ref={cuePreviewAudioRef}
        onEnded={() => stopCuePreview()}
        className="hidden"
      />

      {/* Top Pro Hardware Obsidian Header Bar */}
      <header className="flex h-10 shrink-0 items-center justify-between gap-2 rounded-lg border border-white/[0.06] bg-surface px-3 text-xs">
        <div className="flex shrink-0 items-center gap-2">
          <BrandMark className="h-5 w-5" />
          <span className="text-[13px] font-bold tracking-tight text-ink">Proyecta</span>
          <span className="rounded border border-white/[0.06] bg-ground px-1.5 py-0.5 font-mono-tabular text-[10px] text-muted">
            v{__APP_VERSION__}
          </span>

          <select
            aria-label="Calidad Video Global"
            value={settings.videoQuality}
            onChange={(e) => handleVideoQualityChange(e.target.value as VideoQualityPreference)}
            title="Calidad de video YouTube global (Auto evita congelamientos)"
            className="rounded border border-white/[0.06] bg-ground px-2 py-1 text-[10px] text-ink focus:border-white/25 focus:outline-none cursor-pointer"
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
            onClick={() => upNextRef.current?.focus()}
            title="Ir al panel Siguiente"
            className="flex min-w-0 max-w-md items-center gap-1.5 rounded-md border border-white/[0.06] bg-ground px-2.5 py-1 text-[11px] hover:border-white/20 cursor-pointer"
          >
            <ArrowRight className="h-3 w-3 shrink-0 text-live" />
            <span className="shrink-0 font-semibold text-faint">Siguiente:</span>
            {nextQueuedItem ? (
              <>
                <span className="truncate font-semibold text-ink">
                  {cleanTrackTitleForOsd(nextQueuedItem.track.title)}
                </span>
                <span
                  className={`shrink-0 rounded border px-1 text-[10px] font-bold ${
                    nextQueuedItem.track.source === 'local'
                      ? 'border-white/[0.1] bg-raised text-ink-soft'
                      : 'border-white/[0.08] bg-raised text-muted'
                  }`}
                >
                  {nextQueuedItem.track.source === 'local'
                    ? 'LOCAL'
                    : nextQueuedItem.source === 'youtube-radio'
                      ? 'RADIO'
                      : 'YT'}
                </span>
                <NextCountdown />
              </>
            ) : (
              <span className="truncate text-faint">
                {libraryStore.autoRadioEnabled ? 'Radio YT lista' : 'Cola vacía'}
              </span>
            )}
          </button>

          {libraryStore.previewingVideoId ? (
            <button
              type="button"
              onClick={stopCuePreview}
              className="inline-flex items-center gap-1 rounded border border-live/50 bg-live/15 px-2 py-0.5 text-[10px] font-semibold text-live cursor-pointer"
              title="Detener pre-escucha por audífonos"
            >
              <Headphones className="h-3 w-3" />
              Detener CUE
              <X className="h-3 w-3" />
            </button>
          ) : null}

          {settings.qualityNotice ? (
            <div className="flex items-center gap-1 rounded border border-white/[0.12] bg-raised px-2 py-0.5 text-[10px] text-deck-b">
              <AlertTriangle className="h-3 w-3 shrink-0" />
              <span className="max-w-44 truncate">{settings.qualityNotice}</span>
              <button
                type="button"
                aria-label="Cerrar aviso de calidad"
                onClick={() => settings.setQualityNotice(null)}
                className="text-muted hover:text-ink cursor-pointer"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ) : null}
        </div>

        {/* Right: Live Badges + KEYS Overlay Toggle + Drawers */}
        <div className="flex shrink-0 items-center gap-1.5 text-[11px]">
          <RecordButton
            recording={recording}
            getElapsedSec={getRecordingElapsed}
            onStart={(kind) => void handleStartRecording(kind)}
            onStop={() => void handleStopRecording()}
            lastSavedPath={recordingSavedPath}
            onReveal={(p) => void window.tubedeckAPI.revealMixRecording(p)}
            onDismissSaved={() => {
              setRecordingSavedPath(null);
              setRecordingError(null);
            }}
            error={recordingError}
          />
          <span
            className={`hidden xl:inline-flex items-center gap-1 rounded border border-white/[0.06] px-2 py-0.5 font-semibold ${
              libraryStore.automixEnabled
                ? 'bg-live/15 text-live'
                : 'bg-ground text-faint'
            }`}
          >
            <Sparkles className="h-3 w-3" />
            Automix
          </span>

          <span
            className={`hidden xl:inline-flex items-center gap-1 rounded border border-white/[0.06] px-2 py-0.5 font-semibold ${
              libraryStore.autoRadioEnabled
                ? 'bg-raised text-ink-soft'
                : 'bg-ground text-faint'
            }`}
          >
            <Radio className="h-3 w-3" />
            Radio
          </span>

          <span
            className={`inline-flex items-center gap-1 rounded border border-white/[0.06] px-2 py-0.5 font-semibold ${
              settings.outputOpen
                ? 'bg-live/15 text-live'
                : 'bg-ground text-faint'
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
              className="inline-flex items-center gap-1 rounded border border-live/60 bg-live/15 px-2 py-1 font-semibold text-live cursor-pointer"
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
                ? 'border-white/30 bg-raised-2 text-ink'
                : 'border-white/[0.06] bg-ground text-muted hover:text-ink'
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
                ? 'border-white/30 bg-raised-2 text-ink'
                : 'border-white/[0.06] bg-ground text-muted hover:text-ink'
            }`}
          >
            <Frame className="h-3.5 w-3.5" />
            Marcos
          </button>

          <button
            type="button"
            onClick={() => setGuideOpen(true)}
            className="inline-flex items-center gap-1 rounded border border-white/[0.06] bg-ground px-2.5 py-1 font-semibold text-muted hover:border-white/20 hover:text-ink cursor-pointer"
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
                ? 'border-white/30 bg-raised-2 text-ink'
                : 'border-white/[0.06] bg-ground text-muted hover:text-ink'
            }`}
          >
            <Sliders className="h-3.5 w-3.5" />
            Ajustes
          </button>
        </div>
      </header>

      {/* Cabin (decks, video, FX, mixer). Scrolls only when the browser dock is enlarged. */}
      <div
        className={`flex min-h-0 flex-col gap-2 overflow-y-auto ${dockHeight === null ? '' : 'flex-1'}`}
      >
      {/* Stage: Preview A | program on air | Preview B (the broadcast switcher) */}
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

      {/* Camera rows: one line per deck, identity + waveform + key/tempo/clock */}
      <div className="flex flex-col gap-1.5">
        {renderDeck('A', 'strip')}
        {renderDeck('B', 'strip')}
      </div>

      {/* Hands: Deck A controls | Mixer | Deck B controls */}
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(560px,32%)_minmax(0,1fr)] gap-2">
        {renderDeck('A', 'controls')}
        <MixerCenter
          phaseMeter={<PhaseMeter getTrackTime={getDeckTrackTime} />}
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

        {renderDeck('B', 'controls')}
      </div>

      </div>

      {/* Drag handle between cabin and browser dock */}
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Redimensionar navegador"
        aria-valuenow={dockHeight ?? undefined}
        tabIndex={0}
        title="Arrastra para cambiar el alto del navegador · doble clic para restablecer"
        onPointerDown={handleDockResizeStart}
        onDoubleClick={() => updateDockHeight(null)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const base = dockHeight ?? dockSectionRef.current?.offsetHeight ?? 280;
            updateDockHeight(base + (e.key === 'ArrowUp' ? 40 : -40));
          } else if (e.key === 'Home' || e.key === 'Escape') {
            updateDockHeight(null);
          }
        }}
        className="group -my-1.5 flex h-2 shrink-0 cursor-row-resize items-center justify-center rounded focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30"
      >
        <span className="h-[3px] w-12 rounded-full bg-white/[0.08] transition-colors duration-150 group-hover:bg-white/30 group-focus-visible:bg-white/30" />
      </div>

      {/* Bottom Row: Browser tabs + persistent "Siguiente" (Up Next) column */}
      <section
        ref={dockSectionRef}
        style={dockHeight === null ? undefined : { height: dockHeight }}
        className={`flex min-h-0 flex-col gap-2 rounded-xl border border-white/[0.06] bg-surface p-2.5 ${
          dockHeight === null ? 'min-h-[220px] flex-1' : 'shrink-0'
        }`}
      >
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(300px,340px)] gap-2.5 2xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-h-0 min-w-0 flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
        <nav className="relative grid w-fit grid-cols-3 rounded-lg border border-white/[0.06] bg-ground p-0.5 text-xs">
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0.5 left-0.5 rounded-md bg-raised-2 ring-1 ring-white/[0.12] transition-transform duration-150 ease-[cubic-bezier(0.16,1,0.3,1)]"
            style={{
              width: 'calc(33.333% - 2px)',
              transform: `translateX(${activeTabIndex * 100}%)`
            }}
          />
          {BROWSER_TABS.map(({ id, getLabel }) => (
            <button
              key={id}
              type="button"
              onClick={() => setActiveTab(id)}
              className={`relative z-10 whitespace-nowrap rounded-md px-3 py-1 font-semibold cursor-pointer ${
                activeTab === id ? 'text-ink' : 'text-muted hover:text-ink-soft'
              }`}
            >
              {getLabel(libraryStore.localTracks.length, libraryStore.queue.length)}
            </button>
          ))}
        </nav>
        <button
          type="button"
          onClick={() =>
            updateDockHeight(dockHeight === null ? Math.round(window.innerHeight * 0.58) : null)
          }
          aria-pressed={dockHeight !== null}
          className="inline-flex items-center gap-1.5 rounded-md border border-white/[0.06] bg-ground px-2.5 py-1 text-[11px] font-medium text-muted transition-colors duration-150 hover:border-white/20 hover:text-ink cursor-pointer"
          title={dockHeight === null ? 'Dar más alto al navegador' : 'Volver a la cabina completa'}
        >
          {dockHeight === null ? <Maximize2 className="h-3.5 w-3.5" /> : <Minimize2 className="h-3.5 w-3.5" />}
          {dockHeight === null ? 'Ampliar navegador' : 'Cabina completa'}
        </button>
        </div>

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
              onSaveFolder={async (folderPath) => {
                const res = await window.tubedeckAPI?.addLocalFolderPath(folderPath);
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
                upNextRef.current?.focus();
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
        </div>

        <aside
          ref={upNextRef}
          tabIndex={-1}
          aria-label="Siguiente"
          className="flex min-h-0 min-w-0 flex-col rounded-lg focus:outline-none focus-visible:ring-1 focus-visible:ring-white/25"
        >
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
              onOpenTasteSetup={() => {
                setTasteSetupFirstRun(false);
                setTasteSetupOpen(true);
              }}
              onTrackFeedback={(queueId, signal) => {
                const item = queueEngineRef.current.getQueue().find((q) => q.queueId === queueId);
                if (!item) return;
                sendFeedback(item.track, signal);
                if (signal !== 'like') queueEngineRef.current.invalidateRadioPool();
                if (signal === 'dislike') {
                  queueEngineRef.current.remove(queueId);
                  libraryStore.setAutomixStatusNote(
                    `Quitada "${item.track.title}". La radio pondrá menos canciones así.`
                  );
                } else if (signal === 'block-channel') {
                  const channel = item.track.channel;
                  for (const q of queueEngineRef.current.getQueue()) {
                    if (q.source === 'youtube-radio' && q.track.channel === channel) {
                      queueEngineRef.current.remove(q.queueId);
                    }
                  }
                  libraryStore.setAutomixStatusNote(`No se recomendará más ${channel}.`);
                } else {
                  libraryStore.setAutomixStatusNote(`Anotado: te gusta "${item.track.title}".`);
                }
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
                  ? window.tubedeckAPI.getRecommendedTracks(seedTrack.videoId, existingIds, seedTrack.title)
                  : window.tubedeckAPI.getRelatedTracks(seedTrack.videoId, existingIds));
                if (res.success && res.data.length > 0) {
                  queueEngineRef.current.enqueueMany(res.data.slice(0, 3), 'youtube-radio');
                  libraryStore.setQueue(queueEngineRef.current.getQueue());
                  libraryStore.setAutomixStatusNote(
                    `Radio YT agregó ${Math.min(3, res.data.length)} canciones según tus gustos.`
                  );
                }
              }}
            />
        </aside>
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
            className="animate-drawer-in flex h-full w-[440px] max-w-[95vw] flex-col border-l border-white/[0.08] bg-surface/95 backdrop-blur-md shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
              <div className="flex items-center gap-2">
                <Frame className="h-4 w-4 text-muted" />
                <h2 className="text-sm font-bold text-ink">Marcos y Overlays en Vivo</h2>
              </div>
              <button
                type="button"
                aria-label="Cerrar Marcos"
                onClick={() => setFramesDrawerOpen(false)}
                className="rounded-lg border border-white/[0.06] bg-raised p-1 text-muted hover:text-ink cursor-pointer"
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
            className="animate-drawer-in flex h-full w-[540px] max-w-[95vw] flex-col border-l border-white/[0.08] bg-surface/95 backdrop-blur-md shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
              <div className="flex items-center gap-2">
                <Sliders className="h-4 w-4 text-muted" />
                <h2 className="text-sm font-bold text-ink">
                  Ajustes (Audio / Pantalla / MIDI / Actualizaciones)
                </h2>
              </div>
              <button
                type="button"
                aria-label="Cerrar Ajustes"
                onClick={() => setSettingsDrawerOpen(false)}
                className="rounded-lg border border-white/[0.06] bg-raised p-1 text-muted hover:text-ink cursor-pointer"
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

      <TasteSetupModal
        open={tasteSetupOpen}
        firstRun={tasteSetupFirstRun}
        onClose={() => {
          setTasteSetupOpen(false);
          if (tasteSetupFirstRun) {
            void window.tubedeckAPI?.setSetting?.('tasteSetupDismissed', true);
          }
        }}
        onSaved={(seeds) => {
          queueEngineRef.current.invalidateRadioPool();
          useLibraryStore
            .getState()
            .setAutomixStatusNote(`Radio ajustada con ${seeds.length} canciones de referencia.`);
        }}
      />
    </div>
  );
}
