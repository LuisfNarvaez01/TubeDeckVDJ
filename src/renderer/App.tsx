import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import type { DeckId, YouTubeTrack } from '../shared/types';
import { AudioDspEngine, type CrossfaderCurve, type EqBand } from './audio/AudioDspEngine';
import { AudioOutputRouter } from './audio/AudioOutputRouter';
import { DualDeckMediaSync } from './audio/DualDeckMediaSync';
import { DeckPanel } from './components/DeckPanel';
import { MixerCenter } from './components/MixerCenter';
import { OverlayControls } from './components/OverlayControls';
import { QueueTab } from './components/QueueTab';
import { SearchBrowserTab } from './components/SearchBrowserTab';
import { SettingsTab } from './components/SettingsTab';
import { VideoPreviewBar } from './components/VideoPreviewBar';
import { BpmAndWaveformEngine } from './dj/BpmAndWaveformEngine';
import { CueLoopTempoController } from './dj/CueLoopTempoController';
import { QueueAndAutomixEngine } from './dj/QueueAndAutomixEngine';
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

type BrowserTab = 'search' | 'queue' | 'history' | 'settings';

export function App(): ReactElement {
  const [activeTab, setActiveTab] = useState<BrowserTab>('search');

  const dspRef = useRef<AudioDspEngine | null>(null);
  const routerRef = useRef<AudioOutputRouter | null>(null);
  const decksSyncRef = useRef<Record<DeckId, DualDeckMediaSync> | null>(null);
  const cueCtrlsRef = useRef<Record<DeckId, CueLoopTempoController> | null>(null);
  const bpmEnginesRef = useRef<Record<DeckId, BpmAndWaveformEngine>>({
    A: new BpmAndWaveformEngine(),
    B: new BpmAndWaveformEngine()
  });
  const energySamplesRef = useRef<Record<DeckId, number[]>>({ A: [], B: [] });
  const queueEngineRef = useRef(new QueueAndAutomixEngine());

  const masterCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const compositorRef = useRef<WebGLVideoCompositor | null>(null);
  const fxPipelineRef = useRef(new VideoFxPipeline());
  const overlayCompRef = useRef(new OverlayCompositor(1280, 720));
  const webcamVideoRef = useRef<HTMLVideoElement | null>(null);
  const webcamStreamRef = useRef<MediaStream | null>(null);

  const autoAnimRef = useRef<{
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
          .setAudioNotice(`Dispositivo desconectado (${parts.join(' / ')}): revertido a salida predeterminada.`);
      });
    }

    if (!cueCtrlsRef.current) {
      const persistMeta = (videoId: string, hotCues: ReturnType<CueLoopTempoController['getHotCues']>, loop: ReturnType<CueLoopTempoController['getLoop']>) => {
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

  // Initialize displays, yt-dlp status, WebGL compositor & WebRTC bridge
  useEffect(() => {
    const api = window.tubedeckAPI;
    let unsubDisplays = () => {};
    let unsubClosed = () => {};
    let rtcHandle: ReturnType<typeof startOutputRtcSender> | null = null;

    if (api) {
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
      unsubDisplays = api.onDisplaysChanged((list) => {
        useSettingsStore.getState().setDisplays(list);
      });
      unsubClosed = api.onOutputClosed(() => {
        useSettingsStore.getState().setOutputOpen(false);
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
      rtcHandle?.dispose();
      compositorRef.current?.dispose();
      compositorRef.current = null;
    };
  }, []);

  const loadTrackOntoDeck = useCallback(
    async (deck: DeckId, track: YouTubeTrack) => {
      setDeckPatch(deck, {
        track,
        loading: true,
        error: null,
        playing: false,
        currentTimeSec: 0,
        hotCues: [],
        loop: null,
        bpm: null,
        waveformPeaks: null
      });

      const { decks, cueCtrls } = await ensureAudioInitialized();
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
        waveformPeaks: savedMeta?.waveformPeaks ?? null
      });
    },
    [ensureAudioInitialized, setDeckPatch]
  );

  // Main 60fps loop: video compositor, overlay canvas, drift sync, loop boundaries, BPM energy sampling & Automix tick
  useEffect(() => {
    let rafId = 0;
    let lastUiUpdate = 0;
    let lastEnergySample = 0;
    let lastAutomixTick = 0;

    const tick = (now: number) => {
      const syncs = decksSyncRef.current;
      const cueCtrls = cueCtrlsRef.current;
      const dsp = dspRef.current;
      const stSettings = useSettingsStore.getState();
      const stMixer = useMixerStore.getState();
      const stDecks = useDeckStore.getState().decks;

      // Auto-timed video transition step
      let effectiveVideoMix = stSettings.videoMode === 'linked' ? stMixer.crossfader : stSettings.videoMix;
      if (autoAnimRef.current?.active && compositorRef.current) {
        const anim = autoAnimRef.current;
        const progress = Math.min(1, (now - anim.startMs) / anim.durationMs);
        effectiveVideoMix = compositorRef.current.stepAutoTransition(progress, anim.fromSide);
        useSettingsStore.getState().setVideoMix(effectiveVideoMix);
        if (progress >= 1) {
          autoAnimRef.current.active = false;
        }
      }

      // Track OSD trigger on dominant deck switch
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

        // Energy history sample at 25Hz for BPM detection
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

        // UI clock & playhead updates at 10Hz
        if (now - lastUiUpdate >= 100) {
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
          });
        }

        // Automix tick every 250ms
        if (now - lastAutomixTick >= 250) {
          lastAutomixTick = now;
          const activeDeck = stMixer.crossfader <= 0.5 ? 'A' : 'B';
          const deckState = useDeckStore.getState().decks[activeDeck];
          const remainingSec = Math.max(0, deckState.durationSec - deckState.currentTimeSec);
          const lib = useLibraryStore.getState();
          if (lib.automixEnabled && deckState.track && deckState.durationSec > 0) {
            void queueEngineRef.current
              .tick(
                activeDeck,
                remainingSec,
                deckState.playing,
                {
                  enabled: true,
                  preloadLeadSec: 30,
                  crossfadeDurationSec: 8,
                  outroTriggerSec: 8
                },
                {
                  loadDeck: async (targetDeck, track) => {
                    await loadTrackOntoDeck(targetDeck, track);
                    useLibraryStore.getState().setQueue(queueEngineRef.current.getQueue());
                  },
                  startTransition: async (fromDeck, toDeck, durationSec) => {
                    const targetSync = decksSyncRef.current?.[toDeck];
                    if (targetSync) {
                      await targetSync.play();
                      setDeckPatch(toDeck, { playing: true });
                    }
                    autoAnimRef.current = {
                      active: true,
                      startMs: performance.now(),
                      durationMs: durationSec * 1000,
                      fromSide: fromDeck
                    };
                    const targetCross = toDeck === 'B' ? 1 : 0;
                    dspRef.current?.setCrossfader(targetCross);
                    useMixerStore.getState().setCrossfader(targetCross);
                    useLibraryStore.getState().setQueue(queueEngineRef.current.getQueue());
                  },
                  onTrackSkipped: (item, reason) => {
                    useLibraryStore
                      .getState()
                      .setAutomixStatusNote(`Saltado "${item.track.title}": ${reason}`);
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

      // Render Overlay + WebGL Master Compositor at 60fps
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
  }, [loadTrackOntoDeck, setDeckPatch]);

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

  const handleTogglePlay = async (deck: DeckId) => {
    const { decks } = await ensureAudioInitialized();
    const sync = decks[deck];
    if (sync.isPaused()) {
      await sync.play();
      setDeckPatch(deck, { playing: true });
    } else {
      sync.pause();
      setDeckPatch(deck, { playing: false });
    }
  };

  const handleSeek = async (deck: DeckId, timeSec: number) => {
    const sync = decksSyncRef.current?.[deck];
    if (!sync) return;
    await sync.seek(timeSec);
    setDeckPatch(deck, { currentTimeSec: timeSec });
  };

  const handleToggleCueMonitor = async (deck: DeckId) => {
    const { dsp } = await ensureAudioInitialized();
    const next = !useDeckStore.getState().decks[deck].cueEnabled;
    dsp.setCueEnabled(deck, next);
    setDeckPatch(deck, { cueEnabled: next });
  };

  const handlePitchChange = async (deck: DeckId, pitchPercent: number, keyLock: boolean) => {
    const { cueCtrls } = await ensureAudioInitialized();
    cueCtrls[deck].setPitchPercent(pitchPercent, keyLock);
    setDeckPatch(deck, { pitchPercent, keyLock });
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

  return (
    <div className="flex h-screen w-screen flex-col gap-2.5 bg-[#0B0E14] p-2.5 text-[#F1F5F9]">
      <audio ref={masterSinkAudioRef} className="hidden" />
      <audio ref={cueSinkAudioRef} className="hidden" />

      {/* Top Row: Deck A | Video Master & Previews | Deck B */}
      <div className="grid grid-cols-[1fr_440px_1fr] gap-2.5">
        <DeckPanel
          deckId="A"
          onTogglePlay={handleTogglePlay}
          onSeek={handleSeek}
          onToggleCueMonitor={handleToggleCueMonitor}
          onPitchChange={handlePitchChange}
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
          onTriggerAutoTransition={() => {
            const curMix =
              settings.videoMode === 'linked' ? mixerStore.crossfader : settings.videoMix;
            autoAnimRef.current = {
              active: true,
              startMs: performance.now(),
              durationMs: settings.autoDurationSec * 1000,
              fromSide: curMix < 0.5 ? 'A' : 'B'
            };
            if (settings.videoMode === 'linked') {
              settings.setVideoMode('auto-timed');
            }
          }}
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

        <DeckPanel
          deckId="B"
          onTogglePlay={handleTogglePlay}
          onSeek={handleSeek}
          onToggleCueMonitor={handleToggleCueMonitor}
          onPitchChange={handlePitchChange}
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
      </div>

      {/* Middle Row: Mixer + Overlays */}
      <div className="grid grid-cols-[1fr_auto] items-center gap-2.5">
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
        />
        <OverlayControls config={settings.overlayConfig} onChange={handleOverlayConfigChange} />
      </div>

      {/* Bottom Row: Tabs */}
      <section className="flex flex-1 min-h-0 flex-col gap-2 rounded-xl border border-[#1F2735] bg-[#131822] p-2.5">
        <nav className="flex items-center gap-1.5 text-xs">
          {(
            [
              ['search', 'Buscador YouTube'],
              ['queue', `Cola (${libraryStore.queue.length})`],
              ['history', 'Historial & Crates'],
              ['settings', 'Ajustes (Audio / Pantalla / MIDI)']
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setActiveTab(id)}
              className={`rounded-lg border px-3 py-1 font-medium cursor-pointer ${
                activeTab === id
                  ? 'border-[#00D4FF] bg-[#00D4FF]/15 text-[#00D4FF]'
                  : 'border-[#1F2735] bg-[#0B0E14] text-[#94A3B8] hover:text-[#F1F5F9]'
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
                queueEngineRef.current.enqueueMany(tracks);
                libraryStore.setQueue(queueEngineRef.current.getQueue());
              }}
            />
          ) : null}

          {activeTab === 'queue' ? (
            <QueueTab
              onLoadFromQueue={async (deck, queueId) => {
                const item = queueEngineRef.current.getQueue().find((q) => q.queueId === queueId);
                if (!item) return;
                queueEngineRef.current.remove(queueId);
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
            />
          ) : null}

          {activeTab === 'history' ? (
            <div className="flex h-full items-center justify-center rounded-lg border border-[#1F2735] bg-[#0B0E14] text-xs text-[#94A3B8]">
              Historial de sesiones, Crates y Exportación (JSON/CSV/M3U) se integran en Fase 4.
            </div>
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
            />
          ) : null}
        </div>
      </section>
    </div>
  );
}
