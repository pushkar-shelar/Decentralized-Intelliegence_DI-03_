export interface PlayerElements {
  /** #movie_player — the .html5-video-player root; stays inside the fullscreen element. */
  player: HTMLElement;
  video: HTMLVideoElement;
}

function findPlayer(root: ParentNode): PlayerElements | null {
  const player = root.querySelector<HTMLElement>('#movie_player');
  const video = player?.querySelector<HTMLVideoElement>('video.html5-main-video');
  return player && video ? { player, video } : null;
}

/**
 * Resolve once the YouTube watch player and its <video> exist.
 * Rejects on timeout or abort (e.g. user navigated away before the player appeared).
 */
export function waitForPlayer(signal: AbortSignal, timeoutMs = 15000): Promise<PlayerElements> {
  return new Promise((resolve, reject) => {
    const existing = findPlayer(document);
    if (existing) return resolve(existing);

    const observer = new MutationObserver(() => {
      const found = findPlayer(document);
      if (found) {
        cleanup();
        resolve(found);
      }
    });

    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error(`LiveSub: YouTube player not found within ${timeoutMs} ms`));
    }, timeoutMs);

    const onAbort = () => {
      cleanup();
      reject(new DOMException('aborted', 'AbortError'));
    };

    function cleanup() {
      observer.disconnect();
      window.clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
    }

    signal.addEventListener('abort', onAbort, { once: true });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  });
}
