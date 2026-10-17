import { createElement } from 'react';
import { browser } from 'wxt/browser';
import type { Cue } from '../shared/cue';
import type { Store } from '../shared/store';
import type { LiveSubSettings } from '../settings/settings-core';
import type { VideoAnchor } from '../audio/anchor-log';
import { CaptionManager } from '../captions/caption-manager';
import { parseCaptionData } from '../captions/caption-parser';
import { parseCaptionTracks, type CaptionTrack } from '../captions/track-detector';
import { mountOverlay } from '../overlay/mount';
import { SubtitleOverlay } from '../overlay/SubtitleOverlay';
import { CueStore } from '../timeline/cue-store';
import { ActiveCueTranslator } from '../translation/active-cue-translator';
import { TranslationCache } from '../translation/translation-cache';
import { GoogleGtxTranslationService, type TranslationService } from '../translation/translation-service';
import { waitForPlayer, type PlayerElements } from '../youtube/player-detector';
import { PlayerStateTracker } from '../youtube/player-state';
import { buildSessionExport, type LiveSubSessionExport } from '../export/session-export';

const LOG = '[LiveSub Session]';

export type SubtitleSourceMode = 'checking' | 'captions' | 'audio' | 'unavailable' | 'demo';

/** Everything that belongs to ONE active video session. Destroyed wholesale on navigation. */
export interface Session {
  id: string;
  videoId: string;
  els?: PlayerElements;
  video: HTMLVideoElement;
  tracker: PlayerStateTracker;
  cueStore: CueStore;
  translator?: ActiveCueTranslator;
  mode: SubtitleSourceMode;
  unmount: () => void;
  availableTracks?: CaptionTrack[];
  anchorTimer?: number | null;
  audioCaptureActive?: boolean;
  dispose: () => void;
}

