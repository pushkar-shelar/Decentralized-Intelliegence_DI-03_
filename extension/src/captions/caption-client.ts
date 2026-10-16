import type { Cue } from '../shared/cue';
import { parseCaptionData } from './caption-parser';
import type { CaptionTrack } from './track-detector';

const LOG = '[LiveSub CaptionClient]';

export interface FetchCaptionOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

/**
 * Retrieves and parses timed caption cues for a specific caption track.
 * Supports both JSON3 and XML responses.
 */
export async function fetchCaptionCues(
  track: CaptionTrack,
  options: FetchCaptionOptions = {},
): Promise<Cue[]> {
  if (!track.baseUrl) {
    console.warn(LOG, 'Caption track has no baseUrl', track);
    return [];
  }

  const { timeoutMs = 10000, signal } = options;

  const url = track.baseUrl.includes('fmt=json3') ? track.baseUrl : `${track.baseUrl}&fmt=json3`;

  const controller = new AbortController();
  const onParentAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) throw new DOMException('aborted', 'AbortError');
    signal.addEventListener('abort', onParentAbort, { once: true });
  }

  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      credentials: 'include',
    });

    if (!res.ok) {
      console.warn(LOG, `Failed to fetch captions: HTTP ${res.status}`, { url: track.baseUrl });
      return [];
    }

    let raw = await res.text();
    if (!raw || !raw.trim()) {
      // Fallback: Try fetching default XML without fmt=json3 parameter
      if (url.includes('fmt=json3')) {
        const xmlUrl = track.baseUrl.replace(/&fmt=json3|fmt=json3&?/g, '');
        try {
          const xmlRes = await fetch(xmlUrl, {
            signal: controller.signal,
            credentials: 'include',
          });
          if (xmlRes.ok) {
            raw = await xmlRes.text();
          }
        } catch {
          // Ignore fallback error
        }
      }
    }

    if (!raw || !raw.trim()) {
      console.warn(LOG, 'Empty caption response', { url: track.baseUrl });
      return [];
    }

    const cues = parseCaptionData(raw, track.languageCode);
    return cues;
  } catch (err) {
    if ((err as DOMException)?.name === 'AbortError') {
      throw err;
    }
    console.warn(LOG, 'Error retrieving caption track', err);
    return [];
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onParentAbort);
  }
}
