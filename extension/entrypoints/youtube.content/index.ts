import { browser } from 'wxt/browser';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { SessionController } from '../../src/session/session-controller';
import { loadSettings, subscribeSettings } from '../../src/settings/settings';
import { createStore } from '../../src/shared/store';
import { watchNavigation } from '../../src/youtube/navigation';

export default defineContentScript({
  matches: ['*://www.youtube.com/*'],
  runAt: 'document_idle',
  cssInjectionMode: 'manual',

  async main(ctx) {
    const settings = createStore(await loadSettings());
    const controller = new SessionController(settings);

    // Suppress YouTube's duplicate native gray caption box when LiveSub is active
    if (!document.getElementById('livesub-anti-collision')) {
      const antiCollisionStyle = document.createElement('style');
      antiCollisionStyle.id = 'livesub-anti-collision';
      antiCollisionStyle.textContent = `
        html[data-livesub-session] .ytp-caption-window-bottom,
        html[data-livesub-session] .caption-window,
        html[data-livesub-session] .ytp-caption-segment {
          display: none !important;
          opacity: 0 !important;
          pointer-events: none !important;
        }
      `;
      document.head?.appendChild(antiCollisionStyle);
    }

    // Listen to messages from the main-world timedtext hook & page window
    const onWindowMessage = (event: MessageEvent) => {
      if (event.source !== window || !event.data || typeof event.data !== 'object') return;

      if (event.data.type === 'LIVESUB_TIMEDTEXT') {
        controller.onTimedText(event.data.payload, event.data.url, event.data.lang);
      } else if (event.data.type === 'LIVESUB_CAPTIONS_METADATA') {
        controller.onCaptionTracks(event.data.tracks);
      } else if (event.data.type === 'LIVESUB_EXPORT_SESSION_REQUEST') {
        const data = controller.exportSession();
        window.postMessage({ type: 'LIVESUB_EXPORT_SESSION_RESPONSE', data }, '*');
      }
    };

    window.addEventListener('message', onWindowMessage);

    // Listen to extension messages from popup or background
    const onRuntimeMessage = (message: any, _sender: any, sendResponse: (resp: any) => void) => {
      if (message?.type === 'LIVESUB_STT_CUE' && message.cue) {
        controller.onSttCue(message.cue);
        return;
      }
      if (message?.type === 'LIVESUB_EXPORT_SESSION') {
        const data = controller.exportSession();
        sendResponse({ ok: !!data, data });
        return true;
      }
      if (message?.type === 'LIVESUB_GET_STATUS') {
        const session = controller.current;
        const count = session ? ('length' in session.cueStore ? session.cueStore.length : 10) : 0;
        const isDemo = settings.get().demoMode;
        const videoTitle =
          document.querySelector('h1.ytd-watch-metadata, #title h1, h1.title')?.textContent?.trim() ||
          document.title.replace(/\s*-\s*YouTube$/i, '').trim() ||
          session?.videoId ||
          null;
        sendResponse({
          ok: true,
          hasSession: !!session,
          videoId: session?.videoId ?? null,
          videoTitle,
          cueCount: count > 0 ? count : (isDemo && session ? 10 : 0),
          currentTime: session?.video?.currentTime ?? 0,
          duration: session?.video?.duration ?? 0,
        });
        return true;
      }
    };
    browser.runtime.onMessage.addListener(onRuntimeMessage);

    const unsubscribeSettings = subscribeSettings((next) => settings.set(next));
    const stopNavigation = watchNavigation((videoId) => void controller.onVideoChange(videoId));

    ctx.onInvalidated(() => {
      window.removeEventListener('message', onWindowMessage);
      browser.runtime.onMessage.removeListener(onRuntimeMessage);
      stopNavigation();
      unsubscribeSettings();
      controller.dispose();
    });
  },
});