/**
 * Owns the lifecycle "one session per video".
 * Ties together the PlayerStateTracker, CueStore timeline, SubtitleOverlay,
 * active cue translation, and live audio capture pipeline.
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
      this.session.availableTracks = tracks;
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
      const demoStore = new CueStore();
      const unmount = mountOverlay(
        els.player,
        createElement(SubtitleOverlay, {
          video: els.video,
          tracker,
          provider: demoStore,
          settings: this.settings,
        }),
      );

      this.session = {
        id,
        videoId,
        els,
        video: els.video,
        tracker,
        cueStore: demoStore,
        mode: 'demo',
        unmount,
        dispose: () => {},
      };
      document.documentElement.dataset.livesubSession = id;
      document.documentElement.dataset.livesubSource = 'demo';
      console.info(LOG, 'session started (demo mode)', { id, videoId });
      return;
    }

    // Real Caption & STT Path
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
        if (this.session) {
          this.session.mode = 'unavailable';
          if (!this.session.audioCaptureActive) {
            this.initiateAudioCapture(this.session);
          }
        }
        document.documentElement.dataset.livesubSource = 'unavailable';
        console.info(LOG, 'Captions unavailable for video, activating audio capture', videoId);
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

    const session: Session = {
      id,
      videoId,
      els,
      video: els.video,
      tracker,
      cueStore,
      translator,
      mode: sessionMode,
      unmount,
      availableTracks: [],
      anchorTimer: null,
      audioCaptureActive: false,
      dispose: () => {
        translator.dispose();
        disposers.forEach((d) => d());
      },
    };
    this.session = session;
    document.documentElement.dataset.livesubSession = id;
    document.documentElement.dataset.livesubSource = sessionMode;
    console.info(LOG, 'session started', { id, videoId });

    // Start video anchor streaming to offscreen audio engine
    this.startAnchorStreaming(session);

    // Fast Look-Ahead Pre-Buffering: Request backend to download & pre-process first 120s of audio
    this.requestLookAheadPreprocess(session);

    // If after 1.5 seconds no captions are found and settings are enabled, activate audio path
    setTimeout(() => {
      if (
        this.session === session &&
        session.cueStore instanceof CueStore &&
        session.cueStore.length === 0 &&
        !session.audioCaptureActive
      ) {
        this.initiateAudioCapture(session);
      }
    }, 1500);
  }

  /**
   * Handle live speech recognition cue updates (partials or finals) from backend.
   */
  onSttCue(cue: Cue): void {
    if (!this.session) return;
    console.info(LOG, `[STT Cue Received] [${cue.lang}] (${cue.start}s - ${cue.end}s): ${cue.text}`);
    if (this.session.cueStore instanceof CueStore) {
      this.session.cueStore.upsertCue(cue);
      this.session.mode = 'audio';
      document.documentElement.dataset.livesubSource = 'audio';
      this.session.translator?.onTime(this.session.video.currentTime);
    }
  }

  dispose(): void {
    this.generation++;
    this.teardown();
  }

  private startAnchorStreaming(session: Session): void {
    const { video } = session;

    const emitAnchor = (isSeek = false) => {
      if (this.session !== session) return;
      const settings = this.settings.get();
      const anchor: VideoAnchor = {
        perfNow: performance.now(),
        videoTime: video.currentTime,
        rate: video.playbackRate,
        paused: video.paused,
        isSeek,
        sourceLang: settings.sourceLang,
        targetLang: settings.targetLang,
      };
      browser.runtime.sendMessage({ type: 'VIDEO_ANCHOR', anchor }).catch(() => {});
    };

    // Emit anchors on video state changes
    video.addEventListener('seeking', () => emitAnchor(true));
    video.addEventListener('seeked', () => emitAnchor(true));
    video.addEventListener('pause', () => emitAnchor());
    video.addEventListener('play', () => {
      emitAnchor();
      if (
        this.session &&
        this.session.cueStore instanceof CueStore &&
        this.session.cueStore.length === 0 &&
        !this.session.audioCaptureActive
      ) {
        this.initiateAudioCapture(this.session);
      }
    });
    video.addEventListener('ratechange', () => emitAnchor());

    // Periodic anchor update every 250ms
    session.anchorTimer = Number(setInterval(() => emitAnchor(), 250));
  }

  private initiateAudioCapture(session: Session): void {
    if (!this.settings.get().enabled) return;
    session.audioCaptureActive = true;
    console.info(LOG, 'Activating tab audio capture for session', session.id);
    browser.runtime
      .sendMessage({ type: 'REQUEST_TAB_AUDIO_CAPTURE' })
      .then((res: any) => {
        if (!res?.success) {
          console.error(LOG, 'Audio capture initiation failed:', res?.error);
        } else {
          console.info(LOG, 'Audio capture successfully initiated, streamId:', res.streamId);
        }
      })
      .catch((err) => {
        console.warn(LOG, 'Audio capture request notice:', err);
      });
  }

  private requestLookAheadPreprocess(session: Session): void {
    if (!this.settings.get().enabled) return;
    const settings = this.settings.get();

    fetch('http://127.0.0.1:8765/api/video/pre-process', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        video_id: session.videoId,
        target_lang: settings.targetLang,
        source_lang: settings.sourceLang,
        start_sec: 0.0,
        duration_sec: 120.0,
      }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.ok && Array.isArray(data.cues) && data.cues.length > 0) {
          if (this.session === session && session.cueStore instanceof CueStore) {
            console.info(LOG, `Loaded ${data.cues.length} lookahead pre-processed cues from backend`);
            session.cueStore.loadCues(data.cues);
            session.mode = 'audio';
            document.documentElement.dataset.livesubSource = 'pre-process';
            session.translator?.onTime(session.video.currentTime);
          }
        }
      })
      .catch(() => {
        // Backend not active or pre-process error; fallback to captions / live audio
      });
  }

  /**
   * Export the current session's cue log for judge evaluation.
   */
  exportSession(): LiveSubSessionExport | null {
    if (!this.session) return null;
    const currentTime = this.session.video?.currentTime ?? 0;
    let cues: readonly Cue[] = [];

    if (this.session.cueStore instanceof CueStore) {
      cues = this.session.cueStore.getCues();
    }

    return buildSessionExport({
      sessionId: this.session.id,
      videoId: this.session.videoId,
      cues,
      currentTime,
    });
  }

  private teardown(): void {
    this.pending?.abort();
    this.pending = null;
    if (!this.session) return;
    const { id, tracker, unmount, anchorTimer, audioCaptureActive, dispose } = this.session;

    if (anchorTimer !== null && anchorTimer !== undefined) {
      clearInterval(anchorTimer);
    }

    if (audioCaptureActive) {
      browser.runtime.sendMessage({ type: 'STOP_TAB_AUDIO_CAPTURE' }).catch(() => {});
    }

    dispose?.();
    unmount();
    tracker.stop();
    this.session = null;
    delete document.documentElement.dataset.livesubSession;
    delete document.documentElement.dataset.livesubSource;
    console.info(LOG, 'session ended', { id });
  }
}
