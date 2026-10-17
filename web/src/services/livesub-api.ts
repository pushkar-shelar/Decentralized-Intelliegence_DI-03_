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
  // 1. Try relative URL via Vite proxy
  try {
    const res = await fetch('/api/health', {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(2000),
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
      signal: AbortSignal.timeout(2500),
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
 * Paces requests smoothly without flooding the WebSocket in milliseconds.
 */
export async function processAudioStreamViaWebSocket(params: {
  chunks: SmartAudioChunk[] | Int16Array[];
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

    const wsUrl = 'ws://127.0.0.1:8765/api/ws/audio';
    const ws = new WebSocket(wsUrl);
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

      // 2. Stream smart 20s audio chunks
      streamSmartChunks();
    };

    const streamSmartChunks = async () => {
      // Create a 400ms silence packet (6400 samples) to trigger VAD sentence finalization
      const silenceBuffer = new Int16Array(6400);

      for (let i = 0; i < totalChunks; i++) {
        if (isFinished || signal?.aborted) return;
        if (ws.readyState !== WebSocket.OPEN) {
          cleanup();
          return reject(new Error('WebSocket connection closed while streaming. Ensure the LiveSub backend server is running on port 8765.'));
        }

        const rawChunk = chunks[i]!;
        // Handle both SmartAudioChunk and plain Int16Array
        const isSmart = 'pcm' in rawChunk;
        const pcmData: Int16Array = isSmart ? rawChunk.pcm : rawChunk;
        const chunkStartSec = isSmart ? rawChunk.startSec : (i * (durationSec / totalChunks));
        const chunkDurationSec = isSmart ? rawChunk.durationSec : (pcmData.length / 16000);

        // 1. Send metadata for this 20-second chunk
        const meta = {
          type: 'chunk_meta',
          perfNow: performance.now(),
          durationMs: chunkDurationSec * 1000,
          anchor: {
            videoTime: chunkStartSec,
            rate: 1.0,
            paused: false,
          },
          sourceLang,
          targetLang,
        };

        ws.send(JSON.stringify(meta));

        // 2. Send the audio PCM buffer
        ws.send(pcmData.buffer);

        // 3. Send silence padding to signal sentence boundary to VAD
        ws.send(silenceBuffer.buffer);

        chunksSent++;
        const pct = Math.min(92, Math.round(((i + 1) / totalChunks) * 88));

        onProgress?.({
          stage: 'transcribing',
          percent: pct,
          chunksProcessed: chunksSent,
          totalChunks,
          currentTimeSec: Math.min(durationSec, chunkStartSec + chunkDurationSec),
          durationSec,
        });

        // Smart pacing: wait ~700ms between 20-second chunks so Whisper has comfortable inference time
        await new Promise((r) => setTimeout(r, 750));
      }

      // Allow trailing VAD hangover to finalize any pending sentence
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

    async function translateFallback(text: string, srcLang: string, tgtLang: string): Promise<string> {
      try {
        const sl = encodeURIComponent(srcLang || 'auto');
        const tl = encodeURIComponent(tgtLang);
        const q = encodeURIComponent(text.trim());
        const res = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sl}&tl=${tl}&dt=t&q=${q}`, {
          signal: AbortSignal.timeout(3500),
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

          onProgress?.({
            stage: cue.translation ? 'translating' : 'transcribing',
            percent: Math.min(95, Math.round(((chunksSent) / totalChunks) * 90)),
            chunksProcessed: chunksSent,
            totalChunks,
            currentTimeSec: cue.end,
            durationSec,
            lastCue: cue,
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
