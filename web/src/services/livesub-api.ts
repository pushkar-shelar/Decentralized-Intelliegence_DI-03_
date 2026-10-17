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
    let lastCueTimestamp = Date.now();

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

      // 2. Stream audio chunks to VAD
      streamAudioChunks();
    };

    const streamAudioChunks = async () => {
      const SUB_CHUNK_SAMPLES = 8000; // 0.5s @ 16kHz for smooth VAD feeding
      const silenceBuffer = new Int16Array(6400); // 400ms silence to signal boundary

      for (let i = 0; i < totalChunks; i++) {
        if (isFinished || signal?.aborted) return;
        if (ws.readyState !== WebSocket.OPEN) {
          cleanup();
          return reject(new Error('WebSocket connection closed while streaming. Ensure the LiveSub backend server is running on port 8765.'));
        }

        const rawChunk = chunks[i]!;
        const isSmart = 'pcm' in rawChunk;
        const pcmData: Int16Array = isSmart ? rawChunk.pcm : rawChunk;
        const chunkStartSec = isSmart ? rawChunk.startSec : (i * (durationSec / totalChunks));
        const chunkDurationSec = isSmart ? rawChunk.durationSec : (pcmData.length / 16000);

        // Feed this ~20s chunk to backend in ~0.5s sub-slices so SileroVAD tracks utterance boundaries
        for (let offset = 0; offset < pcmData.length; offset += SUB_CHUNK_SAMPLES) {
          if (isFinished || signal?.aborted) return;
          if (ws.readyState !== WebSocket.OPEN) break;

          const end = Math.min(offset + SUB_CHUNK_SAMPLES, pcmData.length);
          const subPcm = pcmData.slice(offset, end);
          const currentVideoSec = chunkStartSec + (offset / 16000);

          const meta = {
            type: 'chunk_meta',
            perfNow: performance.now(),
            durationMs: (subPcm.length / 16000) * 1000,
            anchor: {
              videoTime: Number(currentVideoSec.toFixed(2)),
              rate: 1.0,
              paused: false,
            },
            sourceLang,
            targetLang,
          };

          ws.send(JSON.stringify(meta));
          ws.send(subPcm.buffer);

          // Pacing delay (~25ms) so we don't flood TCP queue
          await new Promise((r) => setTimeout(r, 25));
        }

        // At end of each 20s block, send silence padding to finalize any speech utterance in VAD buffer
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(silenceBuffer.buffer);
        }

        chunksSent++;
        const pct = Math.min(88, Math.round(((i + 1) / totalChunks) * 85));

        onProgress?.({
          stage: 'transcribing',
          percent: pct,
          chunksProcessed: chunksSent,
          totalChunks,
          currentTimeSec: Math.min(durationSec, chunkStartSec + chunkDurationSec),
          durationSec,
        });

        // Allow Whisper time to transcribe finalized utterances
        await new Promise((r) => setTimeout(r, 1000));
      }

      // Trailing grace period: wait for Whisper to complete all pending audio decodes
      onProgress?.({
        stage: 'transcribing',
        percent: 90,
        chunksProcessed: totalChunks,
        totalChunks,
        currentTimeSec: durationSec,
        durationSec,
      });

      // Send extra silence to flush final speech tail
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(silenceBuffer.buffer);
      }

      // Wait up to 10 seconds or until cues settle (no new cue for 3 seconds)
      const maxWaitMs = 12000;
      const startTime = Date.now();
      while (Date.now() - startTime < maxWaitMs) {
        if (signal?.aborted) return;
        await new Promise((r) => setTimeout(r, 800));
        // If we received cues and no new cue arrived for 3 seconds, we're done
        if (cuesMap.size > 0 && Date.now() - lastCueTimestamp > 3200) {
          break;
        }
      }

      isFinished = true;
      try {
        ws.close();
      } catch {
        // ignore
      }

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

          lastCueTimestamp = Date.now();
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
