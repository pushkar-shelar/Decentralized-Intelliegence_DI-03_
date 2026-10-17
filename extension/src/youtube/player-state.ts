import type { PlayerElements } from './player-detector';

export type ViewMode = 'normal' | 'theater' | 'fullscreen';

/**
 * Discrete player UI/state. `currentTime` is deliberately NOT here — consumers that
 * need per-frame time read `video.currentTime` directly in their rAF loop.
 */
export interface PlayerUiState {
  paused: boolean;
  rate: number;
  isAd: boolean;
  viewMode: ViewMode;
  controlsVisible: boolean;
  /** Rendered player height in px — used to scale subtitle font size. */
  playerHeight: number;
}

type Listener = (state: PlayerUiState) => void;

/**
 * Observes the YouTube player and emits PlayerUiState whenever something meaningful changes:
 * play/pause, rate, ad state (.ad-showing), theatre/fullscreen, control-bar visibility, resize.
 */
export class PlayerStateTracker {
  private listeners = new Set<Listener>();
  private state: PlayerUiState;
  private disposers: Array<() => void> = [];

  constructor(private readonly els: PlayerElements) {
    this.state = this.read();
  }

  get snapshot(): PlayerUiState {
    return this.state;
  }

  start(): void {
    const { player, video } = this.els;
    const update = () => this.update();

    for (const ev of ['play', 'pause', 'ratechange', 'playing', 'seeked', 'loadedmetadata'] as const) {
      video.addEventListener(ev, update);
      this.disposers.push(() => video.removeEventListener(ev, update));
    }

    // Ad state + control-bar autohide are CSS classes on #movie_player.
    // Also observe childList mutations on player for ad overlays.
    const classObserver = new MutationObserver(update);
    classObserver.observe(player, { attributes: true, attributeFilter: ['class'], childList: true, subtree: false });
    this.disposers.push(() => classObserver.disconnect());

    // Also observe childList on .video-ads if present
    const adContainer = player.querySelector?.('.video-ads');
    if (adContainer) {
      const adObserver = new MutationObserver(update);
      adObserver.observe(adContainer, { childList: true, subtree: true });
      this.disposers.push(() => adObserver.disconnect());
    }

    // Theatre mode is an attribute on ytd-watch-flexy.
    const flexy = document.querySelector('ytd-watch-flexy');
    if (flexy) {
      const flexyObserver = new MutationObserver(update);
      flexyObserver.observe(flexy, { attributes: true, attributeFilter: ['theater', 'fullscreen'] });
      this.disposers.push(() => flexyObserver.disconnect());
    }

    document.addEventListener('fullscreenchange', update);
    this.disposers.push(() => document.removeEventListener('fullscreenchange', update));

    const resizeObserver = new ResizeObserver(update);
    resizeObserver.observe(player);
    this.disposers.push(() => resizeObserver.disconnect());

    this.update();
  }

  stop(): void {
    this.disposers.forEach((d) => d());
    this.disposers = [];
    this.listeners.clear();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  private read(): PlayerUiState {
    const { player, video } = this.els;
    const flexy = document.querySelector('ytd-watch-flexy');
    const isFullscreen = !!document.fullscreenElement || !!flexy?.hasAttribute('fullscreen');
    const viewMode: ViewMode = isFullscreen ? 'fullscreen' : flexy?.hasAttribute('theater') ? 'theater' : 'normal';
    const isAd =
      player.classList.contains('ad-showing') ||
      player.classList.contains('ad-interrupting') ||
      Boolean((player as any).getAdState?.() === 1);

    return {
      paused: video.paused,
      rate: video.playbackRate,
      isAd,
      viewMode,
      // Controls are shown when the player is NOT auto-hiding them (paused, hovering, etc.).
      controlsVisible: !player.classList.contains('ytp-autohide'),
      playerHeight: Math.round(player.getBoundingClientRect().height),
    };
  }

  private update(): void {
    const next = this.read();
    const prev = this.state;
    const changed = (Object.keys(next) as Array<keyof PlayerUiState>).some((k) => next[k] !== prev[k]);
    if (!changed) return;
    this.state = next;
    this.listeners.forEach((l) => l(next));
  }
}
