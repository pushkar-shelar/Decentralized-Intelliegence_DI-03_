import { browser } from 'wxt/browser';
import { calculatePcmRms, resampleTo16kMonoPcm } from '../../src/audio/pcm-resampler';
import type { VideoAnchor } from '../../src/audio/anchor-log';

const LOG = '[LiveSub OffscreenAudio]';

interface CaptureSession {
  stream: MediaStream;
  audioCtx: AudioContext;
  processor: ScriptProcessorNode;
  ws: WebSocket | null;
  buffer: Int16Array[];
  bufferedSamples: number;
}

let activeSession: CaptureSession | null = null;
let latestAnchor: VideoAnchor | null = null;
const TARGET_CHUNK_SAMPLES = 3200; // 200ms @ 16kHz

async function startCapture(streamId: string, wsUrl = 'ws://localhost:8765/api/ws/audio'): Promise<void> {
  stopCapture();

  console.info(LOG, 'Starting capture for streamId:', streamId, 'to', wsUrl);

  let stream: MediaStream;
  try {
    // 1. Get tab audio media stream
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId,
        },
      } as any,
    });
  } catch (err: any) {
    console.error(LOG, 'getUserMedia failed for streamId:', streamId, err);
    return;
  }

  // 2. Setup AudioContext and passthrough (keeps audio audible)
  const audioCtx = new AudioContext();
  const source = audioCtx.createMediaStreamSource(stream);
  source.connect(audioCtx.destination); // Crucial: passthrough to user's speakers!

  // 3. Connect to local FastAPI WebSocket bridge
  let ws: WebSocket | null = null;
  try {
    ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => console.info(LOG, 'WebSocket audio stream connected:', wsUrl);
    ws.onerror = (e) => console.warn(LOG, 'WebSocket connection warning:', e);
    ws.onclose = () => console.info(LOG, 'WebSocket connection closed');
    ws.onmessage = (event) => {
      try {
        if (typeof event.data === 'string') {
          const data = JSON.parse(event.data);
          if (data.type === 'cue_update' && data.cue) {
            console.info(LOG, 'Received STT cue update from server:', data.cue);
            browser.runtime.sendMessage({ type: 'LIVESUB_STT_CUE', cue: data.cue }).catch(() => {});
          }
        }
      } catch {
        // Ignored
      }
    };
  } catch (err) {
    console.warn(LOG, 'Could not open WebSocket', err);
  }

  // 4. Audio processor node to capture raw buffers
  const bufferSize = 4096;
  const processor = audioCtx.createScriptProcessor(bufferSize, 2, 1);
  const session: CaptureSession = {
    stream,
    audioCtx,
    processor,
    ws,
    buffer: [],
    bufferedSamples: 0,
  };
  activeSession = session;

  processor.onaudioprocess = (e) => {
    if (!activeSession) return;
    const inputL = e.inputBuffer.getChannelData(0);
    const inputR = e.inputBuffer.numberOfChannels > 1 ? e.inputBuffer.getChannelData(1) : null;

    // Resample to 16kHz mono PCM
    const pcmChunk = resampleTo16kMonoPcm(inputL, inputR, audioCtx.sampleRate, 16000);
    if (pcmChunk.length === 0) return;

    session.buffer.push(pcmChunk);
    session.bufferedSamples += pcmChunk.length;

    // Flush when we accumulate ~200ms of audio
    if (session.bufferedSamples >= TARGET_CHUNK_SAMPLES) {
      flushBuffer(session);
    }
  };

  source.connect(processor);
  // Connect processor through silent gain node to destination to keep it alive
  const silentGain = audioCtx.createGain();
  silentGain.gain.value = 0;
  processor.connect(silentGain);
  silentGain.connect(audioCtx.destination);
}

function flushBuffer(session: CaptureSession): void {
  const total = session.bufferedSamples;
  if (total === 0) return;

  const combined = new Int16Array(total);
  let offset = 0;
  for (const chunk of session.buffer) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }
  session.buffer = [];
  session.bufferedSamples = 0;

  const rms = calculatePcmRms(combined);
  const capturePerfNow = performance.now();

  // Stream binary PCM + header over WebSocket
  if (session.ws && session.ws.readyState === WebSocket.OPEN) {
    // Send metadata header as JSON
    session.ws.send(
      JSON.stringify({
        type: 'chunk_meta',
        perfNow: capturePerfNow,
        durationMs: (total / 16000) * 1000,
        rms: Number(rms.toFixed(4)),
        anchor: latestAnchor ?? {
          perfNow: capturePerfNow,
          videoTime: 0,
          rate: 1.0,
          paused: false,
        },
        sourceLang: latestAnchor?.sourceLang,
        targetLang: latestAnchor?.targetLang,
      }),
    );
    // Send binary audio payload
    session.ws.send(combined.buffer);
  }
}

function stopCapture(): void {
  if (!activeSession) return;
  console.info(LOG, 'Stopping active audio capture session');
  const { stream, audioCtx, processor, ws } = activeSession;
  activeSession = null;

  try {
    processor.disconnect();
    stream.getTracks().forEach((t) => t.stop());
    void audioCtx.close();
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.close();
    }
  } catch (err) {
    console.warn(LOG, 'Cleanup warning:', err);
  }
}

// Listen to control messages from background service worker or content script
browser.runtime.onMessage.addListener((msg: any) => {
  if (!msg || typeof msg !== 'object') return;

  if (msg.type === 'START_TAB_CAPTURE' && typeof msg.streamId === 'string') {
    void startCapture(msg.streamId, msg.wsUrl);
  } else if (msg.type === 'STOP_TAB_CAPTURE') {
    stopCapture();
  } else if (msg.type === 'VIDEO_ANCHOR' && msg.anchor) {
    latestAnchor = msg.anchor as VideoAnchor;
  }
});
