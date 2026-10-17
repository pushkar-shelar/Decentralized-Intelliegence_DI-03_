import type { Cue, CueSource } from '../shared/cue';
import type { ExportedCueEntry } from './session-export';

export type ExportTextMode = 'original' | 'translated' | 'both' | 'dual';

export interface ExportCueInput {
  id?: string;
  start: number;
  end: number;
  text?: string;
  translation?: string | null;
  lang?: string;
  translation_lang?: string | null;
  source?: CueSource | string;
  speaker?: string | null;
  is_final?: boolean;
  first_shown_at?: number | null;
  revisions?: Array<{ at: number; text: string }>;
}

export interface NormalizedExportCue {
  id: string;
  start: number;
  end: number;
  duration: number;
  originalText: string;
  translatedText: string | null;
  sourceLanguage: string;
  targetLanguage: string | null;
  source: CueSource;
  lines: string[];
}

export interface NormalizeCuesOptions {
  mode?: ExportTextMode;
  targetLang?: string;
  fallbackToOriginal?: boolean;
  timeRange?: {
    start?: number;
    end?: number;
  };
}

export interface CueNormalizationReport {
  cues: NormalizedExportCue[];
  totalInputCues: number;
  validCuesCount: number;
  droppedEmpty: number;
  droppedInvalidTimestamps: number;
  droppedNonPositiveDuration: number;
  droppedOutOfRange: number;
  sourceLanguages: string[];
  targetLanguages: string[];
}

/**
 * Normalizes multiline text: splits on newlines, trims each line, and collapses blank lines.
 */
export function cleanSubtitleLines(raw: string): string[] {
  if (!raw) return [];
  return raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

/**
 * Resolves the lines to display for a cue according to the requested export mode and fallback policy.
 */
export function resolveCueLines(
  cue: { text?: string; translation?: string | null },
  mode: ExportTextMode = 'both',
  fallbackToOriginal = true,
): string[] {
  const origLines = cleanSubtitleLines(cue.text ?? '');
  const transLines = cleanSubtitleLines(cue.translation ?? '');

  const normalizedMode = mode === 'dual' ? 'both' : mode;

  if (normalizedMode === 'original') {
    return origLines;
  }

  if (normalizedMode === 'translated') {
    if (transLines.length > 0) {
      return transLines;
    }
    // Missing translation fallback policy:
    return fallbackToOriginal ? origLines : [];
  }

  // mode === 'both'
  if (origLines.length > 0 && transLines.length > 0) {
    const origJoined = origLines.join(' ');
    const transJoined = transLines.join(' ');
    if (origJoined === transJoined) {
      return origLines;
    }
    return [...origLines, ...transLines];
  }

  if (origLines.length > 0) {
    return origLines;
  }

  return transLines;
}

/**
 * Shared pre-processing function that validates, normalizes, filters, and deterministically
 * sorts subtitle cues before serialization into SRT, WebVTT, or other formats.
 *
 * Guarantees:
 * 1. Does not mutate the input collection.
 * 2. Filters out cues with missing/non-finite timestamps.
 * 3. Validates positive duration (end > start).
 * 4. Filters out cues that produce no non-empty text lines.
 * 5. Applies range filtering when timeRange is specified.
 * 6. Preserves legitimate overlapping cues without collapsing or truncating.
 * 7. Deterministically orders cues by start time (tie breaker: end time, then id).
 * 8. Returns comprehensive validation diagnostics.
 */
export function normalizeCuesForExport(
  rawCues: ReadonlyArray<Cue | ExportedCueEntry | ExportCueInput>,
  options: NormalizeCuesOptions = {},
): CueNormalizationReport {
  const mode = options.mode ?? 'both';
  const fallbackToOriginal = options.fallbackToOriginal ?? true;
  const timeRange = options.timeRange;

  let droppedEmpty = 0;
  let droppedInvalidTimestamps = 0;
  let droppedNonPositiveDuration = 0;
  let droppedOutOfRange = 0;

  const sourceLangSet = new Set<string>();
  const targetLangSet = new Set<string>();
  const prepared: NormalizedExportCue[] = [];

  for (let i = 0; i < rawCues.length; i++) {
    const cue = rawCues[i];
    if (!cue) continue;

    const start = cue.start;
    const end = cue.end;

    // Validate timestamps are finite numbers >= 0
    if (typeof start !== 'number' || !Number.isFinite(start) || start < 0) {
      droppedInvalidTimestamps++;
      continue;
    }
    if (typeof end !== 'number' || !Number.isFinite(end)) {
      droppedInvalidTimestamps++;
      continue;
    }

    // Validate positive duration (end > start)
    const duration = end - start;
    if (duration <= 0) {
      droppedNonPositiveDuration++;
      continue;
    }

    // Optional playback time range check
    if (timeRange) {
      if (timeRange.start !== undefined && end < timeRange.start) {
        droppedOutOfRange++;
        continue;
      }
      if (timeRange.end !== undefined && start > timeRange.end) {
        droppedOutOfRange++;
        continue;
      }
    }

    const originalText = (cue.text ?? '').trim();
    const translatedText = cue.translation?.trim() || null;

    const lines = resolveCueLines(cue, mode, fallbackToOriginal);
    if (lines.length === 0) {
      droppedEmpty++;
      continue;
    }

    const sourceLang = cue.lang?.trim() || 'auto';
    if (sourceLang) sourceLangSet.add(sourceLang);

    const targetLang = cue.translation_lang?.trim() || options.targetLang?.trim() || null;
    if (targetLang) targetLangSet.add(targetLang);

    const id = cue.id ? String(cue.id) : `cue-${i + 1}-${start.toFixed(2)}`;
    const source: CueSource =
      cue.source === 'stt' || cue.source === 'captions' || cue.source === 'demo'
        ? cue.source
        : 'captions';

    prepared.push({
      id,
      start: Number(start.toFixed(3)),
      end: Number(end.toFixed(3)),
      duration: Number(duration.toFixed(3)),
      originalText,
      translatedText,
      sourceLanguage: sourceLang,
      targetLanguage: targetLang,
      source,
      lines,
    });
  }

  // Deterministic sort: primary start, secondary end, tertiary id
  prepared.sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    if (a.end !== b.end) return a.end - b.end;
    return a.id.localeCompare(b.id);
  });

  return {
    cues: prepared,
    totalInputCues: rawCues.length,
    validCuesCount: prepared.length,
    droppedEmpty,
    droppedInvalidTimestamps,
    droppedNonPositiveDuration,
    droppedOutOfRange,
    sourceLanguages: Array.from(sourceLangSet),
    targetLanguages: Array.from(targetLangSet),
  };
}
