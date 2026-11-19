import { useEffect, useRef, useState, type ReactElement } from 'react';
import { startOutputRtcReceiver } from '../video/outputRtcBridge';

interface OutputWindowViewProps {
  externalStream?: MediaStream | null;
}

export function OutputWindowView({ externalStream }: OutputWindowViewProps): ReactElement {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [liveStream, setLiveStream] = useState<MediaStream | null>(externalStream ?? null);

  useEffect(() => {
    if (externalStream !== undefined) {
      setLiveStream(externalStream);
      return;
    }

    if (typeof window === 'undefined' || !window.tubedeckAPI || typeof RTCPeerConnection === 'undefined') {
      return;
    }

    const handle = startOutputRtcReceiver(
      (stream) => setLiveStream(stream),
      (signal) => window.tubedeckAPI.sendSignalToMain(signal),
      (cb) => window.tubedeckAPI.onSignalFromMain(cb)
    );

    return () => handle.dispose();
  }, [externalStream]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = liveStream ?? null;
    if (liveStream) {
      try {
        const playResult = video.play?.();
        void Promise.resolve(playResult).catch(() => {});
      } catch {
        // ignore unimplemented play in headless DOM
      }
    }
  }, [liveStream]);

  return (
    <div className="h-screen w-screen bg-black overflow-hidden flex items-center justify-center">
      <video
        ref={videoRef}
        data-testid="output-master-video"
        autoPlay
        muted
        playsInline
        controls={false}
        className="h-full w-full object-contain bg-black"
      />
    </div>
  );
}
