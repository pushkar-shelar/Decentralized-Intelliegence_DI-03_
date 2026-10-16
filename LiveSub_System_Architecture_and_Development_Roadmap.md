LiveSub --- Complete System Architecture & Development Roadmap LiveSub
is a Chrome extension that generates real-time multilingual subtitles
for YouTube videos, even when the video has no captions. It can also
translate subtitles, display two languages simultaneously, and keep
everything synchronized with video playback. The best way to build it is
to divide it into independent modules, develop the simplest working
pipeline first, and then improve accuracy, latency, and Indian-language
support. The architecture and requirements below are based on your
uploaded LiveSub project brief. Pasted text.txt

1.  System architecture YouTube Video Player Video playback · audio ·
    play/pause · seek · playback speed

Chrome Extension --- Manifest V3 Caption Detector Find available caption
tracks

Tab Audio Capture Capture audio in memory

Path A: Captions Read available cues and timestamps

Path B: No captions Audio chunks → speech recognition

Speech AI + Language Processing VAD → streaming STT → language detection
→ translation

Subtitle Timeline & Overlay Timestamp alignment · revisions · dual
subtitles · styling · seek recovery

Cue Log & Export JSON session log · SRT/VTT export · latency and
accuracy metrics

The two caption paths should converge on a single normalized subtitle
format. That makes translation, rendering, synchronization, and export
reusable regardless of where the original text came from. 2. Break the
project into development modules Build order: each module should have a
testable output before you move to the next. 01

Chrome extension and YouTube integration Foundation - Create a Manifest
V3 extension. - Detect the active YouTube video and player. - Add a
settings popup for source language, target language, and subtitle
styles. - Insert an overlay that works in normal, theatre, and
fullscreen modes. - Detect video navigation without a page reload.
Output: a working extension with a sample subtitle overlay.

02

Caption detection and extraction - Detect available caption tracks and
languages. - Parse caption text and timestamps into a common cue
structure. - Use the caption path whenever usable tracks are
available. - Translate existing captions without running speech
recognition unnecessarily. Output: accurate, timestamped original
subtitles from captioned videos.

03

Tab audio capture and streaming - Use Chrome's tabCapture API with the
required extension permissions and user interaction. - Keep the video
audible while capturing its audio. - Resample audio to the model's
expected sample rate. - Send short, overlapping chunks to the speech
pipeline. - Detect silence and discard audio associated with ads or
playback transitions. Output: a continuous audio stream with timestamps
mapped to video time.

04

Speech-to-text and language detection - Transcribe audio without
requiring a video download. - Detect Hindi, Marathi, Tamil, Telugu,
English, and supported mixed-language speech. - Produce partial
hypotheses and finalized sentences. - Preserve original script where
possible. Output: text, language, word/sentence timestamps, and revision
events.

05

Translation engine - Translate finalized or sufficiently stable subtitle
segments. - Support the viewer's chosen target language. - Preserve
names, idioms, and conversational meaning. - Cache translations by cue
to prevent duplicate requests. Output: original and translated text
linked to the same cue.

06

Subtitle synchronization engine - Render cues using video time, not a
simple wall-clock timer. - Correct for seeking, pausing, speed changes,
and overlapping chunks. - Reuse cached cues immediately when the user
seeks backwards. - Reset session state when the video or ad state
changes. Output: subtitles that remain aligned with playback.

07

Testing, cue logging, and export - Log start/end time, source, language,
translation, revisions, and first display time. - Export session JSON
and optionally SRT/VTT. - Test all required playback speeds and seeking
sequences. - Measure transcription error, translation quality, and
latency. Output: a reproducible test report and judge-ready extension.

