import type { Cue } from '../shared/cue';
import type { ExportedCueEntry } from './session-export';
import {
  normalizeCuesForExport,
  formatSpeakerTag,
  type ExportCueInput,
  type ExportTextMode,
  type NormalizeCuesOptions,
} from './cue-normalizer';

/**
 * Converts video seconds into standard WebVTT timestamp format:
 * `HH:MM:SS.mmm`
 *
 * Implements deterministic millisecond rounding with proper arithmetic carry:
 * ms -> secs -> mins -> hours.
 */
export function formatVttTimestamp(seconds: number): string {
  const totalMs = Math.round(Math.max(0, Number.isFinite(seconds) ? seconds : 0) * 1000);
  const ms = totalMs % 1000;
  const totalSecs = Math.floor(totalMs / 1000);
  const secs = totalSecs % 60;
  const totalMins = Math.floor(totalSecs / 60);
  const mins = totalMins % 60;
  const hours = Math.floor(totalMins / 60);

  const hh = String(hours).padStart(2, '0');
  const mm = String(mins).padStart(2, '0');
  const ss = String(secs).padStart(2, '0');
  const mmm = String(ms).padStart(3, '0');

  return `${hh}:${mm}:${ss}.${mmm}`;
}

/**
 * Escapes characters that have special syntactic meaning in WebVTT cue bodies:
 * `<` begins a tag, `&` begins an entity, `>` ends a tag.
 */
export function escapeVttMarkup(text: string): string {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export interface VttSerializeOptions extends NormalizeCuesOptions {
  /** Optional title or description on the WEBVTT header line (e.g. `WEBVTT - Title`) */
  title?: string;
  /**
   * Whether to include sequential cue identifiers above each timing line.
   * Standard WebVTT does NOT require cue identifiers; defaults to false.
   */
  includeCueNumbers?: boolean;
  /**
   * Whether to escape `<>&` markup characters to prevent parser tag collision.
   * Defaults to false so existing plain text is untouched, or true when escaping is requested.
   */
  escapeMarkup?: boolean;
}

/**
 * Serializes subtitle cues into a production-ready Web Video Text Tracks (.vtt) document.
 *
 * Format specification:
 * 1. Required `WEBVTT` header line, followed by optional header text.
 * 2. Exactly one blank line after header (`\n\n`).
 * 3. Timing line: `HH:MM:SS.mmm --> HH:MM:SS.mmm` (period separator).
 * 4. Multiline cue body (UTF-8, Indian languages).
 * 5. Exactly one blank line between cue blocks (`\n\n`).
 * 6. Trailing newline at end of file.
 */
export function serializeWebVtt(
  cues: ReadonlyArray<Cue | ExportedCueEntry | ExportCueInput>,
  options: VttSerializeOptions = {},
): string {
  const { cues: normalized } = normalizeCuesForExport(cues, options);

  const headerLine = options.title ? `WEBVTT - ${options.title.trim()}` : 'WEBVTT';
  if (normalized.length === 0) {
    return `${headerLine}\n`;
  }

  const blocks: string[] = [];

  for (let i = 0; i < normalized.length; i++) {
    const cue = normalized[i];
    if (!cue) continue;

    const startTs = formatVttTimestamp(cue.start);
    const endTs = formatVttTimestamp(cue.end);

    const rawLines = options.escapeMarkup ? cue.lines.map(escapeVttMarkup) : cue.lines;
    const spk = formatSpeakerTag(cue.speaker);
    const bodyLines = spk ? rawLines.map((l) => `<v ${spk}>${l}`) : rawLines;
    const body = bodyLines.join('\n');

    if (options.includeCueNumbers) {
      blocks.push(`${i + 1}\n${startTs} --> ${endTs}\n${body}`);
    } else {
      blocks.push(`${startTs} --> ${endTs}\n${body}`);
    }
  }

  return `${headerLine}\n\n${blocks.join('\n\n')}\n`;
}

/**
 * Backwards compatible wrapper for cuesToVtt:
 * Supports `cuesToVtt(cues, mode, title)` (with numbered cues when title is provided or when called from legacy tests),
 * or `cuesToVtt(cues, mode, options)`.
 */
export function cuesToVttLegacy(
  cues: ReadonlyArray<Cue | ExportedCueEntry>,
  mode: ExportTextMode = 'dual',
  titleOrOptions?: string | VttSerializeOptions,
): string {
  if (typeof titleOrOptions === 'string') {
    // Legacy test behavior: included sequential cue numbers when title was passed
    return serializeWebVtt(cues, {
      mode,
      title: titleOrOptions,
      includeCueNumbers: true,
    });
  }

  return serializeWebVtt(cues, {
    mode,
    ...titleOrOptions,
  });
}
