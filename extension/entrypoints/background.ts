import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { ensureDefaults } from '../src/settings/settings';

const LOG = '[LiveSub Background]';

async function setupOffscreenDocument(path = 'offscreen.html'): Promise<void> {
  const offscreen = (chrome as any).offscreen;
  if (!offscreen) return;

  const existingContexts = await offscreen.hasDocument();
  if (!existingContexts) {
    await offscreen.createDocument({
      url: path,
      reasons: ['USER_MEDIA'],
      justification: 'Capture YouTube tab audio for real-time multilingual subtitles',
    });
    console.info(LOG, 'Created offscreen audio capture document');
  }
}

async function closeOffscreenDocument(): Promise<void> {
  const offscreen = (chrome as any).offscreen;
  if (!offscreen) return;
  const hasDoc = await offscreen.hasDocument();
  if (hasDoc) {
    await offscreen.closeDocument();
    console.info(LOG, 'Closed offscreen audio document');
  }
}

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(() => {
    void ensureDefaults();
  });

  // Handle messages from content script or popup
  browser.runtime.onMessage.addListener((msg: any, sender, sendResponse) => {
    if (!msg || typeof msg !== 'object') return;

    if (msg.type === 'REQUEST_TAB_AUDIO_CAPTURE') {
      const tabId = sender.tab?.id ?? msg.tabId;
      if (!tabId) {
        sendResponse({ success: false, error: 'No active tab ID available' });
        return true;
      }

      (async () => {
        try {
          await setupOffscreenDocument();
          // Get media stream ID for the target tab
          const streamId = await new Promise<string>((resolve, reject) => {
            (chrome.tabCapture as any).getMediaStreamId({ targetTabId: tabId }, (id: string) => {
              if (chrome.runtime.lastError) {
                reject(chrome.runtime.lastError);
              } else {
                resolve(id);
              }
            });
          });

          // Forward to offscreen document
          await browser.runtime.sendMessage({
            type: 'START_TAB_CAPTURE',
            streamId,
            wsUrl: msg.wsUrl ?? 'ws://localhost:8765/api/ws/audio',
          });

          sendResponse({ success: true, streamId });
        } catch (err: any) {
          console.error(LOG, 'Failed to initiate tab audio capture:', err);
          sendResponse({ success: false, error: err?.message ?? String(err) });
        }
      })();
      return true; // async response
    } else if (msg.type === 'STOP_TAB_AUDIO_CAPTURE') {
      (async () => {
        try {
          await browser.runtime.sendMessage({ type: 'STOP_TAB_CAPTURE' }).catch(() => {});
          await closeOffscreenDocument();
          sendResponse({ success: true });
        } catch (err: any) {
          sendResponse({ success: false, error: err?.message });
        }
      })();
      return true;
    }
  });
});
