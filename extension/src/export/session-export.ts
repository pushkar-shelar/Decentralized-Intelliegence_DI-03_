import type { Cue, CueSource } from '../shared/cue';
import type { DisplayMode } from '../settings/settings-core';

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
 * Converts seconds into subtitle timestamp format:
 * - SRT: HH:MM:SS,mmm
 * - VTT: HH:MM:SS.mmm
 */
export function formatTimestamp(seconds: number, separator: ',' | '.'): string {
  const total = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = Math.floor(total % 60);
  const ms = Math.floor(((total % 1) + 1e-9) * 1000);

  const hh = String(hours).padStart(2, '0');
  const mm = String(minutes).padStart(2, '0');
  const ss = String(secs).padStart(2, '0');
  const mmm = String(Math.min(999, ms)).padStart(3, '0');

  return `${hh}:${mm}:${ss}${separator}${mmm}`;
}

/**
 * Resolves the lines of text to display for a cue based on the viewer's DisplayMode.
 */
export function getCueDisplayLines(
  cue: { text: string; translation?: string | null },
  mode: DisplayMode = 'dual',
): string[] {
  const original = (cue.text ?? '').trim();
  const translation = cue.translation?.trim() || null;

  if (mode === 'original' || !translation) {
    return original ? [original] : [];
  }
  if (mode === 'translated') {
    return [translation];
  }
  // mode === 'dual'
  if (translation === original) {
    return [original];
  }
  return [original, translation];
}

/**
 * Converts a list of cues into SubRip (.srt) subtitle format.
 */
export function cuesToSrt(
  cues: ReadonlyArray<Cue | ExportedCueEntry>,
  mode: DisplayMode = 'dual',
): string {
  const sorted = [...cues].sort((a, b) => a.start - b.start || a.end - b.end);
  const blocks: string[] = [];

  let index = 1;
  for (const cue of sorted) {
    const lines = getCueDisplayLines(cue, mode);
    if (lines.length === 0) continue;

    const start = formatTimestamp(cue.start, ',');
    const end = formatTimestamp(cue.end, ',');
    blocks.push(`${index++}\n${start} --> ${end}\n${lines.join('\n')}`);
  }

  return blocks.length > 0 ? `${blocks.join('\n\n')}\n` : '';
}

/**
 * Converts a list of cues into WebVTT (.vtt) subtitle format.
 */
export function cuesToVtt(
  cues: ReadonlyArray<Cue | ExportedCueEntry>,
  mode: DisplayMode = 'dual',
  title = 'LiveSub Export',
): string {
  const sorted = [...cues].sort((a, b) => a.start - b.start || a.end - b.end);
  const blocks: string[] = [`WEBVTT - ${title}\n`];

  let index = 1;
  for (const cue of sorted) {
    const lines = getCueDisplayLines(cue, mode);
    if (lines.length === 0) continue;

    const start = formatTimestamp(cue.start, '.');
    const end = formatTimestamp(cue.end, '.');
    blocks.push(`${index++}\n${start} --> ${end}\n${lines.join('\n')}`);
  }

  return `${blocks.join('\n')}\n`;
}

/**
 * Generic browser file download helper.
 */
export function downloadTextFile(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadJsonFile(filename: string, data: unknown): void {
  const json = JSON.stringify(data, null, 2);
  downloadTextFile(filename, json, 'application/json');
}

export function downloadSrtFile(filename: string, content: string): void {
  downloadTextFile(filename, content, 'text/plain');
}

export function downloadVttFile(filename: string, content: string): void {
  downloadTextFile(filename, content, 'text/vtt');
}