3.  Recommended technology stack I recommend a React + TypeScript Chrome
    extension, a Python AI backend, Whisper for the initial
    speech-recognition engine, and IndicTrans2 for translation. This
    separates browser integration from AI inference, so you can improve
    the models without rebuilding the entire extension. Component
    Recommended technology Purpose Browser extension Chrome Manifest V3
    Permissions, lifecycle, tab audio Extension UI React + TypeScript +
    Vite Popup, settings, controls YouTube integration Content scripts +
    YouTube player API Overlay, video state, playback time Audio
    processing Web Audio API + AudioWorklet Resampling, buffering, audio
    chunks Audio activity detection Silero VAD Identify speech and
    silence Real-time communication WebSocket Send chunks and receive
    transcription events Backend API Python + FastAPI Audio processing
    and inference services Speech recognition faster-whisper
    Multilingual transcription and timestamps Indian-language ASR
    alternative IndicConformer / Indic-Transcribe Evaluate specifically
    for Indian languages Translation IndicTrans2 Indian-language
    translation Optional cloud ASR Deepgram or Google Speech-to-Text
    Alternative if hosted inference is preferable Session storage
    In-memory cue store initially Maintain the current video's subtitle
    timeline Testing Pytest + Vitest Backend and frontend unit tests
    Metrics jiwer + sacreBLEU Speech and translation evaluation The
    official model resources describe Whisper large-v3-turbo as a
    multilingual model supporting 99 languages, IndicConformer as a
    600-million-parameter model for 22 Indian languages, and IndicTrans2
    as a translation system covering the 22 scheduled Indian languages.
    These are strong candidates to benchmark rather than assume one will
    win every test.

Hugging Face +2

Which models should you actually use?

1.  Speech-to-text: faster-whisper + large-v3-turbo Start here

-   Good starting point for multilingual speech and automatic language
    detection.
-   Use GPU inference on a compatible backend for lower latency.
-   Keep chunks short enough for streaming but long enough to preserve
    sentence context.
-   Test Hindi, Marathi, Tamil, Telugu, English, and Hinglish
    separately. Model: Whisper large-v3-turbo · Runtime: faster-whisper.

2.  Indian-language ASR: IndicConformer

-   Benchmark against Whisper for Indian-language accuracy.
-   The 600M multilingual checkpoint supports 22 official Indian
    languages.
-   Requires accepting the model's Hugging Face access conditions before
    downloading.
-   The model card also points to Indic-Transcribe as a newer
    alternative worth evaluating. Model: IndicConformer 600M · AI4Bharat
    model information.

Hugging Face +1

3.  Translation: IndicTrans2

-   Use the appropriate model variant and language codes for source and
    target languages.
-   Useful for Hindi ↔ English, Marathi ↔ English, Tamil ↔ English, and
    supported Indic-to-Indic translation.
-   Translate finalized subtitle segments first to avoid excessive
    repeated inference. Model and instructions: IndicTrans2 repository.

GitHub +1

Important design decision: do not run Whisper and IndicConformer
simultaneously on every audio chunk in production. Benchmark them on the
same test clips first, then choose the better model for each language or
operating mode. Running both increases compute cost and latency. For an
initial implementation, use Whisper as the default and add
IndicConformer as a replaceable backend model. Translation should be an
independent service. 4. Datasets: what to download and why You do not
need to train a speech model from scratch. Start with pretrained models
and use datasets to validate accuracy, compare model choices, and
identify language-specific weaknesses. Dataset Use in LiveSub Priority
FLEURS Multilingual speech recognition evaluation across supported
languages High IndicVoices Broader Indian-language speech evaluation and
experimentation High Kathbath / AI4Bharat speech resources Evaluate
Indian-language ASR, particularly regional-language coverage High BPCC
and IN22 Translation development and evaluation for Indic languages High
Mozilla Common Voice Additional speech samples where suitable language
data is available Optional The project brief itself lists FLEURS,
IndicVoices, and Kathbath as labelled speech resources, and points to
jiwer and sacreBLEU for evaluation. IndicTrans2 publishes translation
data and benchmarks, including BPCC and IN22. Pasted text.txt

GitHub +2

