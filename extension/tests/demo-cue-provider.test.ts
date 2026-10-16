import { describe, expect, it } from 'vitest';
import { DEMO_VISIBLE, DemoCueProvider, demoCueAt } from '../src/overlay/demo-cue-provider';

describe('DemoCueProvider', () => {
  const provider = new DemoCueProvider();

  it('returns null for negative or non-finite times', () => {
    expect(demoCueAt(-1)).toBeNull();
    expect(demoCueAt(NaN)).toBeNull();
    expect(demoCueAt(Infinity)).toBeNull();
  });

  it('returns a cue during the active window of a slot', () => {
    // Slot 0: [0, 3.5]
    const cue0 = provider.getActiveCue(0.5);
    expect(cue0).not.toBeNull();
    expect(cue0?.id).toBe('demo-0');
    expect(cue0?.start).toBe(0);
    expect(cue0?.end).toBe(DEMO_VISIBLE);
    expect(cue0?.text).toContain('#1');
    expect(cue0?.translation).toBeDefined();

    // Slot 1: [4.0, 7.5]
    const cue1 = provider.getActiveCue(4.5);
    expect(cue1).not.toBeNull();
    expect(cue1?.id).toBe('demo-1');
    expect(cue1?.start).toBe(4);
    expect(cue1?.end).toBe(4 + DEMO_VISIBLE);
    expect(cue1?.text).toContain('#2');
  });

  it('returns null during the gap period between slots', () => {
    // Gap for slot 0: [3.5, 4.0)
    expect(provider.getActiveCue(3.6)).toBeNull();
    expect(provider.getActiveCue(3.99)).toBeNull();
    // Start of slot 1 at 4.0
    expect(provider.getActiveCue(4.0)).not.toBeNull();
  });

  it('is completely deterministic when seeking back and forth', () => {
    const cueAt10 = provider.getActiveCue(10);
    provider.getActiveCue(25);
    provider.getActiveCue(5);
    expect(provider.getActiveCue(10)).toEqual(cueAt10);
  });
});
