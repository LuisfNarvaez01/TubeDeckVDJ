import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AudioOutputRouter } from '../../../src/renderer/audio/AudioOutputRouter';
import type { AudioDspEngine } from '../../../src/renderer/audio/AudioDspEngine';

describe('AudioOutputRouter', () => {
  let monoSplit = false;
  const mockDsp = {
    setMonoSplitMode: vi.fn((enabled: boolean) => {
      monoSplit = enabled;
    }),
    isMonoSplitMode: vi.fn(() => monoSplit)
  } as unknown as AudioDspEngine;

  let masterSinkEl: { setSinkId: ReturnType<typeof vi.fn>; sinkId: string };
  let cueSinkEl: { setSinkId: ReturnType<typeof vi.fn>; sinkId: string };
  let deviceList: Array<{ kind: string; deviceId: string; label: string }>;

  beforeEach(() => {
    monoSplit = false;
    masterSinkEl = {
      sinkId: 'default',
      setSinkId: vi.fn(async (id: string) => {
        masterSinkEl.sinkId = id;
      })
    };
    cueSinkEl = {
      sinkId: 'default',
      setSinkId: vi.fn(async (id: string) => {
        cueSinkEl.sinkId = id;
      })
    };
    deviceList = [
      { kind: 'audiooutput', deviceId: 'default', label: 'Predeterminado' },
      { kind: 'audiooutput', deviceId: 'usb-main', label: 'Altavoces USB' },
      { kind: 'audiooutput', deviceId: 'usb-phones', label: 'Audifonos DJ' }
    ];
  });

  it('routes master and cue sinks independently, handles unplug fallback, and toggles Mono Split', async () => {
    const mediaDevicesMock = {
      enumerateDevices: vi.fn(async () => deviceList),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    };

    const router = new AudioOutputRouter(
      mockDsp,
      masterSinkEl as unknown as HTMLAudioElement,
      cueSinkEl as unknown as HTMLAudioElement,
      mediaDevicesMock as unknown as MediaDevices
    );

    const outputs = await router.enumerateOutputs();
    expect(outputs).toHaveLength(3);

    await router.setMasterDevice('usb-main');
    await router.setCueDevice('usb-phones');
    expect(masterSinkEl.setSinkId).toHaveBeenCalledWith('usb-main');
    expect(cueSinkEl.setSinkId).toHaveBeenCalledWith('usb-phones');

    // Simulate unplugging headphones USB interface (Review Focus #4)
    deviceList = deviceList.filter((d) => d.deviceId !== 'usb-phones');
    const result = await router.handleDeviceChange();
    expect(result).toEqual({ masterFallback: false, cueFallback: true });
    expect(cueSinkEl.setSinkId).toHaveBeenLastCalledWith('default');

    // Mono Split toggle
    router.setMonoSplit(true);
    expect(mockDsp.setMonoSplitMode).toHaveBeenCalledWith(true);
    expect(mockDsp.isMonoSplitMode()).toBe(true);

    router.dispose();
  });
});
