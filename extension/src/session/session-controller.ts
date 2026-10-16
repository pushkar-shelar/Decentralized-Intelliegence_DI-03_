import { createElement } from 'react';
import type { Cue } from '../shared/cue';
import type { CueProvider } from '../shared/cue-provider';
import type { Store } from '../shared/store';
import type { LiveSubSettings } from '../settings/settings-core';
import { DemoCueProvider } from '../overlay/demo-cue-provider';
import { mountOverlay } from '../overlay/mount';
import { SubtitleOverlay } from '../overlay/SubtitleOverlay';
import { CueStore } from '../timeline/cue-store';
import { parseYouTubeJson3 } from '../captions/caption-parser';
import { findBestTrack, parseCaptionTracks, type CaptionTrack } from '../captions/track-detector';
import { waitForPlayer } from '../youtube/player-detector';
import { PlayerStateTracker } from '../youtube/player-state';

const LOG = '[LiveSub Session]';

/** Everything that belongs to ONE video. Destroyed wholesale on navigation — nothing leaks across videos. */
interface Session {
  id: string;
  videoId: string;
  cueStore: CueStore;
  tracker: PlayerStateTracker;
  unmount: () => void;
  availableTracks: CaptionTrack[];
}

/**
 * Owns the lifecycle "one session per video".
 * Ties together the PlayerStateTracker, CueStore timeline, and SubtitleOverlay.
 */
export class SessionController {
  private session: Session | null = null;
  private generation = 0;
  private pending: AbortController | null = null;
  private demoProvider = new DemoCueProvider();

  constructor(private readonly settings: Store<LiveSubSettings>) {}

  get current(): Readonly<Session> | null {
    return this.session;
  }

  async onVideoChange(videoId: string | null): Promise<void> {
    const gen = ++this.generation;
    this.teardown();
    if (!videoId) return;

    const abort = new AbortController();
    this.pending = abort;

    let els;
    try {
      els = await waitForPlayer(abort.signal);
    } catch (err) {
      if ((err as DOMException)?.name !== 'AbortError') console.warn(LOG, err);
      return;
    }
    if (gen !== this.generation) return; // a newer navigation won the race
    this.pending = null;

    const id = `${videoId}-${Date.now().toString(36)}`;
    const cueStore = new CueStore();
    const tracker = new PlayerStateTracker(els);
    tracker.start();

    const provider = this.createProvider(cueStore);
    const unmount = mountOverlay(
      els.player,
      createElement(SubtitleOverlay, { video: els.video, tracker, provider, settings: this.settings }),
    );

    this.session = { id, videoId, cueStore, tracker, unmount, availableTracks: [] };
    document.documentElement.dataset.livesubSession = id;
    console.info(LOG, 'session started', { id, videoId });

    // Request available tracks from the main-world script
    window.postMessage({ type: 'LIVESUB_REQUEST_TRACKS' }, '*');
  }

  /**
   * Handle intercepted or fetched timedtext JSON3 data for the active session.
   */
  onTimedText(payload: unknown, url?: string, explicitLang?: string): void {
    if (!this.session) return;

    // Detect language code from URL if possible
    let lang = explicitLang;
    if (!lang && url) {
      try {
        const u = new URL(url, location.origin);
        lang = u.searchParams.get('lang') ?? undefined;
      } catch {
        // Fallback
      }
    }
    lang = lang || (this.settings.get().sourceLang === 'auto' ? 'en' : this.settings.get().sourceLang);

    const cues = parseYouTubeJson3(payload, lang);
    if (cues.length > 0) {
      this.session.cueStore.loadCues(cues);
      console.info(LOG, `Loaded ${cues.length} native caption cues for video ${this.session.videoId}`);
    }
  }

  /**
   * Handle discovered caption tracks from YouTube player metadata.
   */
  onCaptionTracks(rawTracks: unknown): void {
    if (!this.session) return;
    const tracks = parseCaptionTracks(rawTracks);
    this.session.availableTracks = tracks;
    console.info(LOG, `Discovered ${tracks.length} caption tracks:`, tracks.map((t) => t.languageCode));

    // If we haven't loaded any cues yet, auto-fetch the best matching track
    if (this.session.cueStore.length === 0 && tracks.length > 0) {
      const preferred = this.settings.get().sourceLang;
      const targetPref = preferred === 'auto' ? 'en' : preferred;
      const best = findBestTrack(tracks, targetPref);
      if (best?.baseUrl) {
        console.info(LOG, `Auto-requesting caption track: ${best.languageCode} (${best.name})`);
        window.postMessage({ type: 'LIVESUB_FETCH_TRACK', baseUrl: best.baseUrl, lang: best.languageCode }, '*');
      }
    }
  }

  dispose(): void {
    this.generation++;
    this.teardown();
  }

  /**
   * Provider with priority:
   * 1. If CueStore has cues (from native captions or STT) -> serve them.
   * 2. Else if demoMode is ON -> fallback to DemoCueProvider.
   * 3. Else -> null (silent).
   */
  private createProvider(cueStore: CueStore): CueProvider {
    const demo = this.demoProvider;
    const settings = this.settings;

    return {
      getActiveCue: (t: number): Cue | null => {
        if (cueStore.length > 0) {
          return cueStore.getActiveCue(t);
        }
        return settings.get().demoMode ? demo.getActiveCue(t) : null;
      },
      subscribe: (listener) => {
        const unsubStore = cueStore.subscribe(listener);
        const unsubSettings = settings.subscribe(listener);
        return () => {
          unsubStore();
          unsubSettings();
        };
      },
    };
  }

  private teardown(): void {
    this.pending?.abort();
    this.pending = null;
    if (!this.session) return;
    const { id, cueStore, tracker, unmount } = this.session;
    unmount();
    tracker.stop();
    cueStore.clear();
    this.session = null;
    delete document.documentElement.dataset.livesubSession;
    console.info(LOG, 'session ended', { id });
  }
}
