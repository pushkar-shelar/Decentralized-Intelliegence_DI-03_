import { createElement } from 'react';
import type { Cue } from '../shared/cue';
import type { CueProvider } from '../shared/cue-provider';
import type { Store } from '../shared/store';
import type { LiveSubSettings } from '../settings/settings-core';
import { DemoCueProvider } from '../overlay/demo-cue-provider';
import { mountOverlay } from '../overlay/mount';
import { SubtitleOverlay } from '../overlay/SubtitleOverlay';
import { waitForPlayer } from '../youtube/player-detector';
import { PlayerStateTracker } from '../youtube/player-state';

const LOG = '[LiveSub]';

/** Everything that belongs to ONE video. Destroyed wholesale on navigation — nothing leaks across videos. */
interface Session {
  id: string;
  videoId: string;
  tracker: PlayerStateTracker;
  unmount: () => void;
}

/**
 * Owns the lifecycle "one session per video".
 * A generation counter guarantees that slow async work (waiting for the player) from a previous
 * navigation can never attach to the current page.
 */
export class SessionController {
  private session: Session | null = null;
  private generation = 0;
  private pending: AbortController | null = null;

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
    const tracker = new PlayerStateTracker(els);
    tracker.start();

    const provider = this.createProvider();
    const unmount = mountOverlay(
      els.player,
      createElement(SubtitleOverlay, { video: els.video, tracker, provider, settings: this.settings }),
    );

    this.session = { id, videoId, tracker, unmount };
    document.documentElement.dataset.livesubSession = id;
    console.info(LOG, 'session started', { id, videoId });
  }

  dispose(): void {
    this.generation++;
    this.teardown();
  }

  /**
   * Phase 1: demo cues gated by the demoMode setting.
   * Phase 2 replaces this with the session's CueStore (captions / STT).
   */
  private createProvider(): CueProvider {
    const demo = new DemoCueProvider();
    const settings = this.settings;
    return {
      getActiveCue: (t: number): Cue | null => (settings.get().demoMode ? demo.getActiveCue(t) : null),
      subscribe: (listener) => settings.subscribe(listener),
    };
  }

  private teardown(): void {
    this.pending?.abort();
    this.pending = null;
    if (!this.session) return;
    const { id, tracker, unmount } = this.session;
    unmount();
    tracker.stop();
    this.session = null;
    delete document.documentElement.dataset.livesubSession;
    console.info(LOG, 'session ended', { id });
  }
}
