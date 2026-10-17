import { describe, expect, it } from 'vitest';
import type { Cue } from '../src/shared/cue';
import { CueStore } from '../src/timeline/cue-store';

function makeCue(id: string, start: number, end: number, text: string): Cue {
  return {
    id,
    start,
    end,
    lang: 'en',
    text,
    source: 'captions',
    is_final: true,
    revisions: [{ at: start, text }],
  };
}

describe('CueStore', () => {
  it('returns null for an empty store or invalid times', () => {
    const store = new CueStore();
    expect(store.getActiveCue(0)).toBeNull();
    expect(store.getActiveCue(10)).toBeNull();
    expect(store.getActiveCue(-1)).toBeNull();
    expect(store.getActiveCue(NaN)).toBeNull();
  });

  it('correctly returns the active cue at various video times', () => {
    const store = new CueStore();
    store.loadCues([
      makeCue('c1', 1.0, 3.5, 'Hello world'),
      makeCue('c2', 4.0, 7.0, 'Welcome to LiveSub'),
      makeCue('c3', 10.0, 15.0, 'Subtitles in real time'),
    ]);

    expect(store.getActiveCue(0.5)).toBeNull();
    expect(store.getActiveCue(1.0)?.id).toBe('c1');
    expect(store.getActiveCue(2.0)?.id).toBe('c1');
    expect(store.getActiveCue(3.49)?.id).toBe('c1');
    // Strict boundary when allowLinger is false
    expect(store.getActiveCue(3.5, false)).toBeNull();
    // Default lingering hold: c1 stays visible between 3.5s and 4.0s until c2 arrives
    expect(store.getActiveCue(3.5)?.id).toBe('c1');
    expect(store.getActiveCue(3.9)?.id).toBe('c1');
    // Once next subtitle time arrives at 4.0s, switches immediately to c2
    expect(store.getActiveCue(4.0)?.id).toBe('c2');
    expect(store.getActiveCue(6.9)?.id).toBe('c2');
    // Lingers after c2 until next cue or max linger
    expect(store.getActiveCue(7.5)?.id).toBe('c2');
    expect(store.getActiveCue(10.0)?.id).toBe('c3');
    expect(store.getActiveCue(12.5)?.id).toBe('c3');
    // Long after c3 ended, expires after max linger
    expect(store.getActiveCue(20.0)).toBeNull();
  });

  it('sorts cues loaded out of chronological order', () => {
    const store = new CueStore();
    store.loadCues([
      makeCue('c3', 10.0, 15.0, 'Three'),
      makeCue('c1', 1.0, 3.0, 'One'),
      makeCue('c2', 5.0, 8.0, 'Two'),
    ]);

    const cues = store.getCues();
    expect(cues[0]?.id).toBe('c1');
    expect(cues[1]?.id).toBe('c2');
    expect(cues[2]?.id).toBe('c3');
  });

  it('updates an existing cue and tracks revisions via upsertCue', () => {
    const store = new CueStore();
    store.upsertCue(makeCue('stt-1', 5.0, 7.0, 'Provisional text'));

    expect(store.getActiveCue(5.5)?.text).toBe('Provisional text');

    // Update with finalized revision
    store.upsertCue({
      id: 'stt-1',
      start: 5.0,
      end: 7.5,
      lang: 'en',
      text: 'Finalized recognized speech',
      translation: 'अंतिम मान्यता प्राप्त भाषण',
      translation_lang: 'hi',
      source: 'stt',
      is_final: true,
      revisions: [{ at: 6.0, text: 'Finalized recognized speech' }],
    });

    const updated = store.getActiveCue(5.5);
    expect(updated?.text).toBe('Finalized recognized speech');
    expect(updated?.translation).toBe('अंतिम मान्यता प्राप्त भाषण');
    expect(updated?.is_final).toBe(true);
    expect(updated?.revisions.length).toBe(2);
    expect(updated?.end).toBe(7.5);
  });

  it('notifies subscribers on updates and clear', () => {
    const store = new CueStore();
    let notified = 0;
    const unsub = store.subscribe(() => notified++);

    store.loadCues([makeCue('c1', 1.0, 3.0, 'Hi')]);
    expect(notified).toBe(1);

    store.upsertCue(makeCue('c2', 4.0, 6.0, 'There'));
    expect(notified).toBe(2);

    store.clear();
    expect(notified).toBe(3);
    expect(store.length).toBe(0);

    unsub();
    store.loadCues([makeCue('c3', 7.0, 8.0, 'Bye')]);
    expect(notified).toBe(3); // Unsubscribed
  });

  it('handles 5,000 cues with sub-millisecond lookup times', () => {
    const store = new CueStore();
    const batch: Cue[] = [];
    for (let i = 0; i < 5000; i++) {
      const start = i * 3;
      batch.push(makeCue(`c-${i}`, start, start + 2.5, `Line ${i}`));
    }
    store.loadCues(batch);

    const t0 = performance.now();
    for (let t = 0; t < 1000; t += 0.5) {
      store.getActiveCue(t);
    }
    const durationMs = performance.now() - t0;
    // 2,000 searches should easily take < 10ms total
    expect(durationMs).toBeLessThan(50);
  });
});
