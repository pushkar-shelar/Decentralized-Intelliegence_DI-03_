export interface CaptionTrack {
  languageCode: string;
  name: string;
  isAsr: boolean;
  baseUrl?: string;
  vssId?: string;
}

interface RawCaptionTrack {
  baseUrl?: string;
  name?: { simpleText?: string; runs?: Array<{ text?: string }> };
  vssId?: string;
  languageCode?: string;
  kind?: string;
}

interface RawPlayerCaptionsRenderer {
  captionTracks?: RawCaptionTrack[];
}

/**
 * Extract structured caption tracks from YouTube's player response caption data.
 */
export function parseCaptionTracks(raw: unknown): CaptionTrack[] {
  if (!raw || typeof raw !== 'object') return [];

  const list = Array.isArray(raw)
    ? (raw as RawCaptionTrack[])
    : ((raw as RawPlayerCaptionsRenderer).captionTracks ?? []);
  if (!Array.isArray(list)) return [];

  const result: CaptionTrack[] = [];

  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const anyItem = item as Record<string, unknown>;
    const lang = (
      (typeof anyItem.languageCode === 'string' ? anyItem.languageCode : '') ||
      (typeof anyItem.lang === 'string' ? anyItem.lang : '')
    ).toLowerCase();
    if (!lang) continue;

    let trackName: string | undefined;
    if (typeof anyItem.displayName === 'string' && anyItem.displayName) {
      trackName = anyItem.displayName;
    } else if (typeof anyItem.languageName === 'string' && anyItem.languageName) {
      trackName = anyItem.languageName;
    } else if (typeof anyItem.name === 'string' && anyItem.name) {
      trackName = anyItem.name;
    } else if (item.name?.simpleText) {
      trackName = item.name.simpleText;
    } else if (item.name?.runs) {
      trackName = item.name.runs.map((r) => r.text ?? '').join('');
    }
    if (!trackName) {
      trackName = lang.toUpperCase();
    }

    const isAsr = anyItem.kind === 'asr' || (typeof anyItem.vssId === 'string' && anyItem.vssId.startsWith('a.'));
    const baseUrl = typeof anyItem.baseUrl === 'string' ? anyItem.baseUrl : undefined;
    const vssId = typeof anyItem.vssId === 'string' ? anyItem.vssId : undefined;

    result.push({
      languageCode: lang,
      name: trackName,
      isAsr,
      baseUrl,
      vssId,
    });
  }

  return result;
}

/**
 * Find the best matching caption track given a preferred language code.
 * Prefers manual human tracks over ASR if both exist for the same language.
 */
export function findBestTrack(tracks: readonly CaptionTrack[], preferredLang: string): CaptionTrack | null {
  if (tracks.length === 0) return null;
  const lang = preferredLang.toLowerCase();

  // 1. Exact match, non-ASR
  const humanMatch = tracks.find((t) => t.languageCode === lang && !t.isAsr);
  if (humanMatch) return humanMatch;

  // 2. Exact match, ASR
  const asrMatch = tracks.find((t) => t.languageCode === lang);
  if (asrMatch) return asrMatch;

  // 3. Prefix match (e.g. 'en-US' matches 'en')
  const prefixMatch = tracks.find((t) => t.languageCode.startsWith(lang) || lang.startsWith(t.languageCode));
  if (prefixMatch) return prefixMatch;

  // 4. Default to English if available
  const enMatch = tracks.find((t) => t.languageCode.startsWith('en'));
  if (enMatch) return enMatch;

  // 5. Fallback to first available track
  return tracks[0] ?? null;
}
