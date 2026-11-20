import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { Disc3, Radio, Sparkles, Monitor, CloudDownload } from 'lucide-react';
import type { Crate, DeckId, MidiMapping, YouTubeTrack } from '../shared/types';
import {
  AudioDspEngine,
  type AudioFxId,
  type CrossfaderCurve,
  type EqBand,
  type SamplerPadId
} from './audio/AudioDspEngine';
import { AudioOutputRouter } from './audio/AudioOutputRouter';
import { DualDeckMediaSync } from './audio/DualDeckMediaSync';
import { DeckPanel } from './components/DeckPanel';
import { HistoryAndCratesTab } from './components/HistoryAndCratesTab';
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
import { OverlayCompositor, type OverlayConfig } from './video/OverlayCompositor';
import { startOutputRtcSender } from './video/outputRtcBridge';
import { VideoFxPipeline, type VideoFxId } from './video/VideoFxPipeline';
import {
  WebGLVideoCompositor,
  type VideoCrossfaderMode,
  type VideoTransitionId
} from './video/WebGLVideoCompositor';

type BrowserTab = 'search' | 'queue' | 'history' | 'overlays' | 'settings';

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

  // Initialize displays, yt-dlp, updater, mix session, crates, MIDI, WebGL compositor & WebRTC bridge
  useEffect(() => {
    const api = window.tubedeckAPI;
    let unsubDisplays = () => {};
    let unsubClosed = () => {};
    let unsubUpdater = () => {};
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
      unsubDisplays = api.onDisplaysChanged((list) => {
        useSettingsStore.getState().setDisplays(list);
      });
      unsubClosed = api.onOutputClosed(() => {
        useSettingsStore.getState().setOutputOpen(false);
      });
      unsubUpdater = api.onUpdateStatus((status) => {
        useSettingsStore.getState().setUpdaterStatus(status);
      });
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
        autoGainDb: 0
      });

      const { dsp, decks, cueCtrls } = await ensureAudioInitialized();
      dsp.setDeckAutoGain(deck, 1);

      const [streamRes, metaRes] = await Promise.all([
        window.tubedeckAPI.resolveStream(track.videoId),
        window.tubedeckAPI.getTrackMeta(track.videoId)
      ]);

      if (!streamRes.success) {
        setDeckPatch(deck, { loading: false, error: streamRes.error });
        throw new Error(streamRes.error);
      }

      await decks[deck].load(streamRes.data);
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
        hotCues: cues,
        loop,
        bpm: savedMeta?.bpm ?? null,
        waveformPeaks: savedMeta?.waveformPeaks ?? null,
        mainCueSec: cueCtrls[deck].getMainCueSec()
      });
    },
    [ensureAudioInitialized, setDeckPatch]
  );

  // Main 60fps engine: unified Audio+Video fade, live RGB waveforms, Auto-Gain, Automix + Auto-Radio, WebGL master
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

      // 1. Unified smooth Audio + Video crossfade animation
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

      // 2. Track OSD trigger on dominant deck switch
      const nextDom: DeckId = effectiveVideoMix < 0.5 ? 'A' : 'B';
      if (nextDom !== activeDominantDeckRef.current) {
        activeDominantDeckRef.current = nextDom;
        const domTrack = stDecks[nextDom].track;
        if (domTrack) {
          overlayCompRef.current.triggerTrackOsd(domTrack.title, domTrack.channel, now);
        }
      }

      if (syncs) {
        (['A', 'B'] as DeckId[]).forEach((id) => {
          const s = syncs[id];
          if (!s.isPaused()) {
            s.syncDrift(now);
            void cueCtrls?.[id].checkLoopBoundary(s.getCurrentTime());
          }
        });

        // 3. Live RGB waveform buffer & Auto-Gain RMS normalizer (~22Hz)
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

        // 4. Energy history sample at 25Hz for automatic BPM detection
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

        // 5. UI playhead & session logging at 10Hz
        if (now - lastUiUpdate >= 100) {
          const dtMs = lastUiUpdate === 0 ? 100 : now - lastUiUpdate;
          lastUiUpdate = now;
          (['A', 'B'] as DeckId[]).forEach((id) => {
            const s = syncs[id];
            const currentTimeSec = s.getCurrentTime();
            const durationSec = s.getDuration();
            const playing = !s.isPaused();
            const prev = useDeckStore.getState().decks[id];
            if (
              Math.abs(prev.currentTimeSec - currentTimeSec) > 0.08 ||
              Math.abs(prev.durationSec - durationSec) > 0.2 ||
              prev.playing !== playing
            ) {
              setDeckPatch(id, { currentTimeSec, durationSec, playing });
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
                void window.tubedeckAPI?.logTrackPlay({
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
                });
              }
            } else if (!playing) {
              onAirMsRef.current[id] = 0;
            }
          });
        }

        // 6. Automix + YouTube Auto-Radio tick every 250ms
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
                  remainingSec,
                  isActivePlaying: deckState.playing,
                  isActiveEnded: isEnded,
                  isTransitioning
                },
                {
                  enabled: true,
                  preloadLeadSec: 30,
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
                    const res = await window.tubedeckAPI?.getRelatedTracks(seedVideoId, excludeIds);
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

      // 7. WebGL2 Master Video Compositor at 60fps
      if (compositorRef.current) {
        const ovCanvas = overlayCompRef.current.getCanvas();
        const ovCtx = ovCanvas.getContext('2d');
        if (ovCtx) {
          overlayCompRef.current.render(ovCtx, now, webcamVideoRef.current);
        }
        const domDeck = effectiveVideoMix < 0.5 ? 'A' : 'B';
        const domBpm = stDecks[domDeck].bpm ?? 120;
        const bands = fxPipelineRef.current.extractAudioBands(dsp?.getMasterAnalyser() ?? null);
        const fxUniforms = fxPipelineRef.current.getFxUniforms(
          stSettings.masterFx,
          bands,
          now / 1000,
          domBpm
        );

        compositorRef.current.renderFrame({
          mix: effectiveVideoMix,
          transition: stSettings.transition,
          videoA: syncs?.A.getVideoElement() ?? null,
          videoB: syncs?.B.getVideoElement() ?? null,
          overlayCanvas: ovCanvas,
          timeSec: now / 1000,
          audioBands: bands,
          fxUniforms
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
      setDeckPatch(deck, { pitchPercent, keyLock });
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

  // Global keyboard shortcuts & Web MIDI init
  useEffect(() => {
    const dispatchHotkey = (action: HotkeyAction) => {
      if (action === 'deckA.playPause') void handleTogglePlay('A');
      else if (action === 'deckB.playPause') void handleTogglePlay('B');
      else if (action === 'deckA.cue') void handleCueDown('A');
      else if (action === 'deckB.cue') void handleCueDown('B');
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

  const renderDeck = (deckId: DeckId) => (
    <DeckPanel
      key={deckId}
      deckId={deckId}
      liveRgbRef={liveRgbRef}
      onTogglePlay={handleTogglePlay}
      onSeek={handleSeek}
      onToggleCueMonitor={handleToggleCueMonitor}
      onPitchChange={handlePitchChange}
      onCueDown={handleCueDown}
      onCueUp={handleCueUp}
      onJogNudge={(d, mult) => decksSyncRef.current?.[d].setTemporaryBend(mult)}
      onJogScrub={(d, deltaSec) => {
        const sync = decksSyncRef.current?.[d];
        if (!sync) return;
        const target = Math.max(0, Math.min(sync.getDuration() || 9999, sync.getCurrentTime() + deltaSec));
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
      onTriggerSample={async (pad: SamplerPadId) => {
        const { dsp } = await ensureAudioInitialized();
        dsp.triggerSample(pad, 0.85);
      }}
      onDeckFxChange={async (d, fx: AudioFxId, enabled, wet) => {
        const { dsp } = await ensureAudioInitialized();
        const st = useDeckStore.getState().decks[d];
        dsp.setDeckFx(d, fx, enabled, wet, st.bpm);
        setDeckPatch(d, {
          audioFx: {
            ...st.audioFx,
            [fx]: { enabled, wet }
          }
        });
      }}
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
      onSync={async (d) => {
        const other: DeckId = d === 'A' ? 'B' : 'A';
        const selfSt = useDeckStore.getState().decks[d];
        const otherSt = useDeckStore.getState().decks[other];
        if (!selfSt.bpm || !otherSt.bpm) return;
        const targetBpm = otherSt.bpm * (1 + otherSt.pitchPercent / 100);
        const rate = bpmEnginesRef.current[d].computeSyncPlaybackRate(selfSt.bpm, targetBpm);
        const pitchPercent = Number(((rate - 1) * 100).toFixed(1));
        await handlePitchChange(d, pitchPercent, selfSt.keyLock);
      }}
    />
  );

  const upd = settings.updaterStatus;

  return (
    <div className="flex h-screen w-screen flex-col gap-2 bg-[#07090E] p-2 text-[#F8FAFC]">
      <audio ref={masterSinkAudioRef} className="hidden" />
      <audio ref={cueSinkAudioRef} className="hidden" />

      {/* Top Club Pro Status Bar */}
      <header className="flex h-8 shrink-0 items-center justify-between rounded-lg border border-[#1F2937] bg-[#0F141D] px-3 text-xs">
        <div className="flex items-center gap-2.5">
          <Disc3 className="h-4 w-4 text-[#00D4FF]" />
          <span className="font-bold tracking-wide text-[#F8FAFC]">TubeDeck VDJ</span>
          <span className="rounded border border-[#1F2937] bg-[#07090E] px-1.5 py-0.2 font-mono-tabular text-[10px] text-[#94A3B8]">
            v{upd?.currentVersion ?? '2.0.0'}
          </span>
        </div>

        <div className="flex items-center gap-2 text-[11px]">
          <span
            className={`inline-flex items-center gap-1 rounded px-2 py-0.5 font-semibold ${
              libraryStore.automixEnabled
                ? 'bg-[#10B981]/20 text-[#6EE7B7]'
                : 'bg-[#07090E] text-[#64748B]'
            }`}
          >
            <Sparkles className="h-3 w-3" />
            Automix {libraryStore.automixEnabled ? 'ON' : 'OFF'}
          </span>

          <span
            className={`inline-flex items-center gap-1 rounded px-2 py-0.5 font-semibold ${
              libraryStore.autoRadioEnabled
                ? 'bg-[#8B5CF6]/20 text-[#DDD6FE]'
                : 'bg-[#07090E] text-[#64748B]'
            }`}
          >
            <Radio className="h-3 w-3" />
            Radio YT {libraryStore.autoRadioEnabled ? 'ON' : 'OFF'}
          </span>

          <span
            className={`inline-flex items-center gap-1 rounded px-2 py-0.5 font-semibold ${
              settings.outputOpen
                ? 'bg-[#EF4444]/20 text-[#FCA5A5]'
                : 'bg-[#07090E] text-[#64748B]'
            }`}
          >
            <Monitor className="h-3 w-3" />
            {settings.outputOpen ? 'P2 ON AIR' : 'P2 OFF'}
          </span>

          {upd?.state === 'available' || upd?.state === 'downloaded' ? (
            <button
              type="button"
              onClick={() => setActiveTab('settings')}
              className="inline-flex items-center gap-1 rounded border border-[#10B981]/60 bg-[#10B981]/20 px-2 py-0.5 font-semibold text-[#6EE7B7] cursor-pointer"
            >
              <CloudDownload className="h-3 w-3" />
              {upd.state === 'downloaded'
                ? `Instalar v${upd.availableVersion}`
                : `Nueva v${upd.availableVersion}`}
            </button>
          ) : null}
        </div>
      </header>

      {/* Top Row: Deck A | Video Master & Previews | Deck B */}
      <div className="grid grid-cols-[1fr_410px_1fr] gap-2">
        {renderDeck('A')}

        <VideoPreviewBar
          masterCanvasRef={masterCanvasRef}
          attachPreviewContainer={attachPreviewContainer}
          videoMix={settings.videoMode === 'linked' ? mixerStore.crossfader : settings.videoMix}
          videoMode={settings.videoMode}
          autoDurationSec={settings.autoDurationSec}
          transition={settings.transition}
          activeFx={settings.masterFx.enabled}
          displays={settings.displays}
          selectedDisplayId={settings.selectedDisplayId}
          outputOpen={settings.outputOpen}
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
        />

        {renderDeck('B')}
      </div>

      {/* Middle Row: Mixer Center */}
      <MixerCenter
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

      {/* Bottom Row: Tabs */}
      <section className="flex flex-1 min-h-0 flex-col gap-2 rounded-xl border border-[#1F2937] bg-[#0F141D] p-2.5">
        <nav className="flex items-center gap-1.5 text-xs">
          {(
            [
              ['search', 'Buscador YouTube'],
              ['queue', `Cola (${libraryStore.queue.length})`],
              ['history', 'Historial & Crates'],
              ['overlays', 'Overlays & Visuales'],
              ['settings', 'Ajustes (Audio / Pantalla / MIDI)']
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setActiveTab(id)}
              className={`rounded-lg border px-3 py-1 font-semibold cursor-pointer ${
                activeTab === id
                  ? 'border-[#00D4FF] bg-[#00D4FF]/15 text-[#00D4FF]'
                  : 'border-[#1F2937] bg-[#07090E] text-[#94A3B8] hover:text-[#F8FAFC]'
              }`}
            >
              {label}
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
              crates={crates}
              onAddToCrate={async (crateId, track) => {
                await window.tubedeckAPI?.addTrackToCrate(crateId, track);
                const res = await window.tubedeckAPI?.listCrates();
                if (res?.success) setCrates(res.data);
              }}
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
              onRemoveQueueItem={(queueId) => {
                queueEngineRef.current.remove(queueId);
                libraryStore.setQueue(queueEngineRef.current.getQueue());
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
              onFetchSuggestionsNow={async () => {
                const activeDeck: DeckId = useMixerStore.getState().crossfader <= 0.5 ? 'A' : 'B';
                const seedTrack =
                  useDeckStore.getState().decks[activeDeck].track ??
                  useDeckStore.getState().decks[activeDeck === 'A' ? 'B' : 'A'].track;
                if (!seedTrack || !window.tubedeckAPI) {
                  libraryStore.setAutomixStatusNote(
                    'Carga primero una pista en Deck A o B para pedir recomendaciones similares.'
                  );
                  return;
                }
                const existingIds = [
                  seedTrack.videoId,
                  ...queueEngineRef.current.getQueue().map((q) => q.track.videoId)
                ];
                const res = await window.tubedeckAPI.getRelatedTracks(
                  seedTrack.videoId,
                  existingIds
                );
                if (res.success && res.data.length > 0) {
                  queueEngineRef.current.enqueueMany(res.data.slice(0, 3), 'youtube-radio');
                  libraryStore.setQueue(queueEngineRef.current.getQueue());
                  libraryStore.setAutomixStatusNote(
                    `Radio YT agregó ${Math.min(3, res.data.length)} canciones sugeridas.`
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
            />
          ) : null}

          {activeTab === 'overlays' ? (
            <OverlayControls
              config={settings.overlayConfig}
              onChange={handleOverlayConfigChange}
            />
          ) : null}

          {activeTab === 'settings' ? (
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
          ) : null}
        </div>
      </section>
    </div>
  );
}
