import type { RtcSignalPayload } from '../../shared/types';

export interface RtcBridgeHandle {
  dispose: () => void;
}

const RTC_CONFIG: RTCConfiguration = {
  iceServers: []
};

export function startOutputRtcSender(
  getStream: () => MediaStream | null,
  sendSignal: (signal: RtcSignalPayload) => Promise<unknown>,
  onSignal: (cb: (signal: RtcSignalPayload) => void) => () => void
): RtcBridgeHandle {
  let pc: RTCPeerConnection | null = null;
  let disposed = false;

  const closePc = () => {
    if (pc) {
      pc.close();
      pc = null;
    }
  };

  const createOffer = async () => {
    if (disposed) return;
    closePc();
    const stream = getStream();
    if (!stream) return;

    pc = new RTCPeerConnection(RTC_CONFIG);
    for (const track of stream.getTracks()) {
      const sender = pc.addTrack(track, stream);
      if (track.kind === 'video' && typeof sender.getParameters === 'function') {
        try {
          const params = sender.getParameters();
          params.degradationPreference = 'maintain-framerate';
          params.encodings = params.encodings?.length
            ? params.encodings.map((enc) => ({ ...enc, maxBitrate: 12_000_000 }))
            : [{ maxBitrate: 12_000_000 }];
          void Promise.resolve(sender.setParameters(params)).catch(() => {});
        } catch {
          // ignore unsupported RTC encoding parameters
        }
      }
    }

    pc.onicecandidate = (evt) => {
      if (evt.candidate && !disposed) {
        void sendSignal({
          type: 'ice',
          candidate: {
            candidate: evt.candidate.candidate,
            sdpMid: evt.candidate.sdpMid,
            sdpMLineIndex: evt.candidate.sdpMLineIndex
          }
        });
      }
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    if (offer.sdp && !disposed) {
      await sendSignal({ type: 'offer', sdp: offer.sdp });
    }
  };

  const unsub = onSignal(async (signal) => {
    if (disposed) return;
    if (signal.type === 'ready') {
      await createOffer();
      return;
    }
    if (signal.type === 'answer' && signal.sdp && pc) {
      await pc.setRemoteDescription({ type: 'answer', sdp: signal.sdp });
      return;
    }
    if (signal.type === 'ice' && signal.candidate && pc) {
      await pc.addIceCandidate(signal.candidate);
    }
  });

  return {
    dispose: () => {
      disposed = true;
      unsub();
      closePc();
    }
  };
}

export function startOutputRtcReceiver(
  onTrackStream: (stream: MediaStream) => void,
  sendSignal: (signal: RtcSignalPayload) => Promise<unknown>,
  onSignal: (cb: (signal: RtcSignalPayload) => void) => () => void
): RtcBridgeHandle {
  let disposed = false;
  const pc = new RTCPeerConnection(RTC_CONFIG);

  pc.ontrack = (evt) => {
    if (disposed) return;
    const stream = evt.streams[0] ?? new MediaStream([evt.track]);
    onTrackStream(stream);
  };

  pc.onicecandidate = (evt) => {
    if (evt.candidate && !disposed) {
      void sendSignal({
        type: 'ice',
        candidate: {
          candidate: evt.candidate.candidate,
          sdpMid: evt.candidate.sdpMid,
          sdpMLineIndex: evt.candidate.sdpMLineIndex
        }
      });
    }
  };

  const unsub = onSignal(async (signal) => {
    if (disposed) return;
    if (signal.type === 'offer' && signal.sdp) {
      await pc.setRemoteDescription({ type: 'offer', sdp: signal.sdp });
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      if (answer.sdp && !disposed) {
        await sendSignal({ type: 'answer', sdp: answer.sdp });
      }
      return;
    }
    if (signal.type === 'ice' && signal.candidate) {
      await pc.addIceCandidate(signal.candidate);
    }
  });

  void sendSignal({ type: 'ready' });

  return {
    dispose: () => {
      disposed = true;
      unsub();
      pc.close();
    }
  };
}

