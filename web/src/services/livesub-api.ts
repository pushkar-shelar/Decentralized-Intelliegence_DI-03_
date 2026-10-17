import type { SubtitleCue } from '../types/cue';

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

const BACKEND_BASE_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8765';
const BACKEND_WS_URL = import.meta.env.VITE_BACKEND_WS_URL || 'ws://localhost:8765/api/ws/audio';

/**
 * Checks LiveSub backend connectivity and model availability.
 */
export async function checkBackendHealth(): Promise<{ online: boolean; details?: BackendHealth }> {
  try {
    const res = await fetch(`${BACKEND_BASE_URL}/api/health`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(3500),
    });
    if (!res.ok) return { online: false };
    const data = await res.json();
    return { online: true, details: data };
  } catch {
    return { online: false };
  }
}

/**
 * Streams 16kHz Int16 PCM chunks through the existing LiveSub WebSocket pipeline.
 * Collects finalized subtitle cues with original text, translations, timestamps, and speaker tags.
 */
export async function processAudioStreamViaWebSocket(params: {
  chunks: Int16Array[];
  durationSec: number;
  sourceLang?: string;
  targetLang?: string;
  onProgress?: ProgressCallback;
  onCue?: CueCallback;
  signal?: AbortSignal;
}): Promise<SubtitleCue[]> {
  const { chunks, durationSec, sourceLang = 'auto', targetLang = 'en', onProgress, onCue, signal } = params;

  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      return reject(new Error('Processing was cancelled by the user.'));
    }

    const ws = new WebSocket(BACKEND_WS_URL);
    const cuesMap = new Map<string, SubtitleCue>();
    let isFinished = false;
    let chunksSent = 0;
    const totalChunks = chunks.length;

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

    ws.onopen = () => {
      onProgress?.({
        stage: 'connecting',
        percent: 5,
        chunksProcessed: 0,
        totalChunks,
        currentTimeSec: 0,
        durationSec,
      });

      // 1. Send initial configuration
      ws.send(
        JSON.stringify({
          type: 'config',
          language: sourceLang,
          target_lang: targetLang,
        }),
      );

      // 2. Stream audio chunks
      streamChunks();
    };

    const streamChunks = async () => {
      let currentVideoTime = 0.0;

      for (let i = 0; i < totalChunks; i++) {
        if (isFinished || signal?.aborted) return;
        if (ws.readyState !== WebSocket.OPEN) {
          cleanup();
          return reject(new Error('WebSocket connection lost while streaming audio.'));
        }

        const chunk = chunks[i]!;
        const chunkDurationSec = chunk.length / 16000;

        // Send chunk metadata
        const meta = {
          type: 'chunk_meta',
          perfNow: performance.now(),
          durationMs: chunkDurationSec * 1000,
          anchor: {
            videoTime: currentVideoTime,
            rate: 1.0,
            paused: false,
          },
          sourceLang,
          targetLang,
        };

        ws.send(JSON.stringify(meta));
        ws.send(chunk.buffer);

        chunksSent++;
        currentVideoTime += chunkDurationSec;

        // Pacing delay (5-10ms) allows server VAD and Whisper to process in fast-stream mode
        if (i % 2 === 0) {
          await new Promise((r) => setTimeout(r, 8));
        }
      }

      // Allow trailing VAD hangover to finalize last speech sentence
      await new Promise((r) => setTimeout(r, 1200));

      isFinished = true;
      ws.close();

      const finalCues = Array.from(cuesMap.values()).sort((a, b) => a.start - b.start || a.end - b.end);

      // Post-process: If backend did not provide translation, apply translation fallback
      for (const cue of finalCues) {
        if (!cue.translation || cue.translation.trim().toLowerCase() === cue.text.trim().toLowerCase()) {
          if (targetLang && targetLang !== cue.lang) {
            try {
              const trans = await translateFallback(cue.text, cue.lang || 'auto', targetLang);
              if (trans && trans.toLowerCase() !== cue.text.toLowerCase()) {
                cue.translation = trans;
                cue.translation_lang = targetLang;
              }
            } catch {
              // keep original
            }
          }
        }
      }

      onProgress?.({
        stage: 'completed',
        percent: 100,
        chunksProcessed: totalChunks,
        totalChunks,
        currentTimeSec: durationSec,
        durationSec,
      });

      resolve(finalCues);
    };

    async function translateFallback(text: string, sourceLang: string, tgtLang: string): Promise<string> {
      try {
        const sl = encodeURIComponent(sourceLang || 'auto');
        const tl = encodeURIComponent(tgtLang);
        const q = encodeURIComponent(text.trim());
        const res = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sl}&tl=${tl}&dt=t&q=${q}`, {
          signal: AbortSignal.timeout(4000),
        });
        if (!res.ok) return text;
        const data = await res.json();
        if (Array.isArray(data) && Array.isArray(data[0])) {
          const translated = data[0].map((chunk: any) => chunk?.[0] || '').join('');
          return translated.trim() || text;
        }
      } catch {
        // ignore
      }
      return text;
    }

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

          const currentTimeSec = (chunksSent / totalChunks) * durationSec;
          const pct = Math.min(95, Math.round(10 + (chunksSent / totalChunks) * 85));

          onProgress?.({
            stage: cue.translation ? 'translating' : 'transcribing',
            percent: pct,
            chunksProcessed: chunksSent,
            totalChunks,
            currentTimeSec,
            durationSec,
            lastCue: cue,
          });
        } else if (msg.type === 'audio_ack') {
          const pct = Math.min(95, Math.round(5 + (msg.chunk_index / totalChunks) * 85));
          onProgress?.({
            stage: 'streaming',
            percent: pct,
            chunksProcessed: msg.chunk_index,
            totalChunks,
            currentTimeSec: (msg.chunk_index / totalChunks) * durationSec,
            durationSec,
          });
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
        const finalCues = Array.from(cuesMap.values()).sort((a, b) => a.start - b.start || a.end - b.end);
        resolve(finalCues);
      }
    };
  });
}
