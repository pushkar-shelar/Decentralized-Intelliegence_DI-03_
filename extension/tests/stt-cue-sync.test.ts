import { describe, expect, it } from 'vitest';
import type { Cue } from '../src/shared/cue';
import { CueStore } from '../src/timeline/cue-store';

describe('STT Live Cue Synchronization', () => {
  it('correctly updates partial hypotheses into a finalized cue in-place', () => {
    const store = new CueStore();

    // 1. First partial arrives at video time 12.0s
    const partial1: Cue = {
      id: 'stt-0001',
      start: 12.0,
      end: 12.8,
      lang: 'hi',
      text: 'आज हम',
      source: 'stt',
      is_final: false,
      revisions: [{ at: 12.0, text: 'आज हम' }],
    };
    store.upsertCue(partial1);

    expect(store.length).toBe(1);
    expect(store.getActiveCue(12.2)?.text).toBe('आज हम');
    expect(store.getActiveCue(12.2)?.is_final).toBe(false);

    // 2. Second partial arrives at video time 13.5s (speech continues)
    const partial2: Cue = {
      id: 'stt-0001',
      start: 12.0,
      end: 13.8,
      lang: 'hi',
      text: 'आज हम पनीर टिक्का',
      source: 'stt',
      is_final: false,
      revisions: [{ at: 13.5, text: 'आज हम पनीर टिक्का' }],
    };
    store.upsertCue(partial2);

    // Still only 1 cue in the store (updated in-place!)
    expect(store.length).toBe(1);
    expect(store.getActiveCue(12.5)?.text).toBe('आज हम पनीर टिक्का');
    expect(store.getActiveCue(12.5)?.revisions.length).toBe(2);

    // 3. Finalized utterance arrives when speaker pauses
    const finalCue: Cue = {
      id: 'stt-0001',
      start: 12.0,
      end: 14.5,
      lang: 'hi',
      text: 'आज हम पनीर टिक्का बनाएंगे।',
      source: 'stt',
      is_final: true,
      first_shown_at: 14.5,
      revisions: [{ at: 14.5, text: 'आज हम पनीर टिक्का बनाएंगे।' }],
    };
    store.upsertCue(finalCue);

    expect(store.length).toBe(1);
    const active = store.getActiveCue(13.0);
    expect(active?.text).toBe('आज हम पनीर टिक्का बनाएंगे।');
    expect(active?.is_final).toBe(true);
    expect(active?.first_shown_at).toBe(14.5);
    expect(active?.revisions.length).toBe(3);
  });
});
