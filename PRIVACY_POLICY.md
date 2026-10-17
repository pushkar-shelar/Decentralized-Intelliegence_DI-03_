# Privacy Policy for LiveSub

**Last Updated:** October 17, 2026

LiveSub ("we", "our", or "the extension") is committed to protecting your privacy. This Privacy Policy explains how LiveSub handles your information when you use our Chrome Extension.

---

### 1. Overview & Single Purpose
LiveSub is an open-source productivity and accessibility extension designed solely to provide real-time multilingual subtitles, dual-track translation, and speaker-attributed captions on YouTube videos.

---

### 2. Data We Do NOT Collect
- We **do not** collect, store, or sell any personally identifiable information (PII).
- We **do not** collect your name, email, IP address, browsing history, or account credentials.
- We **do not** track your activity outside of YouTube watch pages.
- We **do not** log or record your personal conversations or keystrokes.

---

### 3. Permissions & Data Usage

LiveSub requests minimal permissions strictly necessary to perform its core captioning functionality:

| Permission | Purpose & Scope |
| :--- | :--- |
| **`storage`** | Used locally within your browser to persist your display preferences (e.g., font size, subtitle color, dual-language mode, target language). No settings leave your device. |
| **`tabCapture`** | Captures the audio of the active YouTube tab solely to generate real-time speech-to-text when native captions are unavailable. Audio is streamed ephemerally in memory to the local ASR engine and is **never stored, recorded, or shared**. |
| **`offscreen`** | Required by Chrome Manifest V3 to perform audio resampling (16kHz mono) in a background worker without affecting YouTube playback performance. |
| **`activeTab`** | Ensures that audio capture is only initiated when you explicitly interact with the extension on the current YouTube page. |
| **`*://www.youtube.com/*`** | Injects the subtitle rendering overlay directly above the YouTube HTML5 video player and reads available caption metadata. |

---

### 4. Third-Party Services & Remote Processing
- Subtitle translation requests are processed ephemerally to translate caption strings into your chosen target language.
- When connected to a local or self-hosted LiveSub ASR backend, audio packets are processed in real-time RAM and discarded immediately after transcription. No audio files are retained.

---

### 5. Data Security
Because all styling settings are stored inside Chrome's sandboxed `chrome.storage.local` and all audio streams are transient in-memory buffers, your data remains secure on your own machine.

---

### 6. Changes to This Policy
We may update our Privacy Policy from time to time. Any changes will be posted on this page with an updated revision date.

---

### 7. Contact Us
If you have any questions or concerns regarding this Privacy Policy, please open an issue on our GitHub repository:  
https://github.com/pushkar-shelar/LiveSub
