/**
 * Web Audio API based audio extractor and 16kHz Int16 PCM chunker.
 * Natively supports MP4, WebM, MOV, MKV, MP3, AAC, WAV in all modern browsers.
 */

export interface ExtractedAudioResult {
  durationSec: number;
  sampleRate: number;
  totalSamples: number;
  chunks: Int16Array[];
}

export type ExtractionProgressCallback = (progress: number, stage: string) => void;

/**
 * Resamples and converts Float32 audio to 16,000 Hz Mono Int16 PCM.
 */
export function resampleTo16kMono(
  channelL: Float32Array,
  channelR: Float32Array | null,
  sourceSampleRate: number,
  targetSampleRate = 16000,
): Int16Array {
  const inLength = channelL.length;
  if (inLength === 0) return new Int16Array(0);

  const hasStereo = channelR !== null && channelR.length === inLength;

  if (sourceSampleRate === targetSampleRate) {
    const out = new Int16Array(inLength);
    for (let i = 0; i < inLength; i++) {
      const mono = hasStereo ? (channelL[i]! + channelR![i]!) * 0.5 : channelL[i]!;
      out[i] = floatToInt16(mono);
    }
    return out;
  }

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

function floatToInt16(sample: number): number {
  const clamped = Math.max(-1.0, Math.min(1.0, sample));
  return clamped < 0 ? Math.round(clamped * 32768) : Math.round(clamped * 32767);
}

/**
 * Splits continuous Int16 PCM array into 200ms chunks (3200 samples @ 16kHz).
 */
export function chunkPcm(pcm: Int16Array, chunkSize = 3200): Int16Array[] {
  const chunks: Int16Array[] = [];
  const total = pcm.length;
  for (let offset = 0; offset < total; offset += chunkSize) {
    const end = Math.min(offset + chunkSize, total);
    chunks.push(pcm.slice(offset, end));
  }
  return chunks;
}

/**
 * Extracts and prepares 16kHz PCM audio chunks from an uploaded video file.
 */
export async function extractAudioFromVideo(
  file: File,
  onProgress?: ExtractionProgressCallback,
): Promise<ExtractedAudioResult> {
  onProgress?.(0.1, 'Reading video file...');

  const arrayBuffer = await file.arrayBuffer();

  onProgress?.(0.35, 'Decoding audio track...');

  // Use AudioContext to decode native audio streams from the video container
  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) {
    throw new Error('Web Audio API is not supported in this browser.');
  }

  const audioCtx = new AudioCtx();
  let audioBuffer: AudioBuffer;

  try {
    audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
  } catch (err) {
    await audioCtx.close();
    throw new Error(
      'Could not extract audio track. Ensure the video contains audio in a supported format (AAC, MP3, Opus, PCM).',
    );
  }

  if (audioBuffer.numberOfChannels === 0 || audioBuffer.length === 0) {
    await audioCtx.close();
    throw new Error('The uploaded video contains no audio track or an empty audio stream.');
  }

  onProgress?.(0.65, 'Resampling to 16kHz Mono PCM...');

  const channelL = audioBuffer.getChannelData(0);
  const channelR = audioBuffer.numberOfChannels > 1 ? audioBuffer.getChannelData(1) : null;

  const pcm16k = resampleTo16kMono(channelL, channelR, audioBuffer.sampleRate, 16000);

  onProgress?.(0.9, 'Creating streaming audio chunks...');

  const chunks = chunkPcm(pcm16k, 3200); // 200ms @ 16kHz
  const durationSec = audioBuffer.duration;

  await audioCtx.close();

  onProgress?.(1.0, 'Audio extraction complete');

  return {
    durationSec,
    sampleRate: 16000,
    totalSamples: pcm16k.length,
    chunks,
  };
}
