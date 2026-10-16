import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'LiveSub',
    description: 'Real-time multilingual subtitles for YouTube — even when the video has no captions.',
    permissions: ['storage', 'tabCapture', 'offscreen', 'activeTab'],
    host_permissions: ['*://www.youtube.com/*'],
  },
});
