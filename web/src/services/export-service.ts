import type { SubtitleCue, SubtitleSettings } from '../types/cue';

/**
 * Format raw speaker label (e.g. SPEAKER_00 -> Speaker 1).
 */
export function formatSpeaker(speaker?: string | null): string | null {
  if (!speaker) return null;
  const trimmed = speaker.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^SPEAKER_(\d+)$/i);
  if (match && match[1]) {
    return `Speaker ${parseInt(match[1], 10) + 1}`;
  }
  return trimmed.replace(/_/g, ' ');
}

/**
 * Format seconds to SRT timestamp: HH:MM:SS,mmm
 */
export function formatSrtTime(seconds: number): string {
  const totalMs = Math.round(Math.max(0, Number.isFinite(seconds) ? seconds : 0) * 1000);
  const ms = totalMs % 1000;
  const totalSecs = Math.floor(totalMs / 1000);
  const secs = totalSecs % 60;
  const totalMins = Math.floor(totalSecs / 60);
  const mins = totalMins % 60;
  const hours = Math.floor(totalMins / 60);

  const hh = String(hours).padStart(2, '0');
  const mm = String(mins).padStart(2, '0');
  const ss = String(secs).padStart(2, '0');
  const mmm = String(ms).padStart(3, '0');

  return `${hh}:${mm}:${ss},${mmm}`;
}

/**
 * Format seconds to WebVTT timestamp: HH:MM:SS.mmm
 */
export function formatVttTime(seconds: number): string {
  const totalMs = Math.round(Math.max(0, Number.isFinite(seconds) ? seconds : 0) * 1000);
  const ms = totalMs % 1000;
  const totalSecs = Math.floor(totalMs / 1000);
  const secs = totalSecs % 60;
  const totalMins = Math.floor(totalSecs / 60);
  const mins = totalMins % 60;
  const hours = Math.floor(totalMins / 60);

  const hh = String(hours).padStart(2, '0');
  const mm = String(mins).padStart(2, '0');
  const ss = String(secs).padStart(2, '0');
  const mmm = String(ms).padStart(3, '0');

  return `${hh}:${mm}:${ss}.${mmm}`;
}

/**
 * Serializes cues to SubRip (.srt) format.
 */
export function exportToSrt(
  cues: SubtitleCue[],
  options: { includeTranslation?: boolean; includeOriginal?: boolean } = { includeTranslation: true, includeOriginal: true },
): string {
  const { includeTranslation = true, includeOriginal = true } = options;
  const blocks: string[] = [];
  let index = 1;

  for (const cue of cues) {
    const lines: string[] = [];
    if (includeOriginal && cue.text) {
      lines.push(cue.text.trim());
    }
    if (includeTranslation && cue.translation && cue.translation.trim().toLowerCase() !== cue.text.trim().toLowerCase()) {
      lines.push(cue.translation.trim());
    }
    if (lines.length === 0) continue;

    const spk = formatSpeaker(cue.speaker);
    if (spk) {
      lines[0] = `[${spk}] ${lines[0]}`;
    }

    const startTs = formatSrtTime(cue.start);
    const endTs = formatSrtTime(cue.end);

    blocks.push(`${index++}\n${startTs} --> ${endTs}\n${lines.join('\n')}`);
  }

  return blocks.length > 0 ? `${blocks.join('\n\n')}\n` : '';
}

/**
 * Serializes cues to WebVTT (.vtt) format.
 */
export function exportToVtt(
  cues: SubtitleCue[],
  options: { includeTranslation?: boolean; includeOriginal?: boolean } = { includeTranslation: true, includeOriginal: true },
): string {
  const { includeTranslation = true, includeOriginal = true } = options;
  const blocks: string[] = ['WEBVTT\n'];

  for (const cue of cues) {
    const lines: string[] = [];
    if (includeOriginal && cue.text) {
      lines.push(cue.text.trim());
    }
    if (includeTranslation && cue.translation && cue.translation.trim().toLowerCase() !== cue.text.trim().toLowerCase()) {
      lines.push(cue.translation.trim());
    }
    if (lines.length === 0) continue;

    const spk = formatSpeaker(cue.speaker);
    const body = spk ? lines.map((l) => `<v ${spk}>${l}`).join('\n') : lines.join('\n');

    const startTs = formatVttTime(cue.start);
    const endTs = formatVttTime(cue.end);

    blocks.push(`${startTs} --> ${endTs}\n${body}`);
  }

  return `${blocks.join('\n\n')}\n`;
}

/**
 * Serializes cues to clean text transcript.
 */
