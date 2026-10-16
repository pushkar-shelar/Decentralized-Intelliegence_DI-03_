const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

/**
 * Extract a YouTube video id from a URL.
 * Supports /watch?v=ID, /live/ID, and youtu.be/ID. Returns null for anything else
 * (home, search, channel, shorts — Shorts are out of scope for now).
 */
export function parseVideoId(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }

  const host = u.hostname.toLowerCase().replace(/^(www\.|m\.)/, '');

  if (host === 'youtu.be') {
    const id = u.pathname.slice(1).split('/')[0] ?? '';
    return VIDEO_ID_RE.test(id) ? id : null;
  }

  if (host !== 'youtube.com') return null;

  if (u.pathname === '/watch') {
    const v = u.searchParams.get('v');
    return v && VIDEO_ID_RE.test(v) ? v : null;
  }

  const live = u.pathname.match(/^\/live\/([A-Za-z0-9_-]{11})(?:[/?]|$)/);
  if (live && live[1]) return live[1];

  return null;
}
