import { describe, expect, it } from 'vitest';
import type { Cue } from '../src/shared/cue';
import { createStore } from '../src/shared/store';
import { DEFAULT_SETTINGS, type LiveSubSettings } from '../src/settings/settings-core';
import { CueStore } from '../src/timeline/cue-store';
import { ActiveCueTranslator } from '../src/translation/active-cue-translator';
import { TranslationCache } from '../src/translation/translation-cache';
import { MockTranslationService } from '../src/translation/translation-service';

function makeCue(id: string, start: number, end: number, text: string, lang = 'en'): Cue {
  return {
    id,
    start,
    end,
    lang,
    text,
    source: 'captions',
    is_final: true,
    revisions: [{ at: start, text }],
  };
}

describe('ActiveCueTranslator', () => {
  it('translates ONLY the currently active cue and NEVER future or past cues', async () => {
    const cueStore = new CueStore();
    cueStore.loadCues([
      makeCue('c1', 1.0, 3.0, 'Hello world'),
      makeCue('c2', 4.0, 7.0, 'Welcome to LiveSub'),
      makeCue('c3', 10.0, 15.0, 'Future subtitle'),
    ]);

    const requestedTexts: string[] = [];
    const mockService = new MockTranslationService();
    mockService.registerHandler((req) => {
      requestedTexts.push(req.text);
      return `[${req.targetLang}] ${req.text}`;
    });

    const settings = createStore<LiveSubSettings>({
      ...DEFAULT_SETTINGS,
      targetLang: 'hi',
    });

    const translator = new ActiveCueTranslator({
      videoId: 'v1',
      sessionId: 's1',
      cueStore,
      translationService: mockService,
      settings,
    });

    // At t=0.5, no cue is active -> no translation requests
    translator.onTime(0.5);
    expect(requestedTexts.length).toBe(0);

    // At t=1.5, cue c1 is active -> only c1 should be translated
    translator.onTime(1.5);
    expect(requestedTexts).toEqual(['Hello world']);

    // Future cues c2 and c3 MUST NOT have been requested
    expect(requestedTexts).not.toContain('Welcome to LiveSub');
    expect(requestedTexts).not.toContain('Future subtitle');

    // Wait for promise resolution
    await Promise.resolve();
    const c1 = cueStore.getActiveCue(1.5);
    expect(c1?.translation).toBe('[hi] Hello world');
    expect(c1?.translation_lang).toBe('hi');

    translator.dispose();
  });

  it('does NOT create duplicate translation requests for the same active cue across repeated time events', async () => {
    const cueStore = new CueStore();
    cueStore.loadCues([makeCue('c1', 1.0, 5.0, 'Stable line')]);

    let requestCount = 0;
    const mockService = new MockTranslationService();
    mockService.registerHandler(() => {
      requestCount++;
      return 'स्थिर पंक्ति';
    });

    const settings = createStore<LiveSubSettings>({
      ...DEFAULT_SETTINGS,
      targetLang: 'hi',
    });

    const translator = new ActiveCueTranslator({
      videoId: 'v1',
      sessionId: 's1',
      cueStore,
      translationService: mockService,
      settings,
    });

    // Simulate 30 animation frames / timeupdate events while c1 is playing
    for (let t = 1.0; t <= 4.5; t += 0.1) {
      translator.onTime(t);
    }

    expect(requestCount).toBe(1);
    await Promise.resolve();
    expect(requestCount).toBe(1);

    translator.dispose();
  });

  it('reuses cached translation immediately upon seeking backward without a new request', async () => {
    const cueStore = new CueStore();
    cueStore.loadCues([
      makeCue('c1', 1.0, 3.0, 'First cue'),
      makeCue('c2', 4.0, 6.0, 'Second cue'),
    ]);

    let requestCount = 0;
    const mockService = new MockTranslationService();
    mockService.registerHandler((req) => {
      requestCount++;
      return `Translated ${req.text}`;
    });

    const cache = new TranslationCache();
    const settings = createStore<LiveSubSettings>({
      ...DEFAULT_SETTINGS,
      targetLang: 'hi',
    });

    const translator = new ActiveCueTranslator({
      videoId: 'v1',
      sessionId: 's1',
      cueStore,
      translationService: mockService,
      settings,
      cache,
    });

    // Play c1
    translator.onTime(1.5);
    expect(requestCount).toBe(1);
    await Promise.resolve();

    // Advance to c2
    translator.onTime(4.5);
    expect(requestCount).toBe(2);
    await Promise.resolve();

    // Now seek backward to c1
    translator.onTime(2.0);
    // Request count MUST STILL be 2 (reused from cache)
    expect(requestCount).toBe(2);
    expect(cueStore.getActiveCue(2.0)?.translation).toBe('Translated First cue');

    translator.dispose();
  });

  it('keeps separate cache entries for different target languages', async () => {
    const cueStore = new CueStore();
    cueStore.loadCues([makeCue('c1', 1.0, 3.0, 'Multilingual text')]);

    const mockService = new MockTranslationService();
    mockService.registerHandler((req) => `${req.targetLang}:${req.text}`);

    const cache = new TranslationCache();
    const settings = createStore<LiveSubSettings>({
      ...DEFAULT_SETTINGS,
      targetLang: 'hi',
    });

    const translator = new ActiveCueTranslator({
      videoId: 'v1',
      sessionId: 's1',
      cueStore,
      translationService: mockService,
      settings,
      cache,
    });

    // Translate to Hindi
    translator.onTime(1.5);
    await Promise.resolve();
    expect(cueStore.getActiveCue(1.5)?.translation).toBe('hi:Multilingual text');

    // Switch target language to Telugu
    settings.set({ ...settings.get(), targetLang: 'te' });
    translator.refresh();
    await Promise.resolve();
    expect(cueStore.getActiveCue(1.5)?.translation).toBe('te:Multilingual text');

    // Switch back to Hindi -> instant cache hit
    settings.set({ ...settings.get(), targetLang: 'hi' });
    translator.refresh();
    expect(cueStore.getActiveCue(1.5)?.translation).toBe('hi:Multilingual text');

    translator.dispose();
  });

  it('does NOT display a delayed translation if the cue ended before the translation returned', async () => {
    const cueStore = new CueStore();
    cueStore.loadCues([
      makeCue('c1', 1.0, 3.0, 'Short cue'),
      makeCue('c2', 3.5, 6.0, 'Subsequent cue'),
    ]);

    let resolveLateTranslation!: (val: string) => void;
    const pendingPromise = new Promise<string>((resolve) => {
      resolveLateTranslation = resolve;
    });

    const mockService = new MockTranslationService();
    mockService.registerHandler((req) => {
      if (req.text === 'Short cue') {
        return pendingPromise as any;
      }
      return new Promise<string>(() => {}) as any; // c2 remains in-flight
    });

    const settings = createStore<LiveSubSettings>({
      ...DEFAULT_SETTINGS,
      targetLang: 'hi',
    });

    const translator = new ActiveCueTranslator({
      videoId: 'v1',
      sessionId: 's1',
      cueStore,
      translationService: mockService,
      settings,
    });

    // c1 becomes active at t=1.5
    translator.onTime(1.5);

    // Video advances rapidly to t=4.0 (now c2 is active, c1 has expired)
    translator.onTime(4.0);
    expect(cueStore.getActiveCue(4.0)?.id).toBe('c2');

    // The delayed translation for c1 now resolves
    resolveLateTranslation('देर से अनुवाद');
    await Promise.resolve();
    await Promise.resolve();

    // c2 MUST NOT have c1's translation!
    const activeCue = cueStore.getActiveCue(4.0);
    expect(activeCue?.id).toBe('c2');
    expect(activeCue?.translation).toBeUndefined();

    translator.dispose();
  });

  it('safely handles translation API failure without crashing or clearing original text', async () => {
    const cueStore = new CueStore();
    cueStore.loadCues([makeCue('c1', 1.0, 3.0, 'Resilient line')]);

    const failingService = new MockTranslationService();
    failingService.registerHandler(() => {
      throw new Error('Network error 503');
    });

    const settings = createStore<LiveSubSettings>({
      ...DEFAULT_SETTINGS,
      targetLang: 'hi',
    });

    const translator = new ActiveCueTranslator({
      videoId: 'v1',
      sessionId: 's1',
      cueStore,
      translationService: failingService,
      settings,
    });

    expect(() => translator.onTime(1.5)).not.toThrow();
    await Promise.resolve();

    // Original text is preserved and unaffected
    const cue = cueStore.getActiveCue(1.5);
    expect(cue?.text).toBe('Resilient line');
    expect(cue?.translation).toBeUndefined();

    translator.dispose();
  });
});
