# LiveSub 🎥 🔤

LiveSub is a Chrome extension that generates real-time multilingual subtitles for YouTube videos, even when the video has no captions, keeps everything synchronized with video playback, and supports Indian languages.

## Project Structure

```
LiveSub/
├── extension/            # WXT + React 19 + TypeScript (Manifest V3)
│   ├── entrypoints/      # background, youtube content script, popup
│   ├── src/              # overlay, session, youtube player tracking, settings, shared cue
│   └── tests/            # Vitest unit tests
├── backend/              # Python FastAPI + Speech recognition + Translation (Phases 3-5)
├── shared/
│   └── schema/           # Normalized JSON Schemas for cues & protocols
├── evaluation/           # Benchmarking & test suites (Phase 7)
└── README.md
```

## Quick Start (Phase 1 — Extension Skeleton)

### Prerequisites
- Node.js 18+ (tested on Node v24)
- Google Chrome

### Development & Build
1. Change into the extension directory:
   ```bash
   cd extension
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Run tests:
   ```bash
   npm run test
   ```
4. Build the extension:
   ```bash
   npm run build
   ```

### Loading in Google Chrome
1. Open Chrome and navigate to `chrome://extensions/`.
2. Toggle **Developer mode** ON (top right).
3. Click **Load unpacked** (top left).
4. Select the directory: `LiveSub/extension/.output/chrome-mv3`.
5. Open any YouTube video to see the synchronized subtitle overlay and click the extension icon to customize settings.
