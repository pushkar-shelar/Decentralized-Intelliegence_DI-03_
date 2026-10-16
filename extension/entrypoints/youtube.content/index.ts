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

    // Listen to messages from the main-world timedtext hook
    const onWindowMessage = (event: MessageEvent) => {
      if (event.source !== window || !event.data || typeof event.data !== 'object') return;

      if (event.data.type === 'LIVESUB_TIMEDTEXT') {
        controller.onTimedText(event.data.payload, event.data.url, event.data.lang);
      } else if (event.data.type === 'LIVESUB_CAPTIONS_METADATA') {
        controller.onCaptionTracks(event.data.tracks);
      }
    };

    window.addEventListener('message', onWindowMessage);

    const onRuntimeMessage = (msg: any) => {
      if (msg && msg.type === 'LIVESUB_STT_CUE' && msg.cue) {
        controller.onSttCue(msg.cue);
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
