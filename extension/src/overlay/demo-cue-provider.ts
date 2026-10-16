import type { Cue } from '../shared/cue';
import type { CueProvider } from '../shared/cue-provider';

export const DEMO_INTERVAL = 4; // seconds per cue window
export const DEMO_VISIBLE = 3.5; // seconds visible inside each window (0.5 s gap proves clearing works)

const SAMPLE_LINES: ReadonlyArray<readonly [string, string]> = [
  ['LiveSub is following the video clock.', 'LiveSub वीडियो की घड़ी के साथ चल रहा है।'],
  ['Pause the video and this line freezes.', 'वीडियो रोकें और यह पंक्ति रुक जाएगी।'],
  ['Seek anywhere — the right cue appears instantly.', 'कहीं भी जाएँ — सही उपशीर्षक तुरंत दिखेगा।'],
  ['Try 2× speed: cues change twice as fast.', '2× गति आज़माएँ: उपशीर्षक दोगुनी तेज़ी से बदलेंगे।'],
  ['Real captions and speech arrive in later phases.', 'असली कैप्शन और भाषण अगले चरणों में आएँगे।'],
];

const DEFAULT_SAMPLE: readonly [string, string] = [
  'LiveSub is following the video clock.',
  'LiveSub वीडियो की घड़ी के साथ चल रहा है।',
];

export function formatClock(t: number): string {
  const total = Math.max(0, t);
  const m = Math.floor(total / 60);
  const s = total - m * 60;
  return `${String(m).padStart(2, '0')}:${s.toFixed(1).padStart(4, '0')}`;
}

/** Deterministic demo cue for a given video time — no state, so seeking is trivially correct. */
export function demoCueAt(videoTime: number): Cue | null {
  if (!Number.isFinite(videoTime) || videoTime < 0) return null;
  const index = Math.floor(videoTime / DEMO_INTERVAL);
  const start = index * DEMO_INTERVAL;
  const end = start + DEMO_VISIBLE;
  if (videoTime >= end) return null;

  const sample = SAMPLE_LINES[index % SAMPLE_LINES.length] ?? DEFAULT_SAMPLE;
  const [en, hi] = sample;
  const text = `#${index + 1} · ${formatClock(start)} — ${en}`;
  return {
    id: `demo-${index}`,
    start,
    end,
    lang: 'en',
    text,
    translation: hi,
    translation_lang: 'hi',
    source: 'demo',
    is_final: true,
    revisions: [{ at: start, text }],
  };
}

export class DemoCueProvider implements CueProvider {
  getActiveCue(videoTime: number): Cue | null {
    return demoCueAt(videoTime);
  }
}
