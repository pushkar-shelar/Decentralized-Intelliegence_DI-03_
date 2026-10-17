import type { Cue, CueSource } from '../shared/cue';
import type { DisplayMode } from '../settings/settings-core';
import {
  normalizeCuesForExport,
  resolveCueLines,
  cleanSubtitleLines,
  type ExportTextMode,
  type NormalizeCuesOptions,
  type NormalizedExportCue,
  type CueNormalizationReport,
  type ExportCueInput,
} from './cue-normalizer';
import {
  formatSrtTimestamp,
  serializeSrt,
  cuesToSrtLegacy,
  type SrtSerializeOptions,
} from './srt-serializer';
import {
  formatVttTimestamp,
  serializeWebVtt,
  cuesToVttLegacy,
  escapeVttMarkup,
  type VttSerializeOptions,
} from './vtt-serializer';
import {
  generateSubtitleFilename,
  sanitizeFilenameComponent,
  type FilenameOptions,
} from './filename';

// Re-export sub-module tools for clean caller imports
export {
  normalizeCuesForExport,
  resolveCueLines,
  cleanSubtitleLines,
  formatSrtTimestamp,
  serializeSrt,
  formatVttTimestamp,
  serializeWebVtt,
  escapeVttMarkup,
  generateSubtitleFilename,
  sanitizeFilenameComponent,
};
export type {
  ExportTextMode,
  NormalizeCuesOptions,
  NormalizedExportCue,
  CueNormalizationReport,
  ExportCueInput,
  SrtSerializeOptions,
  VttSerializeOptions,
  FilenameOptions,
};

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
  video_title?: string;
  exported_at: string;
  generator: string;
  playback_time?: number;
  total_cues: number;
  cues: ExportedCueEntry[];
}

/**
 * Formats an internal Cue into the canonical judge export structure.
 */
export function formatCueForExport(cue: Cue | ExportCueInput): ExportedCueEntry {
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
    revisions = [{ at: start, text: cue.text ?? '' }];
  }

  const source: CueSource =
    cue.source === 'stt' || cue.source === 'captions' || cue.source === 'demo'
      ? cue.source
      : 'captions';

  return {
    id: cue.id ?? `cue-${start.toFixed(2)}`,
    start,
    end,
    lang: cue.lang ?? 'auto',
    text: cue.text ?? '',
    translation: cue.translation ?? null,
    translation_lang: cue.translation_lang ?? null,
    source,
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
  videoTitle?: string;
  cues: readonly (Cue | ExportCueInput)[];
  currentTime?: number;
  version?: string;
}): LiveSubSessionExport {
  const sorted = [...params.cues].sort((a, b) => a.start - b.start || a.end - b.end);

  return {
    session_id: params.sessionId,
    video_id: params.videoId,
    video_url: `https://www.youtube.com/watch?v=${params.videoId}`,
    ...(params.videoTitle ? { video_title: params.videoTitle } : {}),
    exported_at: new Date().toISOString(),
    generator: `LiveSub Extension v${params.version ?? '0.1.0'}`,
    ...(params.currentTime !== undefined && Number.isFinite(params.currentTime)
      ? { playback_time: Number(params.currentTime.toFixed(3)) }
      : {}),
    total_cues: sorted.length,
    cues: sorted.map((c) => formatCueForExport(c as Cue)),
  };
}

/**
 * Converts seconds into subtitle timestamp format:
 * - SRT: HH:MM:SS,mmm
 * - VTT: HH:MM:SS.mmm
 *
 * Implements deterministic millisecond rounding with proper arithmetic carry:
 * ms -> secs -> mins -> hours.
 */
export function formatTimestamp(seconds: number, separator: ',' | '.'): string {
  if (separator === ',') {
    return formatSrtTimestamp(seconds);
  }
  return formatVttTimestamp(seconds);
}

/**
 * Resolves the lines of text to display for a cue based on the viewer's DisplayMode.
 */
export function getCueDisplayLines(
  cue: { text: string; translation?: string | null },
  mode: DisplayMode | ExportTextMode = 'dual',
): string[] {
  return resolveCueLines(cue, mode);
}

/**
 * Converts a list of cues into SubRip (.srt) subtitle format.
 */
export function cuesToSrt(
  cues: ReadonlyArray<Cue | ExportedCueEntry>,
  mode: DisplayMode | ExportTextMode = 'dual',
): string {
  return cuesToSrtLegacy(cues, mode);
}

/**
 * Converts a list of cues into WebVTT (.vtt) subtitle format.
 */
export function cuesToVtt(
  cues: ReadonlyArray<Cue | ExportedCueEntry>,
  mode: DisplayMode | ExportTextMode = 'dual',
  titleOrOptions: string | VttSerializeOptions = 'LiveSub Export',
): string {
  return cuesToVttLegacy(cues, mode, titleOrOptions);
}

/**
 * Generic browser file download helper using Blob and temporary object URL.
 * Safely revokes object URL after download is triggered.
 */
export function downloadTextFile(filename: string, content: string, mimeType: string): boolean {
  if (typeof document === 'undefined') {
    return false;
  }
  try {
    const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // ignore
      }
    }, 4000);
    return true;
  } catch (err) {
    console.error('[LiveSub Export] downloadTextFile failed:', err);
    return false;
  }
}

export function downloadJsonFile(filename: string, data: unknown): boolean {
  const json = JSON.stringify(data, null, 2);
  return downloadTextFile(filename, json, 'application/json');
}

export function downloadSrtFile(filename: string, content: string): boolean {
  return downloadTextFile(filename, content, 'text/plain');
}

export function downloadVttFile(filename: string, content: string): boolean {
  return downloadTextFile(filename, content, 'text/vtt');
}
