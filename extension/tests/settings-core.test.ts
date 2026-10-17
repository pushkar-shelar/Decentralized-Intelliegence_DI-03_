import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, LIMITS, mergeSettings } from '../src/settings/settings-core';

describe('mergeSettings', () => {
  it('returns default settings when passed null or undefined', () => {
    expect(mergeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(mergeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(mergeSettings('string')).toEqual(DEFAULT_SETTINGS);
  });

  it('preserves valid user overrides', () => {
    const custom = {
      enabled: false,
      sourceLang: 'hi' as const,
      targetLang: 'mr' as const,
      displayMode: 'translated' as const,
      fontSize: 32,
      bgOpacity: 0.8,
      position: 15,
    };
    expect(mergeSettings(custom)).toEqual(custom);
  });

  it('clamps out-of-range numeric fields', () => {
    const raw = {
      fontSize: 999,
      bgOpacity: -5,
      position: -10,
    };
    const res = mergeSettings(raw);
    expect(res.fontSize).toBe(LIMITS.fontSize.max);
    expect(res.bgOpacity).toBe(LIMITS.bgOpacity.min);
    expect(res.position).toBe(LIMITS.position.min);
  });

  it('falls back to defaults for invalid enum values', () => {
    const raw = {
      sourceLang: 'unsupported-lang',
      targetLang: 'invalid',
      displayMode: 'gibberish',
      fontSize: 'not-a-number',
    };
    const res = mergeSettings(raw);
    expect(res.sourceLang).toBe(DEFAULT_SETTINGS.sourceLang);
    expect(res.targetLang).toBe(DEFAULT_SETTINGS.targetLang);
    expect(res.displayMode).toBe(DEFAULT_SETTINGS.displayMode);
    expect(res.fontSize).toBe(DEFAULT_SETTINGS.fontSize);
  });
});
