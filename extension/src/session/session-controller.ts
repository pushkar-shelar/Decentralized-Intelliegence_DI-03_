import { createElement } from 'react';
import { browser } from 'wxt/browser';
import type { Cue } from '../shared/cue';
import type { CueProvider } from '../shared/cue-provider';
import type { Store } from '../shared/store';
import type { LiveSubSettings } from '../settings/settings-core';
import type { VideoAnchor } from '../audio/anchor-log';
import { DemoCueProvider } from '../overlay/demo-cue-provider';
import { mountOverlay } from '../overlay/mount';
import { SubtitleOverlay } from '../overlay/SubtitleOverlay';
import { CueStore } from '../timeline/cue-store';
import { parseYouTubeJson3 } from '../captions/caption-parser';
import { findBestTrack, parseCaptionTracks, type CaptionTrack } from '../captions/track-detector';
import { waitForPlayer, type PlayerElements } from '../youtube/player-detector';
import { PlayerStateTracker } from '../youtube/player-state';

const LOG = '[LiveSub Session]';

/** Everything that belongs to ONE video. Destroyed wholesale on navigation — nothing leaks across videos. */
interface Session {
  id: string;
  videoId: string;
  els: PlayerElements;
  cueStore: CueStore;
  tracker: PlayerStateTracker;
  unmount: () => void;
  availableTracks: CaptionTrack[];
  anchorTimer: number | null;
  audioCaptureActive: boolean;
}

/**
 * Owns the lifecycle "one session per video".
 * Ties together the PlayerStateTracker, CueStore timeline, SubtitleOverlay,
 * and audio capture pipeline.
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

    const session: Session = {
      id,
      videoId,
      els,
      cueStore,
      tracker,
      unmount,
      availableTracks: [],
      anchorTimer: null,
      audioCaptureActive: false,
    };
    this.session = session;
    document.documentElement.dataset.livesubSession = id;
    console.info(LOG, 'session started', { id, videoId });

    // Start video anchor streaming to offscreen audio engine
    this.startAnchorStreaming(session);

    // Request available tracks from the main-world script
    window.postMessage({ type: 'LIVESUB_REQUEST_TRACKS' }, '*');

    // If after 1.5 seconds no captions are found and settings are enabled, activate audio path
    window.setTimeout(() => {
      if (this.session === session && session.cueStore.length === 0 && !session.audioCaptureActive) {
        this.initiateAudioCapture(session);
      }
    }, 1500);
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

  /**
   * Handle live speech recognition cue updates (partials or finals) from backend.
   */
  onSttCue(cue: Cue): void {
    if (!this.session) return;
    console.info(LOG, `[STT Cue Received] [${cue.lang}] (${cue.start}s - ${cue.end}s): ${cue.text}`);
    this.session.cueStore.upsertCue(cue);
  }

  dispose(): void {
    this.generation++;
    this.teardown();
  }

  private startAnchorStreaming(session: Session): void {
    const { video } = session.els;

    const emitAnchor = (isSeek = false) => {
      if (this.session !== session) return;
      const anchor: VideoAnchor = {
        perfNow: performance.now(),
        videoTime: video.currentTime,
        rate: video.playbackRate,
        paused: video.paused,
        isSeek,
      };
      browser.runtime.sendMessage({ type: 'VIDEO_ANCHOR', anchor }).catch(() => {});
    };

    // Emit anchors on video state changes
    video.addEventListener('seeking', () => emitAnchor(true));
    video.addEventListener('seeked', () => emitAnchor(true));
    video.addEventListener('pause', () => emitAnchor());
    video.addEventListener('play', () => {
      emitAnchor();
      if (this.session && this.session.cueStore.length === 0 && !this.session.audioCaptureActive) {
        this.initiateAudioCapture(this.session);
      }
    });
    video.addEventListener('ratechange', () => emitAnchor());

    // Periodic anchor update every 250ms
    session.anchorTimer = window.setInterval(() => emitAnchor(), 250);
  }

  private initiateAudioCapture(session: Session): void {
    if (!this.settings.get().enabled) return;
    session.audioCaptureActive = true;
    console.info(LOG, 'Activating tab audio capture for session', session.id);
    browser.runtime.sendMessage({ type: 'REQUEST_TAB_AUDIO_CAPTURE' }).catch((err) => {
      console.warn(LOG, 'Audio capture request notice:', err);
    });
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
    const { id, cueStore, tracker, unmount, anchorTimer, audioCaptureActive } = this.session;

    if (anchorTimer !== null) {
      window.clearInterval(anchorTimer);
    }

    if (audioCaptureActive) {
      browser.runtime.sendMessage({ type: 'STOP_TAB_AUDIO_CAPTURE' }).catch(() => {});
    }

    unmount();
    tracker.stop();
    cueStore.clear();
    this.session = null;
    delete document.documentElement.dataset.livesubSession;
    console.info(LOG, 'session ended', { id });
  }
}
