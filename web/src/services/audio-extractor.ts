/**
 * Web Audio API based audio extractor and smart 20-second chunker.
 * Automatically trims video audio to 2 minutes max (120s) and divides it into
 * ~20-second speech chunks by finding natural pause boundaries.
 */

export interface SmartAudioChunk {
  index: number;
  startSec: number;
  endSec: number;
  durationSec: number;
  pcm: Int16Array;
}

export interface ExtractedAudioResult {
  durationSec: number;
  sampleRate: number;
  totalSamples: number;
  chunks: SmartAudioChunk[];
}

export type ExtractionProgressCallback = (progress: number, stage: string) => void;

export const MAX_AUDIO_DURATION_SEC = 120.0; // Trim any video to 2 minutes max
export const TARGET_CHUNK_DURATION_SEC = 20.0; // 20 seconds target chunk size

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
 * Calculates RMS volume energy of a small window.
 */
function calculateWindowEnergy(pcm: Int16Array, start: number, length: number): number {
  const end = Math.min(start + length, pcm.length);
  if (end <= start) return 0;
  let sum = 0;
  for (let i = start; i < end; i++) {
    const norm = pcm[i]! / 32768;
    sum += norm * norm;
  }
  return sum / (end - start);
}

/**
 * Smartly divides continuous 16kHz PCM audio into ~20-second chunks by finding
 * natural speech pause boundaries (energy minima) within a ±1.5s window around each 20s mark.
 */
export function createSmart20sChunks(
  pcm16k: Int16Array,
  sampleRate = 16000,
  targetChunkSec = 20.0,
): SmartAudioChunk[] {
  const totalSamples = pcm16k.length;
  if (totalSamples === 0) return [];

  const targetSamples = Math.round(targetChunkSec * sampleRate); // 320,000 samples @ 16kHz
  const searchWindow = Math.round(1.5 * sampleRate); // ±1.5s search window (24,000 samples)
  const stepWindow = Math.round(0.08 * sampleRate); // 80ms window for energy calculation

  const chunks: SmartAudioChunk[] = [];
  let currentStart = 0;
  let chunkIdx = 0;

  while (currentStart < totalSamples) {
    const remaining = totalSamples - currentStart;

    // If remaining audio is less than 24 seconds, consume the rest as the final chunk
    if (remaining <= targetSamples + searchWindow) {
      const pcmSlice = pcm16k.slice(currentStart, totalSamples);
      const startSec = currentStart / sampleRate;
      const endSec = totalSamples / sampleRate;
      chunks.push({
        index: chunkIdx++,
        startSec: Number(startSec.toFixed(2)),
        endSec: Number(endSec.toFixed(2)),
        durationSec: Number((endSec - startSec).toFixed(2)),
        pcm: pcmSlice,
      });
      break;
    }

    // Nominal boundary at 20s from currentStart
    const nominalCut = currentStart + targetSamples;

    // Search around nominalCut ± searchWindow for lowest energy (natural speech pause)
    const searchStart = Math.max(currentStart + targetSamples - searchWindow, currentStart + Math.round(10 * sampleRate));
    const searchEnd = Math.min(nominalCut + searchWindow, totalSamples - Math.round(5 * sampleRate));

    let minEnergy = Infinity;
    let bestCut = nominalCut;

    for (let pos = searchStart; pos < searchEnd; pos += stepWindow) {
      const energy = calculateWindowEnergy(pcm16k, pos, stepWindow);
      if (energy < minEnergy) {
        minEnergy = energy;
        bestCut = pos;
      }
    }

    const pcmSlice = pcm16k.slice(currentStart, bestCut);
    const startSec = currentStart / sampleRate;
    const endSec = bestCut / sampleRate;

    chunks.push({
      index: chunkIdx++,
      startSec: Number(startSec.toFixed(2)),
      endSec: Number(endSec.toFixed(2)),
      durationSec: Number((endSec - startSec).toFixed(2)),
      pcm: pcmSlice,
    });

    currentStart = bestCut;
  }

  return chunks;
}

/**
 * Extracts audio from video, trims to max 2 minutes (120s), and creates smart ~20-second chunks.
 */
export async function extractAudioFromVideo(
  file: File,
  onProgress?: ExtractionProgressCallback,
): Promise<ExtractedAudioResult> {
  onProgress?.(0.1, 'Reading video file...');

  const arrayBuffer = await file.arrayBuffer();

  onProgress?.(0.35, 'Decoding audio track...');

  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) {
    throw new Error('Web Audio API is not supported in this browser.');
  }

  const audioCtx = new AudioCtx();
  let audioBuffer: AudioBuffer;

  try {
    audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
  } catch {
    await audioCtx.close();
    throw new Error(
      'Could not extract audio track. Ensure the video contains audio in a supported format (AAC, MP3, Opus, PCM).',
    );
  }

  if (audioBuffer.numberOfChannels === 0 || audioBuffer.length === 0) {
    await audioCtx.close();
    throw new Error('The uploaded video contains no audio track or an empty audio stream.');
  }

  onProgress?.(0.6, 'Trimming to 2 minutes max...');

  // Trim to maximum 2 minutes (120 seconds) as required
  const originalDurationSec = audioBuffer.duration;
  const targetDurationSec = Math.min(originalDurationSec, MAX_AUDIO_DURATION_SEC);
  const maxSamples = Math.floor(targetDurationSec * audioBuffer.sampleRate);

  const channelL = audioBuffer.getChannelData(0).subarray(0, maxSamples);
  const channelR = audioBuffer.numberOfChannels > 1 ? audioBuffer.getChannelData(1).subarray(0, maxSamples) : null;

  onProgress?.(0.75, 'Resampling to 16kHz Mono PCM...');

  const pcm16k = resampleTo16kMono(channelL, channelR, audioBuffer.sampleRate, 16000);

  onProgress?.(0.9, 'Dividing into smart 20-second sentence chunks...');

  const smartChunks = createSmart20sChunks(pcm16k, 16000, TARGET_CHUNK_DURATION_SEC);

  await audioCtx.close();

  onProgress?.(1.0, `Prepared ${smartChunks.length} chunks (20s each, trimmed to ${targetDurationSec.toFixed(1)}s)`);

  return {
    durationSec: targetDurationSec,
    sampleRate: 16000,
    totalSamples: pcm16k.length,
    chunks: smartChunks,
  };
}
