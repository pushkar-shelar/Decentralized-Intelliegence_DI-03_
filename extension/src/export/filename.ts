import type { ExportTextMode } from './cue-normalizer';

const WINDOWS_RESERVED_NAMES = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  'COM1',
  'COM2',
  'COM3',
  'COM4',
  'COM5',
  'COM6',
  'COM7',
  'COM8',
  'COM9',
  'LPT1',
  'LPT2',
  'LPT3',
  'LPT4',
  'LPT5',
  'LPT6',
  'LPT7',
  'LPT8',
  'LPT9',
]);

/**
 * Sanitizes an arbitrary string (like a YouTube video title) for safe use in any filesystem.
 * Handles Windows, macOS, and Linux filesystem constraints.
 */
export function sanitizeFilenameComponent(raw?: string | null, fallback = 'video', maxLength = 60): string {
  if (!raw || typeof raw !== 'string') return fallback;

  // 1. Remove common YouTube suffixes
  let cleaned = raw.replace(/\s*-\s*YouTube$/i, '').trim();

  // 2. Normalize Unicode (NFC form)
  cleaned = cleaned.normalize('NFC');

  // 3. Replace forbidden filesystem characters (< > : " / \ | ? * % and ASCII 0-31 controls) with hyphen
  cleaned = cleaned.replace(/[<>:"/\\|?*%\x00-\x1F]/g, '-');

  // 4. Replace whitespace, tabs, and repeated punctuation with a single hyphen/underscore
  cleaned = cleaned.replace(/[\s\t]+/g, '-');
  cleaned = cleaned.replace(/[-_]{2,}/g, '-');

  // 5. Trim leading and trailing hyphens, dots, and underscores
  cleaned = cleaned.replace(/^[-._]+|[-._]+$/g, '');

  // 6. Check length
  if (cleaned.length > maxLength) {
    cleaned = cleaned.slice(0, maxLength).replace(/[-._]+$/, '');
  }

  // 7. Check if empty after sanitizing
  if (!cleaned) {
    return fallback;
  }

  // 8. Protect against Windows reserved device names (e.g. CON, AUX, NUL)
  if (WINDOWS_RESERVED_NAMES.has(cleaned.toUpperCase())) {
    cleaned = `livesub_${cleaned}`;
  }

  return cleaned;
}

export interface FilenameOptions {
  title?: string | null;
  videoId?: string | null;
  format: 'srt' | 'vtt' | 'json';
  mode?: ExportTextMode;
  targetLang?: string | null;
}

/**
 * Generates a descriptive, filesystem-safe filename following the canonical LiveSub convention:
 * - `livesub_<video-title>_original.srt`
 * - `livesub_<video-title>_translated_<lang>.vtt`
 * - `livesub_<video-title>_bilingual.srt`
 * - `livesub_<video-id>_session.json`
 */
export function generateSubtitleFilename(options: FilenameOptions): string {
  const fallback = options.videoId ? sanitizeFilenameComponent(options.videoId, 'video') : 'video';
  const slug = sanitizeFilenameComponent(options.title, fallback);

  if (options.format === 'json') {
    return `livesub_${slug}_session.json`;
  }

  const mode = options.mode === 'dual' ? 'both' : (options.mode ?? 'both');

  let modeSuffix: string;
  if (mode === 'original') {
    modeSuffix = 'original';
  } else if (mode === 'translated') {
    const lang = options.targetLang ? sanitizeFilenameComponent(options.targetLang, '') : '';
    modeSuffix = lang ? `translated_${lang}` : 'translated';
  } else {
    // both
    modeSuffix = 'bilingual';
  }

  return `livesub_${slug}_${modeSuffix}.${options.format}`;
}