How to use these datasets properly 1. Speech recognition: measure Word
Error Rate (WER) for English and Character Error Rate (CER) for
Indian-language scripts, following the project's scoring rules. 2.
Translation: use reference translations to evaluate chrF, then manually
review whether meaning and tone are preserved. 3. Code-mixed speech:
assemble a separate test set of Hinglish and other mixed-language clips.
Ordinary single-language test sets are not enough. 4. Real-world
testing: test public YouTube videos with and without captions, covering
accents, background music, different playback speeds, and noisy audio.
5. Latency testing: record when speech ends and when the final subtitle
first appears. Use datasets according to their actual licences and
terms. Do not assume a dataset's licence automatically covers its
associated model weights, or that every public video is permissible
training material. Keep a held-out test set separate from any
fine-tuning data. 5. Detailed data flow: what happens when someone plays
a video? 1. User opens YouTube and enables LiveSub The extension
identifies the current video, reads its player state, loads settings,
and initializes a fresh subtitle session. 2. Check for captions If an
accessible caption track is available, parse its text and cue
timestamps. If no usable track exists, start the audio capture path. 3.
Capture and prepare audio Capture the current tab's audio after the
appropriate user action. Keep playback audible, resample the audio, and
maintain a mapping between captured audio time and video time. 4. Run
speech recognition Send audio chunks to the ASR service. Return partial
transcription updates as they arrive and finalize text when enough
context is available. 5. Detect language and translate Identify the
dominant spoken language, track supported code-switching, and translate
finalized cues into the selected language. 6. Render synchronized
subtitles The overlay checks the current video time against stored cue
start/end timestamps. Pause, seek, and playback-speed changes are
handled through the player's actual state. 7. Log and export Record each
cue, text revision, source, translation, and first-display time. Export
the session as JSON and optionally SRT/VTT.

The normalized subtitle cue Every module should use the same data
structure. For example: { "id": "cue-001", "start": 12.4, "end": 14.1,
"lang": "hi", "text": "आज हम पनीर टिक्का बनाएंगे", "translation": "Today we
will make paneer tikka", "source": "stt", "first_shown_at": 16.3,
"revisions": \[ { "at": 16.3, "text": "आज हम पनीर टिक्का बनाएंगे" } \] }

This example follows the cue-log format from your project brief. start
and end represent video seconds, not audio-chunk seconds. first_shown_at
is the video time at which the final text first appeared in full. Pasted
text.txt

6.  Synchronization: the most important engineering challenge A speech
    model can produce accurate text and still fail the project if the
    subtitles appear at the wrong time. Implement these rules from the
    beginning:

-   Use video time as the source of truth. The player's current time
    determines which cue is visible.
-   Keep an indexed cue timeline. Store cues sorted by start time, so a
    seek can find the correct subtitle quickly.
-   Track chunk timing. Every audio chunk needs an anchor mapping to the
    corresponding video interval.
-   Support revisions. A provisional transcription may change as more
    audio arrives. Update the same cue instead of creating duplicate
    subtitles.
-   Handle seeking explicitly. When the viewer seeks backwards, reuse
    cached cues immediately; when seeking forwards, suppress stale
    responses from earlier audio.
-   Invalidate old sessions. A new video or ad transition must not mix
    old audio or transcription results into the current video's
    timeline. Playback-speed handling requires special care. If a chunk
    starts at video time (t_0), and its elapsed audio time is
    (`\Delta `{=tex}t_a), then for constant playback speed (r): \[
    t_v=t_0+r`\Delta `{=tex}t_a \]

This formula is only valid within the corresponding playback interval.
For chunks that cross a pause, seek, or speed change, use timestamp
anchors or split the mapping into separate intervals instead of applying
one speed factor to the entire chunk. Chrome's tabCapture API requires
the appropriate permission and user interaction; capturing the tab can
stop its audio from being played locally unless you route the captured
stream back to the output. Build this into the audio module and test it
early.

Chrome for Developers

7.  Backend and extension structure A maintainable repository could look
    like this: livesub/ ├── extension/ │ ├── manifest.json │ ├── src/ │
    │ ├── background/ │ │ │ └── service-worker.ts │ │ ├── content/ │ │ │
    ├── youtube-detector.ts │ │ │ ├── subtitle-overlay.tsx │ │ │ └──
    player-sync.ts │ │ ├── audio/ │ │ │ ├── capture.ts │ │ │ └──
    audio-worklet.ts │ │ ├── captions/ │ │ │ └── caption-parser.ts │ │
    ├── timeline/ │ │ │ └── cue-store.ts │ │ ├── popup/ │ │ └──
    settings/ │ └── tests/ ├── backend/ │ ├── app/ │ │ ├── main.py │ │
    ├── api/ │ │ │ └── websocket.py │ │ ├── audio/ │ │ │ ├── chunker.py
    │ │ │ └── vad.py │ │ ├── models/ │ │ │ ├── asr.py │ │ │ └──
    translation.py │ │ ├── services/ │ │ │ ├── language_detection.py │ │
    │ └── cue_processor.py │ │ └── schemas/ │ │ └── cue.py │ ├── tests/
    │ └── requirements.txt ├── evaluation/ │ ├── asr_benchmark.py │ ├──
    translation_benchmark.py │ └── latency_report.py ├── docs/ │ └──
    architecture.md └── README.md

