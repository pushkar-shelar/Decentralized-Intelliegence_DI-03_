/**
 * Pure settings model — no browser APIs here so it can be unit tested.
 */

export type LangCode = 'en' | 'hi' | 'mr' | 'ta' | 'te';
export type SourceLang = 'auto' | LangCode;
export type DisplayMode = 'original' | 'translated' | 'dual';

export interface Language {
  code: LangCode;
  label: string;
  native: string;
}

export const LANGUAGES: readonly Language[] = [
  { code: 'en', label: 'English', native: 'English' },
  { code: 'hi', label: 'Hindi', native: 'हिन्दी' },
  { code: 'mr', label: 'Marathi', native: 'मराठी' },
  { code: 'ta', label: 'Tamil', native: 'தமிழ்' },
  { code: 'te', label: 'Telugu', native: 'తెలుగు' },
] as const;

export interface LiveSubSettings {
  enabled: boolean;
  sourceLang: SourceLang;
  targetLang: LangCode;
  displayMode: DisplayMode;
  /** Base font size in px at a 720p-tall player; scaled with player height. */
  fontSize: number;
  /** Subtitle background opacity, 0–1. */
  bgOpacity: number;
  /** Distance from the bottom of the player, % of player height. */
  position: number;
  /** Show demo cues (Phase 1 only, until real cue sources exist). */
  demoMode: boolean;
}

export const LIMITS = {
  fontSize: { min: 14, max: 48 },
  bgOpacity: { min: 0, max: 1 },
  position: { min: 2, max: 40 },
} as const;

export const DEFAULT_SETTINGS: Readonly<LiveSubSettings> = Object.freeze({
  enabled: true,
  sourceLang: 'auto',
  targetLang: 'en',
  displayMode: 'dual',
  fontSize: 24,
  bgOpacity: 0.6,
  position: 8,
  demoMode: false,
});

const LANG_CODES = new Set<string>(LANGUAGES.map((l) => l.code));
const DISPLAY_MODES = new Set<string>(['original', 'translated', 'dual']);

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function num(value: unknown, fallback: number, lim: { min: number; max: number }): number {
  return typeof value === 'number' && Number.isFinite(value) ? clamp(value, lim.min, lim.max) : fallback;
}

/**
 * Merge untrusted stored data onto defaults, validating and clamping every field.
 * Unknown keys are dropped; invalid values fall back to defaults.
 */
export function mergeSettings(raw: unknown): LiveSubSettings {
  const d = DEFAULT_SETTINGS;
  if (!raw || typeof raw !== 'object') return { ...d };
  const r = raw as Record<string, unknown>;

  return {
    enabled: typeof r.enabled === 'boolean' ? r.enabled : d.enabled,
    sourceLang:
      r.sourceLang === 'auto' || (typeof r.sourceLang === 'string' && LANG_CODES.has(r.sourceLang))
        ? (r.sourceLang as SourceLang)
        : d.sourceLang,
    targetLang:
      typeof r.targetLang === 'string' && LANG_CODES.has(r.targetLang) ? (r.targetLang as LangCode) : d.targetLang,
    displayMode:
      typeof r.displayMode === 'string' && DISPLAY_MODES.has(r.displayMode)
        ? (r.displayMode as DisplayMode)
        : d.displayMode,
    fontSize: num(r.fontSize, d.fontSize, LIMITS.fontSize),
    bgOpacity: num(r.bgOpacity, d.bgOpacity, LIMITS.bgOpacity),
    position: num(r.position, d.position, LIMITS.position),
    demoMode: typeof r.demoMode === 'boolean' ? r.demoMode : d.demoMode,
  };
}
