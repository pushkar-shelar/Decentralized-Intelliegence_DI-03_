/**
 * Audio resampling and 16-bit PCM conversion for live speech models.
 * Converts hardware-rate stereo Float32 audio down to 16,000 Hz mono Int16 PCM.
 */

/**
 * Mix stereo channels down to mono and resample to targetSampleRate (default 16000Hz).
 * Clamps output values into signed 16-bit PCM integer range [-32768, 32767].
 */
export function resampleTo16kMonoPcm(
  channelL: Float32Array,
  channelR: Float32Array | null,
  sourceSampleRate: number,
  targetSampleRate = 16000,
): Int16Array {
  const inLength = channelL.length;
  if (inLength === 0) return new Int16Array(0);

  // If input is already at target rate and mono
  const hasStereo = channelR !== null && channelR.length === inLength;

  if (sourceSampleRate === targetSampleRate) {
    const out = new Int16Array(inLength);
    for (let i = 0; i < inLength; i++) {
      const mono = hasStereo ? (channelL[i]! + channelR![i]!) * 0.5 : channelL[i]!;
      out[i] = floatToInt16(mono);
    }
    return out;
  }

  // Linear interpolation resampling
  const ratio = sourceSampleRate / targetSampleRate;
  const outLength = Math.floor(inLength / ratio);
  const out = new Int16Array(outLength);

  for (let i = 0; i < outLength; i++) {
    const srcIndex = i * ratio;
    const i0 = Math.floor(srcIndex);
    const i1 = Math.min(i0 + 1, inLength - 1);
    const frac = srcIndex - i0;

    let s0 = channelL[i0]!;
    let s1 = channelL[i1]!;
    if (hasStereo) {
      s0 = (s0 + channelR![i0]!) * 0.5;
      s1 = (s1 + channelR![i1]!) * 0.5;
    }

    const interpolated = s0 + frac * (s1 - s0);
    out[i] = floatToInt16(interpolated);
  }

  return out;
}

/** Convert float [-1.0, 1.0] to 16-bit signed integer with hard limiting. */
export function floatToInt16(sample: number): number {
  const clamped = Math.max(-1.0, Math.min(1.0, sample));
  return clamped < 0 ? Math.round(clamped * 32768) : Math.round(clamped * 32767);
}

/**
 * Calculate Root-Mean-Square (RMS) amplitude of Int16 PCM samples.
 * Returns value between 0.0 (total silence) and 1.0 (full scale 0 dBFS).
 */
export function calculatePcmRms(samples: Int16Array): number {
  if (samples.length === 0) return 0;
  let sumSq = 0;
  for (let i = 0; i < samples.length; i++) {
    const norm = samples[i]! / 32768;
    sumSq += norm * norm;
  }
  return Math.sqrt(sumSq / samples.length);
}
