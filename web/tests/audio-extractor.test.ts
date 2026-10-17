import { describe, expect, it } from 'vitest';
import { resampleTo16kMono, createSmart20sChunks } from '../src/services/audio-extractor';

describe('Audio Extractor & Smart 20s Chunker (Website)', () => {
  it('correctly resamples 48,000 Hz stereo audio to 16,000 Hz mono Int16 PCM', () => {
    // 48,000 samples @ 48kHz = 1 second
    const channelL = new Float32Array(48000);
    const channelR = new Float32Array(48000);

    for (let i = 0; i < 48000; i++) {
      channelL[i] = Math.sin((2 * Math.PI * 440 * i) / 48000);
      channelR[i] = Math.sin((2 * Math.PI * 440 * i) / 48000);
    }

    const pcm16k = resampleTo16kMono(channelL, channelR, 48000, 16000);

    // 1 second of 16kHz audio = 16,000 samples
    expect(pcm16k.length).toBe(16000);
    expect(pcm16k).toBeInstanceOf(Int16Array);

    let maxAmp = 0;
    for (let i = 0; i < pcm16k.length; i++) {
      if (Math.abs(pcm16k[i]!) > maxAmp) {
        maxAmp = Math.abs(pcm16k[i]!);
      }
    }
    expect(maxAmp).toBeGreaterThan(30000);
  });

  it('divides a 60-second audio stream into ~20-second smart chunks', () => {
    // 60 seconds @ 16kHz = 960,000 samples
    const pcm = new Int16Array(60 * 16000);
    // Introduce an artificial dip/silence at 20.5s and 40.2s
    for (let i = 0; i < pcm.length; i++) {
      pcm[i] = 10000;
    }
    // silence at ~20.5s (sample 328,000 to 330,000)
    for (let i = 328000; i < 330000; i++) {
      pcm[i] = 0;
    }

    const chunks = createSmart20sChunks(pcm, 16000, 20.0);

    expect(chunks.length).toBe(3);
    expect(chunks[0]!.startSec).toBe(0);
    expect(chunks[0]!.endSec).toBeGreaterThan(18.0);
    expect(chunks[0]!.endSec).toBeLessThan(22.0);
    expect(chunks[2]!.endSec).toBe(60.0);
  });

  it('handles empty audio gracefully without throwing', () => {
    const emptyL = new Float32Array(0);
    const emptyR = new Float32Array(0);
    const pcm = resampleTo16kMono(emptyL, emptyR, 44100, 16000);
    expect(pcm.length).toBe(0);

    const chunks = createSmart20sChunks(pcm, 16000, 20.0);
    expect(chunks.length).toBe(0);
  });
});
