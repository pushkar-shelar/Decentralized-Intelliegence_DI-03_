import { defineContentScript } from 'wxt/utils/define-content-script';

/**
 * Main-world script injected into YouTube.
 * Has direct access to window.fetch, XMLHttpRequest, and window.ytInitialPlayerResponse.
 * Relays captured timedtext data to the isolated content script via window.postMessage.
 */
export default defineContentScript({
  matches: ['*://www.youtube.com/*'],
  world: 'MAIN',
  runAt: 'document_start',

  main() {
    const LOG = '[LiveSub MainHook]';

    // 1. Intercept window.fetch
    const originalFetch = window.fetch;
    window.fetch = async function (...args: Parameters<typeof fetch>) {
      const response = await originalFetch.apply(this, args);
      try {
        const input = args[0];
        const url = typeof input === 'string' ? input : input instanceof Request ? input.url : '';
        if (url && url.includes('/api/timedtext')) {
          const clone = response.clone();
          clone
            .json()
            .then((data) => {
              window.postMessage({ type: 'LIVESUB_TIMEDTEXT', url, payload: data }, '*');
            })
            .catch(async () => {
              // Might be XML or text
              try {
                const text = await response.clone().text();
                if (text && text.includes('<text')) {
                  window.postMessage({ type: 'LIVESUB_TIMEDTEXT', url, payload: text }, '*');
                }
              } catch {
                // Ignore
              }
            });
        }
      } catch (err) {
        console.warn(LOG, 'fetch intercept error', err);
      }
      return response;
    };

    // 2. Intercept XMLHttpRequest
    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (...args: any[]) {
      (this as any)._livesubUrl = args[1];
      return origOpen.apply(this, args as any);
    };

    XMLHttpRequest.prototype.send = function (...args: any[]) {
      const url = (this as any)._livesubUrl;
      if (typeof url === 'string' && url.includes('/api/timedtext')) {
        this.addEventListener('load', () => {
          try {
            if (this.responseText) {
              try {
                const data = JSON.parse(this.responseText);
                window.postMessage({ type: 'LIVESUB_TIMEDTEXT', url, payload: data }, '*');
              } catch {
                if (this.responseText.includes('<text')) {
                  window.postMessage({ type: 'LIVESUB_TIMEDTEXT', url, payload: this.responseText }, '*');
                }
              }
            }
          } catch {
            // Ignore
          }
        });
      }
      return origSend.apply(this, args as any);
    };

    // 3. Helper to broadcast player captions metadata when player is ready
    function broadcastTracks() {
      try {
        const ytData = (window as any).ytInitialPlayerResponse;
        let tracks = ytData?.captions?.playerCaptionsTracklistRenderer?.captionTracks;

        if (!Array.isArray(tracks) || tracks.length === 0) {
          const player = document.getElementById('movie_player') as any;
          const playerTracks = player?.getOption?.('captions', 'tracklist');
          if (Array.isArray(playerTracks) && playerTracks.length > 0) {
            tracks = playerTracks;
          }
        }

        if (Array.isArray(tracks) && tracks.length > 0) {
          window.postMessage({ type: 'LIVESUB_CAPTIONS_METADATA', tracks }, '*');
        }
      } catch {
        // Ignored
      }
    }

    // 4. Handle fetch requests from the isolated content script
    window.addEventListener('message', async (ev) => {
      if (ev.source !== window || !ev.data || typeof ev.data !== 'object') return;
      if (ev.data.type === 'LIVESUB_FETCH_TRACK' && typeof ev.data.baseUrl === 'string') {
        const url = ev.data.baseUrl.includes('fmt=json3')
          ? ev.data.baseUrl
          : `${ev.data.baseUrl}&fmt=json3`;
        try {
          const res = await originalFetch(url, { credentials: 'include' });
          if (res.ok) {
            const raw = await res.text();
            try {
              const data = JSON.parse(raw);
              window.postMessage({ type: 'LIVESUB_TIMEDTEXT', url, payload: data, lang: ev.data.lang }, '*');
            } catch {
              window.postMessage({ type: 'LIVESUB_TIMEDTEXT', url, payload: raw, lang: ev.data.lang }, '*');
            }
          }
        } catch (err) {
          console.warn(LOG, 'failed to fetch track in main world', err);
        }
      } else if (ev.data.type === 'LIVESUB_REQUEST_TRACKS') {
        broadcastTracks();
      }
    });

    window.addEventListener('yt-navigate-finish', () => setTimeout(broadcastTracks, 300));
    window.addEventListener('load', broadcastTracks);
  },
});