Keep the backend stateless between independent sessions where practical.
Store the active cue timeline in the extension, with the backend
responsible for processing audio and producing transcription/translation
events. A database is unnecessary for the first working version. 8.
Step-by-step implementation plan Build and validate each phase before
moving on. This reduces the risk of ending up with a polished UI that
has no working speech pipeline. Development checklist 0/20 tasks

1

Phase 1 --- Extension skeleton First

\[ \] Create the React + TypeScript extension \[ \] Load it unpacked in
Chrome \[ \] Detect YouTube and show a sample overlay \[ \] Test
fullscreen and video navigation

2

Phase 2 --- Caption path Second

\[ \] Detect available caption tracks \[ \] Parse source text and
timestamps \[ \] Render captions using video time \[ \] Test pause,
seek, and playback speed

3

Phase 3 --- Live speech recognition Third

\[ \] Implement tabCapture and audio playback restoration \[ \] Build
audio buffering and VAD \[ \] Connect FastAPI through WebSocket \[ \]
Display live transcription without translation

4

Phase 4 --- Translation Fourth

\[ \] Integrate IndicTrans2 \[ \] Add source and target language
selection \[ \] Implement dual subtitles \[ \] Cache translations and
manage revisions

5

Phase 5 --- Reliability and evaluation Fifth

\[ \] Fix seek and session-reset behavior \[ \] Prevent ad audio from
contaminating the video timeline \[ \] Implement cue-log export \[ \]
Run accuracy, latency, and robustness tests

Copy development checklist 9. Testing and success criteria Use the
acceptance criteria in the original brief as the project's definition of
done. Pasted text.txt

Metric Target Subtitle latency Median ≤ 3 seconds; 90th percentile ≤ 5
seconds Subtitle alignment Median timing gap ≤ 0.5 seconds Backward
seeking Cached subtitles appear within 1 second Video navigation Old
subtitles disappear within 2 seconds Language support English, Hindi,
Marathi, Tamil, Telugu, plus code-mixed testing Caption path Uses
available caption cues and provides translation Audio continuity Video
audio remains audible during capture Export Valid JSON cue log with
revisions and timestamps Measure latency from the end of the relevant
speech to the first full display of the finalized text, consistent with
the supplied brief. Don't rely on average latency alone; slow outliers
can ruin the viewing experience. 10. Privacy, deployment, and
licensing - Never download the YouTube video or extract its media URL.
Process tab audio in memory and export text only. - Make it clear when
audio is sent to a remote inference server, and provide a way to disable
cloud processing. - Keep API keys on the backend, never inside the
extension package or source repository. - Start with an in-memory
backend and local GPU inference. Add persistent storage only if
needed. - Document the licences and access conditions for each selected
model and dataset. IndicConformer requires accepting its Hugging Face
conditions, and model licensing should be checked independently from
dataset licensing.

Hugging Face +1 My final recommendation For the first complete version,
use: - Frontend: React + TypeScript + Vite, packaged as a Chrome
Manifest V3 extension. - Audio: tabCapture + Web Audio API + Silero
VAD. - Backend: Python + FastAPI + WebSocket. - Speech: faster-whisper
with Whisper large-v3-turbo. - Translation: IndicTrans2. - Testing:
FLEURS, IndicVoices, Kathbath, BPCC/IN22, and a separate Hinglish
evaluation set. - Deployment: a local or hosted GPU backend, with the
option to investigate browser-based inference later. Do not begin by
training a custom model, building a database, or creating a complex
dashboard. Get the extension capturing audio and showing synchronized
text first. Then add translation and language-specific optimization. The
most important early milestone is a captioned YouTube video working
through the caption path, followed by a no-caption video working through
the complete audio-to-subtitle pipeline. Once both work reliably, the
remaining features can be built on the same architecture.
