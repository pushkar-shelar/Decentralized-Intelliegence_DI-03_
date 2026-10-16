import { createElement } from 'react';
import type { Store } from '../shared/store';
import type { LiveSubSettings } from '../settings/settings-core';
import { CaptionManager } from '../captions/caption-manager';
import { parseCaptionData } from '../captions/caption-parser';
import { parseCaptionTracks } from '../captions/track-detector';
import { DemoCueProvider } from '../overlay/demo-cue-provider';
import { mountOverlay } from '../overlay/mount';
import { SubtitleOverlay } from '../overlay/SubtitleOverlay';
import { CueStore } from '../timeline/cue-store';
import { ActiveCueTranslator } from '../translation/active-cue-translator';
import { TranslationCache } from '../translation/translation-cache';
import { GoogleGtxTranslationService, type TranslationService } from '../translation/translation-service';
import { waitForPlayer } from '../youtube/player-detector';
import { PlayerStateTracker } from '../youtube/player-state';

const LOG = '[LiveSub Session]';

export type SubtitleSourceMode = 'checking' | 'captions' | 'audio' | 'unavailable' | 'demo';

/** Everything that belongs to ONE active video session. Destroyed wholesale on navigation. */
interface Session {
  id: string;
  videoId: string;
  tracker: PlayerStateTracker;
  cueStore: CueStore | DemoCueProvider;
  translator?: ActiveCueTranslator;
  mode: SubtitleSourceMode;
  unmount: () => void;
  dispose: () => void;
}

/**
 * Owns the lifecycle "one session per video".
 * A generation counter guarantees that slow async work from a previous navigation
 * can never attach to or modify the current video's state.
 */
export class SessionController {
  private session: Session | null = null;
  private generation = 0;
  private pending: AbortController | null = null;
  private readonly translationCache = new TranslationCache(500);
  private readonly translationService: TranslationService;

  constructor(
    private readonly settings: Store<LiveSubSettings>,
    translationService?: TranslationService,
  ) {
    this.translationService = translationService ?? new GoogleGtxTranslationService();
  }

  get current(): Readonly<Session> | null {
    return this.session;
  }

  get mode(): SubtitleSourceMode {
    return this.session?.mode ?? 'unavailable';
  }

  /**
   * Strictly prevents audio capture whenever captions are active or currently being checked.
   */
  get isAudioCaptureBlocked(): boolean {
    return this.mode === 'captions' || this.mode === 'checking';
  }

  /**
   * Called when timedtext payload is intercepted from YouTube network traffic.
   */
  onTimedText(payload: unknown, _url?: string, lang?: string): void {
    if (!this.session || this.session.mode === 'demo') return;
    const cues = parseCaptionData(payload, lang || 'en');
    if (cues.length > 0 && this.session.cueStore instanceof CueStore) {
      this.session.cueStore.loadCues(cues);
      this.session.mode = 'captions';
      document.documentElement.dataset.livesubSource = 'captions';
      console.info(LOG, 'Loaded intercepted timedtext cues into store', { count: cues.length });
    }
  }

  /**
   * Called when player caption metadata is broadcasted.
   */
  onCaptionTracks(rawTracks: unknown): void {
    if (!this.session || this.session.mode === 'demo') return;
    const tracks = parseCaptionTracks(rawTracks);
    if (tracks.length > 0) {
      console.info(LOG, 'Received caption tracks broadcast', { count: tracks.length });
    }
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
    const tracker = new PlayerStateTracker(els);
    tracker.start();

    const currentSettings = this.settings.get();

    // Developer demo mode branch
    if (currentSettings.demoMode) {
      const demoProvider = new DemoCueProvider();
      const unmount = mountOverlay(
        els.player,
        createElement(SubtitleOverlay, {
          video: els.video,
          tracker,
          provider: demoProvider,
          settings: this.settings,
        }),
      );

      this.session = {
        id,
        videoId,
        tracker,
        cueStore: demoProvider,
        mode: 'demo',
        unmount,
        dispose: () => {},
      };
      document.documentElement.dataset.livesubSession = id;
      document.documentElement.dataset.livesubSource = 'demo';
      console.info(LOG, 'session started (demo mode)', { id, videoId });
      return;
    }

    // Real Caption Path
    const cueStore = new CueStore();
    const translator = new ActiveCueTranslator({
      videoId,
      sessionId: id,
      cueStore,
      translationService: this.translationService,
      settings: this.settings,
      cache: this.translationCache,
    });

    const disposers: Array<() => void> = [];

    // Trigger translation when active cue changes
    const onVideoTime = () => translator.onTime(els.video.currentTime);
    for (const ev of ['timeupdate', 'seeked', 'playing'] as const) {
      els.video.addEventListener(ev, onVideoTime);
      disposers.push(() => els.video.removeEventListener(ev, onVideoTime));
    }

    // Refresh translation when user changes target language in settings
    const unsubSettings = this.settings.subscribe(() => {
      translator.refresh();
    });
    disposers.push(unsubSettings);

    let sessionMode: SubtitleSourceMode = 'checking';

    const captionManager = new CaptionManager({
      videoId,
      sourceLang: currentSettings.sourceLang,
      signal: abort.signal,
      onCuesLoaded: (cues, track) => {
        if (gen !== this.generation || !this.session) return;
        cueStore.loadCues(cues);
        sessionMode = 'captions';
        if (this.session) this.session.mode = 'captions';
        document.documentElement.dataset.livesubSource = 'captions';
        console.info(LOG, 'Captions loaded into cue store', {
          count: cues.length,
          lang: track.languageCode,
          isAsr: track.isAsr,
        });
        translator.onTime(els.video.currentTime);
      },
      onUnavailable: () => {
        if (gen !== this.generation || !this.session) return;
        sessionMode = 'unavailable';
        if (this.session) this.session.mode = 'unavailable';
        document.documentElement.dataset.livesubSource = 'unavailable';
        console.info(LOG, 'Captions unavailable for video', videoId);
      },
    });

    const stopCaptionManager = captionManager.start();
    disposers.push(stopCaptionManager);

    const unmount = mountOverlay(
      els.player,
      createElement(SubtitleOverlay, {
        video: els.video,
        tracker,
        provider: cueStore,
        settings: this.settings,
      }),
    );

    this.session = {
      id,
      videoId,
      tracker,
      cueStore,
      translator,
      mode: sessionMode,
      unmount,
      dispose: () => {
        translator.dispose();
        disposers.forEach((d) => d());
      },
    };

    document.documentElement.dataset.livesubSession = id;
    document.documentElement.dataset.livesubSource = sessionMode;
    console.info(LOG, 'session started (caption path)', { id, videoId });
  }

  dispose(): void {
    this.generation++;
    this.teardown();
  }

  private teardown(): void {
    this.pending?.abort();
    this.pending = null;
    if (!this.session) return;
    const { id, tracker, unmount, dispose } = this.session;
    dispose();
    unmount();
    tracker.stop();
    this.session = null;
    delete document.documentElement.dataset.livesubSession;
    delete document.documentElement.dataset.livesubSource;
    console.info(LOG, 'session ended', { id });
  }
}
