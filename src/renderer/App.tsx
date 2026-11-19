import { useCallback, useEffect, useRef, type ReactElement } from 'react';
import type { DeckId, YouTubeTrack } from '../shared/types';
import { AudioDspEngine, type CrossfaderCurve, type EqBand } from './audio/AudioDspEngine';
import { DualDeckMediaSync } from './audio/DualDeckMediaSync';
import { DeckPanel } from './components/DeckPanel';
import { MixerCenter } from './components/MixerCenter';
import { SearchBrowserTab } from './components/SearchBrowserTab';
import { useDeckStore } from './store/useDeckStore';
import { useMixerStore } from './store/useMixerStore';

export function App(): ReactElement {
  const dspRef = useRef<AudioDspEngine | null>(null);
  const decksSyncRef = useRef<Record<DeckId, DualDeckMediaSync> | null>(null);
  const masterSinkAudioRef = useRef<HTMLAudioElement | null>(null);
  const cueSinkAudioRef = useRef<HTMLAudioElement | null>(null);
  const previewContainersRef = useRef<Record<DeckId, HTMLDivElement | null>>({ A: null, B: null });

  const setDeckPatch = useDeckStore((s) => s.setDeckPatch);
  const mixerStore = useMixerStore();

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
      void masterSinkAudioRef.current.play().catch(() => {});
    }
    if (cueSinkAudioRef.current && cueSinkAudioRef.current.srcObject !== cueDest.stream) {
      cueSinkAudioRef.current.srcObject = cueDest.stream;
      void cueSinkAudioRef.current.play().catch(() => {});
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

    return { dsp, decks: decksSyncRef.current };
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

  useEffect(() => {
    let rafId = 0;
    let lastUiUpdate = 0;

    const tick = (now: number) => {
      const syncs = decksSyncRef.current;
      if (syncs) {
        (['A', 'B'] as DeckId[]).forEach((id) => {
          const s = syncs[id];
          if (!s.isPaused()) {
            s.syncDrift(now);
          }
        });

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
      }
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(rafId);
      decksSyncRef.current?.A.dispose();
      decksSyncRef.current?.B.dispose();
      void dspRef.current?.dispose();
    };
  }, [setDeckPatch]);

  const handleLoadToDeck = async (deck: DeckId, track: YouTubeTrack) => {
    setDeckPatch(deck, { track, loading: true, error: null, playing: false, currentTimeSec: 0 });
    try {
      const { decks } = await ensureAudioInitialized();
      const res = await window.tubedeckAPI.resolveStream(track.videoId);
      if (!res.success) {
        setDeckPatch(deck, { loading: false, error: res.error });
        return;
      }

      await decks[deck].load(res.data);
      const st = useDeckStore.getState().decks[deck];
      decks[deck].setPlaybackRate(1 + st.pitchPercent / 100, st.keyLock);
      setDeckPatch(deck, {
        loading: false,
        durationSec: decks[deck].getDuration() || track.durationSec,
        currentTimeSec: 0
      });
    } catch (err) {
      setDeckPatch(deck, {
        loading: false,
        error: err instanceof Error ? err.message : 'Error cargando stream'
      });
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
    const { decks } = await ensureAudioInitialized();
    decks[deck].setPlaybackRate(1 + pitchPercent / 100, keyLock);
    setDeckPatch(deck, { pitchPercent, keyLock });
  };

  return (
    <div className="flex h-screen w-screen flex-col gap-3 bg-[#0B0E14] p-3 text-[#F1F5F9]">
      <audio ref={masterSinkAudioRef} className="hidden" />
      <audio ref={cueSinkAudioRef} className="hidden" />

      <div className="grid grid-cols-[1fr_340px_1fr] gap-3">
        <DeckPanel
          deckId="A"
          onTogglePlay={handleTogglePlay}
          onSeek={handleSeek}
          onToggleCueMonitor={handleToggleCueMonitor}
          onPitchChange={handlePitchChange}
          attachPreviewContainer={attachPreviewContainer}
        />

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

        <DeckPanel
          deckId="B"
          onTogglePlay={handleTogglePlay}
          onSeek={handleSeek}
          onToggleCueMonitor={handleToggleCueMonitor}
          onPitchChange={handlePitchChange}
          attachPreviewContainer={attachPreviewContainer}
        />
      </div>

      <section className="flex-1 min-h-0 rounded-xl border border-[#1F2735] bg-[#131822] p-3">
        <SearchBrowserTab onLoadToDeck={handleLoadToDeck} />
      </section>
    </div>
  );
}
