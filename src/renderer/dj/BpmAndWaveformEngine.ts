export class BpmAndWaveformEngine {
  private tapTimestampsMs: number[] = [];

  computeWaveformPeaks(channelData: Float32Array, buckets = 200): number[] {
    if (buckets <= 0) return [];
    if (channelData.length === 0) return new Array<number>(buckets).fill(0);

    const step = channelData.length / buckets;
    const rawPeaks = new Array<number>(buckets).fill(0);
    let maxPeak = 0;

    for (let i = 0; i < buckets; i += 1) {
      const start = Math.floor(i * step);
      const end = Math.max(start + 1, Math.floor((i + 1) * step));
      let peak = 0;
      for (let j = start; j < end && j < channelData.length; j += 1) {
        const abs = Math.abs(channelData[j]);
        if (abs > peak) peak = abs;
      }
      rawPeaks[i] = peak;
      if (peak > maxPeak) maxPeak = peak;
    }

    if (maxPeak === 0) return rawPeaks;
    return rawPeaks.map((v) => Number((v / maxPeak).toFixed(4)));
  }

  detectBpmFromEnergyHistory(
    energySamples: number[],
    sampleIntervalSec: number
  ): number | null {
    if (energySamples.length < 30 || sampleIntervalSec <= 0) {
      return null;
    }

    const minLag = Math.max(1, Math.floor(60 / (180 * sampleIntervalSec)));
    const maxLag = Math.min(
      Math.floor(energySamples.length / 2),
      Math.ceil(60 / (70 * sampleIntervalSec))
    );
    if (maxLag <= minLag) return null;

    let mean = 0;
    for (const s of energySamples) mean += s;
    mean /= energySamples.length;

    let bestLag = -1;
    let bestCorr = -Infinity;

    for (let lag = minLag; lag <= maxLag; lag += 1) {
      let sum = 0;
      let count = 0;
      for (let i = 0; i < energySamples.length - lag; i += 1) {
        sum += (energySamples[i] - mean) * (energySamples[i + lag] - mean);
        count += 1;
      }
      const corr = count > 0 ? sum / count : 0;
      if (corr > bestCorr) {
        bestCorr = corr;
        bestLag = lag;
      }
    }

    if (bestLag <= 0 || bestCorr <= 0) return null;
    const bpm = 60 / (bestLag * sampleIntervalSec);
    return Number(bpm.toFixed(1));
  }

  recordTap(timestampMs: number): number | null {
    if (
      this.tapTimestampsMs.length > 0 &&
      timestampMs - this.tapTimestampsMs[this.tapTimestampsMs.length - 1] > 2500
    ) {
      this.tapTimestampsMs = [];
    }

    this.tapTimestampsMs.push(timestampMs);
    if (this.tapTimestampsMs.length > 8) {
      this.tapTimestampsMs.shift();
    }

    if (this.tapTimestampsMs.length < 2) {
      return null;
    }

    let intervalSum = 0;
    for (let i = 1; i < this.tapTimestampsMs.length; i += 1) {
      intervalSum += this.tapTimestampsMs[i] - this.tapTimestampsMs[i - 1];
    }
    const avgMs = intervalSum / (this.tapTimestampsMs.length - 1);
    if (avgMs <= 0) return null;

    const bpm = 60_000 / avgMs;
    return Number(Math.min(220, Math.max(40, bpm)).toFixed(1));
  }

  resetTap(): void {
    this.tapTimestampsMs = [];
  }

  adjustHalfDouble(bpm: number, factor: 0.5 | 2): number {
    const next = bpm * factor;
    return Number(Math.min(240, Math.max(40, next)).toFixed(1));
  }

  computeSyncPlaybackRate(slaveBpm: number, targetMasterBpm: number): number {
    if (slaveBpm <= 0 || targetMasterBpm <= 0) return 1;
    const rate = targetMasterBpm / slaveBpm;
    return Math.min(1.5, Math.max(0.5, Number(rate.toFixed(4))));
  }
}

