import type { SubtitleCue } from '../types/cue';
import type { SmartAudioChunk } from './audio-extractor';

export interface BackendHealth {
  status: string;
  backend: string;
  whisper_loaded?: boolean;
  whisperx_loaded?: boolean;
  diarization_available?: boolean;
  shrutam_loaded?: boolean;
}

export interface StreamingProgress {
  stage: 'connecting' | 'streaming' | 'transcribing' | 'translating' | 'completed';
  percent: number; // 0 to 100
  chunksProcessed: number;
  totalChunks: number;
  currentTimeSec: number;
  durationSec: number;
  lastCue?: SubtitleCue;
}

export type ProgressCallback = (progress: StreamingProgress) => void;
export type CueCallback = (cue: SubtitleCue) => void;

/**
 * Checks LiveSub backend connectivity and model availability.
 * Avoids IPv6 localhost resolution failures by probing relative path and IPv4 127.0.0.1.
 */
export async function checkBackendHealth(): Promise<{ online: boolean; details?: BackendHealth }> {
  // 1. Try relative URL via Vite proxy (6s timeout to tolerate CPU model inference)
  try {
    const res = await fetch('/api/health', {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(6000),
    });
    if (res.ok) {
      const data = await res.json();
      return { online: true, details: data };
    }
  } catch {
    // try fallback
  }

  // 2. Direct IPv4 check
  try {
    const res = await fetch('http://127.0.0.1:8765/api/health', {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(6000),
    });
    if (res.ok) {
      const data = await res.json();
      return { online: true, details: data };
    }
  } catch {
    return { online: false };
  }

  return { online: false };
}

/**
 * Streams smart 20-second PCM audio chunks to the existing LiveSub backend.
 * Streams in ~500ms-1000ms slices to feed SileroVAD and utterance segmentation,
 * then awaits Whisper transcription completion without premature WebSocket closing.
 */
export async function processAudioStreamViaWebSocket(params: {
  pcm16k?: Int16Array;
  chunks: SmartAudioChunk[] | Int16Array[];
  durationSec: number;
  sourceLang?: string;
  targetLang?: string;
  onProgress?: ProgressCallback;
  onCue?: CueCallback;
  signal?: AbortSignal;
}): Promise<SubtitleCue[]> {
  const { pcm16k, chunks, durationSec, sourceLang = 'auto', targetLang = 'en', onProgress, onCue, signal } = params;

  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      return reject(new Error('Processing was cancelled by the user.'));
    }

    const wsUrl = 'ws://127.0.0.1:8765/api/ws/audio';
    const ws = new WebSocket(wsUrl);
    const cuesMap = new Map<string, SubtitleCue>();
    let isFinished = false;

    // Obtain continuous 16kHz PCM buffer
    let fullPcm: Int16Array;
    if (pcm16k && pcm16k.length > 0) {
      fullPcm = pcm16k;
    } else {
      let totalLen = 0;
      for (const ch of chunks) {
        const p = 'pcm' in ch ? ch.pcm : ch;
        totalLen += p.length;
      }
      fullPcm = new Int16Array(totalLen);
      let offset = 0;
      for (const ch of chunks) {
        const p = 'pcm' in ch ? ch.pcm : ch;
        fullPcm.set(p, offset);
        offset += p.length;
      }
    }

    const cleanup = () => {
      isFinished = true;
      try {
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close();
        }
      } catch {
        // ignore
      }
    };

    signal?.addEventListener('abort', () => {
      cleanup();
      reject(new Error('Processing was cancelled.'));
    });

    ws.onopen = async () => {
      onProgress?.({
        stage: 'connecting',
        percent: 5,
        chunksProcessed: 0,
        totalChunks: 1,
        currentTimeSec: 0,
        durationSec,
      });

      // 1. Notify backend of batch audio upload
      ws.send(
        JSON.stringify({
          type: 'start_batch_audio',
          sourceLang,
          targetLang,
          durationSec,
        }),
      );

      // 2. Stream the 16kHz audio buffer in 64KB binary chunks
      const CHUNK_BYTES = 65536; // 64KB = 32768 samples
      const rawBuffer = fullPcm.buffer;
      const totalBytes = rawBuffer.byteLength;

      for (let offset = 0; offset < totalBytes; offset += CHUNK_BYTES) {
        if (isFinished || signal?.aborted) return;
        if (ws.readyState !== WebSocket.OPEN) {
          cleanup();
          return reject(new Error('WebSocket connection closed while uploading audio.'));
        }

        const end = Math.min(offset + CHUNK_BYTES, totalBytes);
        const slice = rawBuffer.slice(offset, end);
        ws.send(slice);

        const uploadPct = Math.round((end / totalBytes) * 20); // 0-20% upload
        onProgress?.({
          stage: 'streaming',
          percent: 5 + uploadPct,
          chunksProcessed: 0,
          totalChunks: 1,
          currentTimeSec: (end / totalBytes) * durationSec,
          durationSec,
        });

        // Yield slightly so browser network buffer doesn't block
        await new Promise((r) => setTimeout(r, 10));
      }

      // 3. Trigger batch audio transcription on the backend
      onProgress?.({
        stage: 'transcribing',
        percent: 25,
        chunksProcessed: 0,
        totalChunks: 1,
        currentTimeSec: 0,
        durationSec,
      });

      ws.send(
        JSON.stringify({
          type: 'process_batch_audio',
        }),
      );
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);

        if (msg.type === 'cue_update' && msg.cue) {
          const cue: SubtitleCue = {
            id: msg.cue.id,
            start: Number(msg.cue.start),
            end: Number(msg.cue.end),
            text: msg.cue.text,
            translation: msg.cue.translation ?? null,
            lang: msg.cue.lang,
            translation_lang: msg.cue.translation_lang,
            speaker: msg.cue.speaker ?? null,
            source: msg.cue.source ?? 'stt',
            is_final: Boolean(msg.cue.is_final),
          };

          cuesMap.set(cue.id, cue);
          onCue?.(cue);

          const timeProgress = durationSec > 0 ? Math.min(1.0, cue.end / durationSec) : 0.5;
          const currentPct = Math.min(95, Math.round(25 + timeProgress * 70));

          onProgress?.({
            stage: cue.translation ? 'translating' : 'transcribing',
            percent: currentPct,
            chunksProcessed: cuesMap.size,
            totalChunks: cuesMap.size,
            currentTimeSec: cue.end,
            durationSec,
            lastCue: cue,
          });
        } else if (msg.type === 'batch_complete') {
          isFinished = true;
          onProgress?.({
            stage: 'completed',
            percent: 100,
            chunksProcessed: cuesMap.size,
            totalChunks: cuesMap.size,
            currentTimeSec: durationSec,
            durationSec,
          });

          cleanup();
          const finalCues = Array.from(cuesMap.values()).sort((a, b) => a.start - b.start || a.end - b.end);
          resolve(finalCues);
        }
      } catch {
        // ignore non-json frames
      }
    };

    ws.onerror = () => {
      if (!isFinished) {
        cleanup();
        reject(new Error('WebSocket connection to LiveSub backend failed. Make sure the backend server is running on port 8765.'));
      }
    };

    ws.onclose = () => {
      if (!isFinished) {
        isFinished = true;
        const finalCues = Array.from(cuesMap.values()).sort((a, b) => a.start - b.start || a.end - b.end);
        resolve(finalCues);
      }
    };
  });
}
