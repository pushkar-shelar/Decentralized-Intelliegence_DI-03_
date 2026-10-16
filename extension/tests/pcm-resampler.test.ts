import { describe, expect, it } from 'vitest';
import { calculatePcmRms, floatToInt16, resampleTo16kMonoPcm } from '../src/audio/pcm-resampler';

describe('pcm-resampler', () => {
  it('resamples 48kHz audio to 16kHz at exact 3:1 sample ratio', () => {
    // 3000 samples @ 48kHz -> should produce 1000 samples @ 16kHz
    const inputL = new Float32Array(3000);
    for (let i = 0; i < 3000; i++) {
      inputL[i] = Math.sin((i / 48) * 2 * Math.PI); // 1 kHz test sine wave
    }

    const output = resampleTo16kMonoPcm(inputL, null, 48000, 16000);
    expect(output.length).toBe(1000);
    expect(output instanceof Int16Array).toBe(true);

    const rms = calculatePcmRms(output);
    expect(rms).toBeGreaterThan(0.5); // Sine wave RMS is ~0.707
  });

  it('correctly downmixes stereo channels', () => {
    const inputL = new Float32Array([1.0, 0.5, -1.0]);
    const inputR = new Float32Array([0.0, 0.5, 1.0]);

    // Resampling with equal source and target rate
    const output = resampleTo16kMonoPcm(inputL, inputR, 16000, 16000);
    expect(output.length).toBe(3);
    // (1.0 + 0.0) / 2 = 0.5 -> ~16383
    expect(output[0]).toBe(floatToInt16(0.5));
    // (0.5 + 0.5) / 2 = 0.5
    expect(output[1]).toBe(floatToInt16(0.5));
    // (-1.0 + 1.0) / 2 = 0.0
    expect(output[2]).toBe(0);
  });

  it('safely clamps clipping signals into Int16 boundaries [-32768, 32767]', () => {
    expect(floatToInt16(2.5)).toBe(32767);
    expect(floatToInt16(-3.0)).toBe(-32768);
    expect(floatToInt16(0.0)).toBe(0);
  });

  it('calculates zero RMS for silent audio', () => {
    const silent = new Int16Array(100);
    expect(calculatePcmRms(silent)).toBe(0);
  });
});