export function exportToTxt(cues: SubtitleCue[]): string {
  const lines: string[] = [];
  for (const cue of cues) {
    const spk = formatSpeaker(cue.speaker);
    const spkPrefix = spk ? `[${spk}] ` : '';
    const timeStr = `[${formatSrtTime(cue.start).slice(3, 8)} - ${formatSrtTime(cue.end).slice(3, 8)}]`;

    lines.push(`${timeStr} ${spkPrefix}${cue.text}`);
    if (cue.translation && cue.translation.trim().toLowerCase() !== cue.text.trim().toLowerCase()) {
      lines.push(`         ${cue.translation}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * Serializes cues to JSON metadata format.
 */
export function exportToJson(cues: SubtitleCue[], videoName: string): string {
  const payload = {
    generator: 'LiveSub Subtitle Studio',
    video_name: videoName,
    exported_at: new Date().toISOString(),
    total_cues: cues.length,
    cues,
  };
  return JSON.stringify(payload, null, 2);
}

/**
 * Browser file download helper.
 */
export function triggerDownload(content: string | Blob, filename: string, mimeType: string): void {
  const blob = typeof content === 'string' ? new Blob([content], { type: `${mimeType};charset=utf-8` }) : content;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/**
 * Client-Side Burned-In Video Generator:
 * Uses HTML5 Canvas + MediaRecorder to render the video frame-by-frame with
 * the exact bilingual subtitles permanently burned into the video stream.
 */
export async function renderBurnedInVideo(params: {
  videoElement: HTMLVideoElement;
  cues: SubtitleCue[];
  settings: SubtitleSettings;
  onProgress?: (progress: number) => void;
  signal?: AbortSignal;
}): Promise<Blob> {
  const { videoElement, cues, settings, onProgress, signal } = params;

  return new Promise(async (resolve, reject) => {
    if (signal?.aborted) return reject(new Error('Rendering cancelled'));

    const canvas = document.createElement('canvas');
    const width = videoElement.videoWidth || 1280;
    const height = videoElement.videoHeight || 720;
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (!ctx) return reject(new Error('Canvas 2D context unavailable'));

    // Check supported mime type
    const mimeTypes = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];
    const selectedMime = mimeTypes.find((m) => MediaRecorder.isTypeSupported(m)) || 'video/webm';

    // Canvas capture stream
    const canvasStream = canvas.captureStream(30);

    // If audio is present, mix video element audio into the stream
    try {
      const audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      const source = audioCtx.createMediaElementSource(videoElement);
      const dest = audioCtx.createMediaStreamDestination();
      source.connect(dest);
      source.connect(audioCtx.destination);
      for (const track of dest.stream.getAudioTracks()) {
        canvasStream.addTrack(track);
      }
    } catch {
      // Audio capture from media element may be restricted; video-only fallback
    }

    const recorder = new MediaRecorder(canvasStream, { mimeType: selectedMime });
    const recordedChunks: Blob[] = [];

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) recordedChunks.push(e.data);
    };

    recorder.onstop = () => {
      const resultBlob = new Blob(recordedChunks, { type: selectedMime });
      resolve(resultBlob);
    };

    recorder.onerror = (err) => reject(err);

    // Save initial video state
    const originalTime = videoElement.currentTime;
    const wasPaused = videoElement.paused;

    videoElement.currentTime = 0;
    await new Promise((r) => {
      const onSeek = () => {
        videoElement.removeEventListener('seeked', onSeek);
        r(null);
      };
      videoElement.addEventListener('seeked', onSeek);
    });

    recorder.start(100);

    const totalDuration = videoElement.duration || 10;
    let animId = 0;

    const renderFrame = () => {
      if (signal?.aborted) {
        cancelAnimationFrame(animId);
        recorder.stop();
        videoElement.pause();
        videoElement.currentTime = originalTime;
        return reject(new Error('Rendering cancelled by user'));
      }

      const currTime = videoElement.currentTime;
      onProgress?.(Math.min(1.0, currTime / totalDuration));

      // 1. Draw video frame
      ctx.drawImage(videoElement, 0, 0, width, height);

      // 2. Find active cue
      const activeCue = cues.find((c) => currTime >= c.start && currTime <= c.end);
      if (activeCue) {
        const lines: { text: string; color: string; size: number }[] = [];
        if (settings.showOriginal && activeCue.text) {
          lines.push({ text: activeCue.text.trim(), color: '#FFFFFF', size: settings.fontSize });
        }
        if (settings.showTranslated && activeCue.translation && activeCue.translation.trim().toLowerCase() !== activeCue.text.trim().toLowerCase()) {
          lines.push({ text: activeCue.translation.trim(), color: '#FCD34D', size: settings.fontSize * 0.95 });
        }

        if (lines.length > 0) {
          const spk = formatSpeaker(activeCue.speaker);
          const baseSize = settings.fontSize;
          ctx.font = `500 ${baseSize}px Poppins, sans-serif`;

          // Measure width
          let maxWidth = 0;
          for (const l of lines) {
            ctx.font = `500 ${l.size}px Poppins, sans-serif`;
            const m = ctx.measureText(l.text);
            if (m.width > maxWidth) maxWidth = m.width;
          }

          const padX = 20;
          const padY = 12;
          const boxWidth = Math.min(width * 0.9, maxWidth + padX * 2);
          const boxHeight = lines.length * (baseSize * 1.4) + (spk ? 20 : 0) + padY * 2;
          const bottomOffset = (settings.position / 100) * height;
          const boxY = height - bottomOffset - boxHeight;
          const boxX = (width - boxWidth) / 2;

          // Background box
          ctx.fillStyle = `rgba(15, 23, 42, ${settings.bgOpacity})`;
          ctx.beginPath();
          ctx.roundRect(boxX, boxY, boxWidth, boxHeight, 8);
          ctx.fill();

          // Render lines
          let textY = boxY + padY + baseSize;
          if (spk) {
            ctx.font = `600 12px Poppins, sans-serif`;
            ctx.fillStyle = '#60A5FA';
            ctx.textAlign = 'center';
            ctx.fillText(spk.toUpperCase(), width / 2, textY - 6);
            textY += 16;
          }

          for (const l of lines) {
            ctx.font = `500 ${l.size}px Poppins, sans-serif`;
            ctx.fillStyle = l.color;
            ctx.textAlign = 'center';
            ctx.fillText(l.text, width / 2, textY);
            textY += l.size * 1.35;
          }
        }
      }

      if (videoElement.ended || currTime >= totalDuration) {
        recorder.stop();
        videoElement.currentTime = originalTime;
        if (!wasPaused) videoElement.play().catch(() => {});
        onProgress?.(1.0);
      } else {
        animId = requestAnimationFrame(renderFrame);
      }
    };

    // Play video to drive recording
    try {
      await videoElement.play();
      animId = requestAnimationFrame(renderFrame);
    } catch (err) {
      recorder.stop();
      reject(err);
    }
  });
}
