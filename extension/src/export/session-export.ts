import type { Cue, CueSource } from '../shared/cue';

/**
 * Normalized cue entry matching judge evaluation specification:
 * - start and end in video seconds
 * - lang, text, translation, source ('captions' | 'stt' | 'demo')
 * - first_shown_at: video time (s) when its final text first appeared in full
 * - revisions: list of { at, text }
 */
export interface ExportedCueEntry {
  id: string;
  start: number;
  end: number;
  lang: string;
  text: string;
  translation: string | null;
  translation_lang: string | null;
  source: CueSource;
  first_shown_at: number | null;
  revisions: Array<{ at: number; text: string }>;
}

export interface LiveSubSessionExport {
  session_id: string;
  video_id: string;
  video_url: string;
  exported_at: string;
  generator: string;
  playback_time?: number;
  total_cues: number;
  cues: ExportedCueEntry[];
}

/**
 * Formats an internal Cue into the canonical judge export structure.
 */
export function formatCueForExport(cue: Cue): ExportedCueEntry {
  const start = Number(cue.start.toFixed(3));
  const end = Number(cue.end.toFixed(3));

  // Determine first_shown_at:
  // If explicitly recorded, format it; if source is captions and was shown, keep it; else null.
  const firstShown =
    cue.first_shown_at != null && Number.isFinite(cue.first_shown_at)
      ? Number(cue.first_shown_at.toFixed(3))
      : null;

  // Ensure revisions array contains at least the initial text
  let revisions: Array<{ at: number; text: string }>;
  if (cue.revisions && cue.revisions.length > 0) {
    revisions = cue.revisions.map((r) => ({
      at: Number(r.at.toFixed(3)),
      text: r.text,
    }));
  } else {
    revisions = [{ at: start, text: cue.text }];
  }

  return {
    id: cue.id,
    start,
    end,
    lang: cue.lang,
    text: cue.text,
    translation: cue.translation ?? null,
    translation_lang: cue.translation_lang ?? null,
    source: cue.source,
    first_shown_at: firstShown,
    revisions,
  };
}

/**
 * Builds the complete enveloped session log for evaluation.
 */
export function buildSessionExport(params: {
  sessionId: string;
  videoId: string;
  cues: readonly Cue[];
  currentTime?: number;
  version?: string;
}): LiveSubSessionExport {
  const sorted = [...params.cues].sort((a, b) => a.start - b.start || a.end - b.end);

  return {
    session_id: params.sessionId,
    video_id: params.videoId,
    video_url: `https://www.youtube.com/watch?v=${params.videoId}`,
    exported_at: new Date().toISOString(),
    generator: `LiveSub Extension v${params.version ?? '0.1.0'}`,
    ...(params.currentTime !== undefined && Number.isFinite(params.currentTime)
      ? { playback_time: Number(params.currentTime.toFixed(3)) }
      : {}),
    total_cues: sorted.length,
    cues: sorted.map(formatCueForExport),
  };
}

/**
 * Helper to download session export as a formatted .json file in the browser.
 */
export function downloadJsonFile(filename: string, data: unknown): void {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
