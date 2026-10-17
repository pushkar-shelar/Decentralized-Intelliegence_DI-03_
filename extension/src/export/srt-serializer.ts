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
 * Converts video seconds into standard SubRip timestamp format:
 * `HH:MM:SS,mmm`
 *
 * Implements deterministic millisecond rounding with proper arithmetic carry:
 * ms -> secs -> mins -> hours.
 */
export function formatSrtTimestamp(seconds: number): string {
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

  return `${hh}:${mm}:${ss},${mmm}`;
}

export interface SrtSerializeOptions extends NormalizeCuesOptions {}

/**
 * Serializes subtitle cues into a production-ready, RFC/standard-compliant SubRip (.srt) document.
 *
 * Format specification:
 * 1. 1-based sequential cue numbering.
 * 2. Timing line: `HH:MM:SS,mmm --> HH:MM:SS,mmm`
 * 3. Text lines (supports multiline, Unicode, Indian languages).
 * 4. Exactly one blank line between cue blocks (`\n\n`).
 * 5. Trailing newline at end of file.
 * 6. Empty string returned when 0 valid cues are present.
 */
export function serializeSrt(
  cues: ReadonlyArray<Cue | ExportedCueEntry | ExportCueInput>,
  options: SrtSerializeOptions = {},
): string {
  const { cues: normalized } = normalizeCuesForExport(cues, options);
  if (normalized.length === 0) return '';

  const blocks: string[] = [];

  for (let i = 0; i < normalized.length; i++) {
    const cue = normalized[i];
    if (!cue) continue;

    const cueNumber = i + 1;
    const startTs = formatSrtTimestamp(cue.start);
    const endTs = formatSrtTimestamp(cue.end);
    const spk = formatSpeakerTag(cue.speaker);
    const speakerPrefix = spk ? `[${spk}] ` : '';
    const formattedLines = cue.lines.map((line, idx) => (idx === 0 && speakerPrefix ? `${speakerPrefix}${line}` : line));
    const body = formattedLines.join('\n');

    blocks.push(`${cueNumber}\n${startTs} --> ${endTs}\n${body}`);
  }

  return `${blocks.join('\n\n')}\n`;
}

/**
 * Convenient wrapper mirroring previous signature for backwards compatibility.
 */
export function cuesToSrtLegacy(
  cues: ReadonlyArray<Cue | ExportedCueEntry>,
  mode: ExportTextMode = 'dual',
): string {
  return serializeSrt(cues, { mode });
}
