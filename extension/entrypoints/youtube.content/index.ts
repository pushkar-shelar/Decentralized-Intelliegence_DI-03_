import { defineContentScript } from 'wxt/utils/define-content-script';
import { SessionController } from '../../src/session/session-controller';
import { loadSettings, subscribeSettings } from '../../src/settings/settings';
import { createStore } from '../../src/shared/store';
import { watchNavigation } from '../../src/youtube/navigation';

export default defineContentScript({
  matches: ['*://www.youtube.com/*'],
  runAt: 'document_idle',
  // Overlay CSS is injected into its own Shadow DOM by mountOverlay — never into the page.
  cssInjectionMode: 'manual',

  async main(ctx) {
    const settings = createStore(await loadSettings());
    const controller = new SessionController(settings);

    const unsubscribeSettings = subscribeSettings((next) => settings.set(next));
    const stopNavigation = watchNavigation((videoId) => void controller.onVideoChange(videoId));

    // Extension reloaded/updated: clean up so the old content script doesn't leave a ghost overlay.
    ctx.onInvalidated(() => {
      stopNavigation();
      unsubscribeSettings();
      controller.dispose();
    });
  },
});
