import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'LiveSub - Real-Time Multilingual Subtitles for YouTube',
    short_name: 'LiveSub',
    description: 'Real-time multilingual subtitles & dual-track translation for YouTube videos — powered by Whisper AI.',
    version: '1.0.0',
    icons: {
      16: 'icons/icon-16.png',
      32: 'icons/icon-32.png',
      48: 'icons/icon-48.png',
      128: 'icons/icon-128.png',
    },
    action: {
      default_title: 'LiveSub',
      default_icon: {
        16: 'icons/icon-16.png',
        32: 'icons/icon-32.png',
        48: 'icons/icon-48.png',
        128: 'icons/icon-128.png',
      },
    },
    permissions: ['storage', 'tabCapture', 'offscreen', 'activeTab'],
    host_permissions: ['*://www.youtube.com/*', '*://youtube.com/*'],
  },
});
