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

  const renderer = raw as RawPlayerCaptionsRenderer;
  const list = renderer.captionTracks;
  if (!Array.isArray(list)) return [];

  const result: CaptionTrack[] = [];

  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const lang = item.languageCode?.toLowerCase();
    if (!lang) continue;

    let trackName = item.name?.simpleText;
    if (!trackName && item.name?.runs) {
      trackName = item.name.runs.map((r) => r.text ?? '').join('');
    }
    if (!trackName) {
      trackName = lang.toUpperCase();
    }

    result.push({
      languageCode: lang,
      name: trackName,
      isAsr: item.kind === 'asr',
      baseUrl: item.baseUrl,
      vssId: item.vssId,
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
