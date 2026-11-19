import type { AudioDspEngine } from './AudioDspEngine';

export interface AudioOutputDevice {
  deviceId: string;
  label: string;
}

type SinkCapableElement = HTMLAudioElement & {
  setSinkId?: (sinkId: string) => Promise<void>;
  sinkId?: string;
};

export class AudioOutputRouter {
  private readonly dsp: AudioDspEngine;
  private readonly masterSinkEl: SinkCapableElement;
  private readonly cueSinkEl: SinkCapableElement;
  private readonly mediaDevices: MediaDevices | null;

  private masterDeviceId = 'default';
  private cueDeviceId = 'default';
  private changeListener: (() => void) | null = null;

  constructor(
    dsp: AudioDspEngine,
    masterSinkEl: HTMLAudioElement,
    cueSinkEl: HTMLAudioElement,
    mediaDevices: MediaDevices | null = typeof navigator !== 'undefined' ? navigator.mediaDevices ?? null : null
  ) {
    this.dsp = dsp;
    this.masterSinkEl = masterSinkEl as SinkCapableElement;
    this.cueSinkEl = cueSinkEl as SinkCapableElement;
    this.mediaDevices = mediaDevices;
  }

  async enumerateOutputs(): Promise<AudioOutputDevice[]> {
    if (!this.mediaDevices?.enumerateDevices) {
      return [{ deviceId: 'default', label: 'Salida predeterminada' }];
    }
    const devices = await this.mediaDevices.enumerateDevices();
    const outputs = devices
      .filter((d) => d.kind === 'audiooutput')
      .map((d, idx) => ({
        deviceId: d.deviceId,
        label: d.label || `Dispositivo de audio ${idx + 1}`
      }));
    return outputs.length > 0
      ? outputs
      : [{ deviceId: 'default', label: 'Salida predeterminada' }];
  }

  async setMasterDevice(deviceId: string): Promise<void> {
    this.masterDeviceId = deviceId;
    if (typeof this.masterSinkEl.setSinkId === 'function') {
      await this.masterSinkEl.setSinkId(deviceId);
    }
  }

  async setCueDevice(deviceId: string): Promise<void> {
    this.cueDeviceId = deviceId;
    if (typeof this.cueSinkEl.setSinkId === 'function') {
      await this.cueSinkEl.setSinkId(deviceId);
    }
  }

  getSelectedDevices(): { masterDeviceId: string; cueDeviceId: string } {
    return {
      masterDeviceId: this.masterDeviceId,
      cueDeviceId: this.cueDeviceId
    };
  }

  setMonoSplit(enabled: boolean): void {
    this.dsp.setMonoSplitMode(enabled);
  }

  async handleDeviceChange(): Promise<{ masterFallback: boolean; cueFallback: boolean }> {
    const outputs = await this.enumerateOutputs();
    const validIds = new Set(outputs.map((o) => o.deviceId));
    let masterFallback = false;
    let cueFallback = false;

    if (this.masterDeviceId !== 'default' && !validIds.has(this.masterDeviceId)) {
      masterFallback = true;
      try {
        await this.setMasterDevice('default');
      } catch {
        this.masterDeviceId = 'default';
      }
    }

    if (this.cueDeviceId !== 'default' && !validIds.has(this.cueDeviceId)) {
      cueFallback = true;
      try {
        await this.setCueDevice('default');
      } catch {
        this.cueDeviceId = 'default';
      }
    }

    return { masterFallback, cueFallback };
  }

  startWatchingDevices(
    onDisconnect: (info: { masterFallback: boolean; cueFallback: boolean }) => void
  ): () => void {
    this.stopWatchingDevices();
    if (!this.mediaDevices?.addEventListener) {
      return () => {};
    }
    this.changeListener = () => {
      void this.handleDeviceChange().then((info) => {
        if (info.masterFallback || info.cueFallback) {
          onDisconnect(info);
        }
      });
    };
    this.mediaDevices.addEventListener('devicechange', this.changeListener);
    return () => this.stopWatchingDevices();
  }

  private stopWatchingDevices(): void {
    if (this.changeListener && this.mediaDevices?.removeEventListener) {
      this.mediaDevices.removeEventListener('devicechange', this.changeListener);
    }
    this.changeListener = null;
  }

  dispose(): void {
    this.stopWatchingDevices();
  }
}

