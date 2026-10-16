import type { Cue } from '../shared/cue';
import { fetchCaptionCues } from './caption-client';
import { parseCaptionData } from './caption-parser';
import { findBestTrack, parseCaptionTracks, type CaptionTrack } from './track-detector';

const LOG = '[LiveSub CaptionManager]';

export interface CaptionManagerOptions {
  videoId: string;
  sourceLang: string;
  signal: AbortSignal;
  onCuesLoaded: (cues: Cue[], track: CaptionTrack) => void;
  onUnavailable: () => void;
}

/**
 * Inspects page scripts for embedded ytInitialPlayerResponse.
 */
export function extractInitialPlayerResponse(doc: Document = document): unknown {
  try {
    const scripts = doc.querySelectorAll('script');
    for (let i = 0; i < scripts.length; i++) {
      const text = scripts[i]?.textContent || '';
      if (text.includes('ytInitialPlayerResponse =') || text.includes('var ytInitialPlayerResponse =')) {
        const match = text.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\});(?:\s*var\s|\s*const\s|\s*let\s|<\/script>|\n)/s);
        if (match?.[1]) {
          try {
            return JSON.parse(match[1]);
          } catch {
            // Continue search
          }
        }
      }
    }
  } catch {
    // Ignore DOM query errors
  }
  return null;
}

/**
 * Coordinates caption track detection and retrieval for a specific YouTube video session.
 * 1. Checks DOM embedded ytInitialPlayerResponse.
 * 2. Asks the main-world hook (timedtext.content) for caption metadata.
 * 3. Listens for intercepted or broadcasted timedtext payloads.
 * 4. Fetches the best matching track directly or through the bridge.
 */
export class CaptionManager {
  private readonly videoId: string;
  private readonly sourceLang: string;
  private readonly signal: AbortSignal;
  private readonly onCuesLoaded: (cues: Cue[], track: CaptionTrack) => void;
  private readonly onUnavailable: () => void;

  private resolved = false;
  private attemptedTracks = new Set<string>();

  constructor(options: CaptionManagerOptions) {
    this.videoId = options.videoId;
    this.sourceLang = options.sourceLang;
    this.signal = options.signal;
    this.onCuesLoaded = options.onCuesLoaded;
    this.onUnavailable = options.onUnavailable;
  }

  start(): () => void {
    const messageHandler = (ev: MessageEvent) => {
      if (this.signal.aborted || this.resolved) return;
      if (ev.source !== window || !ev.data || typeof ev.data !== 'object') return;

      if (ev.data.type === 'LIVESUB_CAPTIONS_METADATA' && ev.data.tracks) {
        this.handleRawTracks(ev.data.tracks);
      } else if (ev.data.type === 'LIVESUB_TIMEDTEXT' && ev.data.payload) {
        const cues = parseCaptionData(ev.data.payload, ev.data.lang || 'en');
        if (cues.length > 0) {
          this.resolveSuccess(cues, {
            languageCode: ev.data.lang || 'en',
            name: 'Intercepted Captions',
            isAsr: false,
          });
        }
      }
    };

    window.addEventListener('message', messageHandler);

    // 1. Check embedded DOM script for instant track detection on initial page load
    const embedded = extractInitialPlayerResponse();
    if (embedded) {
      const tracks = parseCaptionTracks(embedded);
      if (tracks.length > 0) {
        void this.tryLoadTracks(tracks);
      }
    }

    // 2. Request tracks from the main-world hook
    try {
      window.postMessage({ type: 'LIVESUB_REQUEST_TRACKS' }, '*');
    } catch {
      // Ignore
    }

    // 3. Fallback timer if captions do not exist or cannot be found
    const timeout = setTimeout(() => {
      if (!this.resolved && !this.signal.aborted) {
        this.resolveUnavailable();
      }
    }, 4000);

    return () => {
      window.removeEventListener('message', messageHandler);
      clearTimeout(timeout);
    };
  }

  private handleRawTracks(raw: unknown): void {
    const tracks = parseCaptionTracks(raw);
    if (tracks.length > 0) {
      void this.tryLoadTracks(tracks);
    }
  }

  private async tryLoadTracks(tracks: CaptionTrack[]): Promise<void> {
    if (this.resolved || this.signal.aborted) return;

    const best = findBestTrack(tracks, this.sourceLang);
    if (!best || !best.baseUrl) {
      this.resolveUnavailable();
      return;
    }

    if (this.attemptedTracks.has(best.baseUrl)) return;
    this.attemptedTracks.add(best.baseUrl);

    console.info(LOG, 'Selected caption track', {
      videoId: this.videoId,
      lang: best.languageCode,
      name: best.name,
      isAsr: best.isAsr,
    });

    try {
      // First try fetching directly from content script
      const cues = await fetchCaptionCues(best, { signal: this.signal });
      if (cues.length > 0) {
        this.resolveSuccess(cues, best);
        return;
      }
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') return;
      console.warn(LOG, 'Direct fetch failed, requesting via main world', err);
    }

    // Fallback: ask main world to fetch it (with page credentials/cookies)
    try {
      window.postMessage(
        {
          type: 'LIVESUB_FETCH_TRACK',
          baseUrl: best.baseUrl,
          lang: best.languageCode,
        },
        '*',
      );
    } catch {
      // Ignore
    }
  }

  private resolveSuccess(cues: Cue[], track: CaptionTrack): void {
    if (this.resolved || this.signal.aborted) return;
    this.resolved = true;
    this.onCuesLoaded(cues, track);
  }

  private resolveUnavailable(): void {
    if (this.resolved || this.signal.aborted) return;
    this.resolved = true;
    this.onUnavailable();
  }
}
