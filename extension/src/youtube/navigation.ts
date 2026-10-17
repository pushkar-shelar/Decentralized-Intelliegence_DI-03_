import { parseVideoId } from './video-id';

export type VideoChangeListener = (videoId: string | null) => void;

/**
 * Watches YouTube's SPA navigation and reports the current watch-page video id
 * (null when not on a watch page). Fires only when the id actually changes.
 *
 * Signals used:
 *  - `yt-navigate-start`  → fire null immediately so stale subtitles disappear fast
 *  - `yt-navigate-finish` → resolve the new id
 *  - `popstate` + 1 s URL poll → fallback if YouTube changes its custom events
 */
export function watchNavigation(listener: VideoChangeListener): () => void {
  let current: string | null | undefined;

  const emit = (id: string | null) => {
    if (id === current) return;
    current = id;
    listener(id);
  };

  const check = () => {
    const videoId =
      new URLSearchParams(location.search).get('v') ||
      parseVideoId(location.href);
    emit(videoId);
  };

  const onStart = (e: Event) => {
    // YouTube puts destination in detail.url or endpoint
    const detail = (e as CustomEvent)?.detail;
    const url = detail?.url;
    const navVideoId = detail?.endpoint?.watchEndpoint?.videoId;
    if (navVideoId && navVideoId === current) return;
    if (url) {
      try {
        const nextId = parseVideoId(new URL(url, location.origin).href);
        if (nextId !== null && nextId === current) return;
      } catch {
        // Ignore
      }
    }
    emit(null);
  };

  const onMessage = (ev: MessageEvent) => {
    if (ev.source !== window || !ev.data || typeof ev.data !== 'object') return;
    if (ev.data.type === 'LIVESUB_NAVIGATE_FINISH') {
      const id = ev.data.videoId || parseVideoId(ev.data.url || location.href);
      if (id) emit(id);
      else check();
    }
  };

  // Listen on both window and document to catch SPA events across all YouTube versions
  document.addEventListener('yt-navigate-start', onStart);
  window.addEventListener('yt-navigate-start', onStart);

  document.addEventListener('yt-navigate-finish', check);
  window.addEventListener('yt-navigate-finish', check);

  document.addEventListener('yt-page-data-updated', check);
  window.addEventListener('yt-page-data-updated', check);

  window.addEventListener('popstate', check);
  window.addEventListener('message', onMessage);

  const poll = window.setInterval(check, 400);

  check();

  return () => {
    document.removeEventListener('yt-navigate-start', onStart);
    window.removeEventListener('yt-navigate-start', onStart);
    document.removeEventListener('yt-navigate-finish', check);
    window.removeEventListener('yt-navigate-finish', check);
    document.removeEventListener('yt-page-data-updated', check);
    window.removeEventListener('yt-page-data-updated', check);
    window.removeEventListener('popstate', check);
    window.removeEventListener('message', onMessage);
    window.clearInterval(poll);
  };
}
