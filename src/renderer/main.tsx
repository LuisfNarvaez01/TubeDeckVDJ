import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { OutputWindowView } from './components/OutputWindowView';
import { ProyectaSplash } from './components/ProyectaSplash';
import { AccountSignIn } from './components/AccountGate';
import { useAccountStore } from './store/useAccountStore';
import type { AccountStatus } from '../shared/types';
import './styles/index.css';

const role = new URLSearchParams(window.location.search).get('role');

/** The logo plays at least this long; then the app opens in a wave. */
const MIN_SPLASH_MS = 1500;
/** Waiting for the account check (renewal or Lantify POS on this computer) at most this long. */
const MAX_CHECK_MS = 9000;
const REVEAL_MS = 950;

/**
 * Proyecta opens with the business's Lantify account. At start: the animated logo while the
 * stored licence is renewed (or Lantify POS on this computer signs Proyecta in); signed in,
 * the app opens in a wave from the record; signed out, the sign-in card shows under the logo.
 * Once the app is open it is never closed for an account change: the music keeps playing.
 */
function Root(): React.ReactElement {
  const status = useAccountStore((s) => s.status);
  const setStatus = useAccountStore((s) => s.setStatus);
  const [minDone, setMinDone] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const [phase, setPhase] = useState<'splash' | 'reveal' | 'open'>('splash');
  const opened = useRef(false);

  useEffect(() => {
    const api = window.tubedeckAPI;
    const off = api?.onAccountEvent?.((s: AccountStatus) => setStatus(s));
    void api?.accountStatus?.().then((res) => {
      if (res.success) setStatus(res.data);
    });
    const a = window.setTimeout(() => setMinDone(true), MIN_SPLASH_MS);
    const b = window.setTimeout(() => setTimedOut(true), MAX_CHECK_MS);
    return () => {
      off?.();
      window.clearTimeout(a);
      window.clearTimeout(b);
    };
  }, [setStatus]);

  const signedIn = status?.state === 'signed-in';
  useEffect(() => {
    if (opened.current || !minDone || !signedIn) return;
    opened.current = true;
    setPhase('reveal');
    const t = window.setTimeout(() => setPhase('open'), REVEAL_MS);
    return () => window.clearTimeout(t);
  }, [minDone, signedIn]);

  const checking = !status || (status.state === 'checking' && !timedOut);
  const needsSignIn = minDone && !checking && !signedIn;

  return (
    <>
      {phase !== 'open' ? (
        <ProyectaSplash status={checking ? 'Revisando tu cuenta de Lantify' : 'Abriendo Proyecta'}>
          {needsSignIn ? <AccountSignIn status={status} onSignedIn={setStatus} /> : null}
        </ProyectaSplash>
      ) : null}
      {phase !== 'splash' ? (
        <div className={phase === 'reveal' ? 'px-reveal' : undefined}>
          <App />
        </div>
      ) : null}
    </>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{role === 'output' ? <OutputWindowView /> : <Root />}</React.StrictMode>
);
