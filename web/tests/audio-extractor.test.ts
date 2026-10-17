import { describe, expect, it } from 'vitest';
import { resampleTo16kMono, chunkPcm } from '../src/services/audio-extractor';

describe('Audio Extractor & PCM Resampler (Website)', () => {
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

    // Sine wave peak around 32767
    let maxAmp = 0;
    for (let i = 0; i < pcm16k.length; i++) {
      if (Math.abs(pcm16k[i]!) > maxAmp) {
        maxAmp = Math.abs(pcm16k[i]!);
      }
    }
    expect(maxAmp).toBeGreaterThan(30000);
  });

  it('chunks continuous Int16 PCM array into 3200-sample (200ms) blocks', () => {
    const pcm = new Int16Array(8000); // 8000 samples = 500ms
    const chunks = chunkPcm(pcm, 3200);

    // 3200 + 3200 + 1600 = 3 chunks
    expect(chunks.length).toBe(3);
    expect(chunks[0]!.length).toBe(3200);
    expect(chunks[1]!.length).toBe(3200);
    expect(chunks[2]!.length).toBe(1600);
  });

  it('handles empty audio gracefully without throwing', () => {
    const emptyL = new Float32Array(0);
    const emptyR = new Float32Array(0);
    const pcm = resampleTo16kMono(emptyL, emptyR, 44100, 16000);
    expect(pcm.length).toBe(0);

    const chunks = chunkPcm(pcm, 3200);
    expect(chunks.length).toBe(0);
  });
});
