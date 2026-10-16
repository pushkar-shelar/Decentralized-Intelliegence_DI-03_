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

  const check = () => emit(parseVideoId(location.href));

  const onStart = (e: Event) => {
    // YouTube puts the destination in detail.url (relative). Skip clearing for same-video navigations (e.g. &t= jumps).
    const url = (e as CustomEvent<{ url?: string }>).detail?.url;
    if (url) {
      const nextId = parseVideoId(new URL(url, location.origin).href);
      if (nextId !== null && nextId === current) return;
    }
    emit(null);
  };

  document.addEventListener('yt-navigate-start', onStart);
  document.addEventListener('yt-navigate-finish', check);
  window.addEventListener('popstate', check);
  const poll = window.setInterval(check, 1000);

  check();

  return () => {
    document.removeEventListener('yt-navigate-start', onStart);
    document.removeEventListener('yt-navigate-finish', check);
    window.removeEventListener('popstate', check);
    window.clearInterval(poll);
  };
}
