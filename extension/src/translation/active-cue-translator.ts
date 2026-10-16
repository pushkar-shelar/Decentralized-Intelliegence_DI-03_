import type { Store } from '../shared/store';
import type { LiveSubSettings } from '../settings/settings-core';
import type { CueStore } from '../timeline/cue-store';
import { createTranslationCacheKey, TranslationCache } from './translation-cache';
import type { TranslationService } from './translation-service';

const LOG = '[LiveSub CueTranslator]';

export interface ActiveCueTranslatorOptions {
  videoId: string;
  sessionId: string;
  cueStore: CueStore;
  translationService: TranslationService;
  settings: Store<LiveSubSettings>;
  cache?: TranslationCache;
}

/**
 * Translates ONLY the currently active caption cue on demand.
 *
 * Guarantees:
 * 1. Future cues are never translated in advance.
 * 2. Past cues never trigger translation.
 * 3. Never translates the whole transcript.
 * 4. At most one in-flight request per cache key.
 * 5. Reuses cached translations immediately on backward seek.
 * 6. Drops late responses if the cue ended before the translation returned.
 * 7. Isolates by videoId, sessionId, and targetLang to prevent cross-video leaks.
 */
export class ActiveCueTranslator {
  readonly videoId: string;
  readonly sessionId: string;
  private readonly cueStore: CueStore;
  private readonly translationService: TranslationService;
  private readonly settings: Store<LiveSubSettings>;
  private readonly cache: TranslationCache;

  private inFlight = new Map<string, Promise<string>>();
  private abortController = new AbortController();
  private lastEvaluatedKey: string | null = null;
  private currentVideoTime = 0;
  private disposed = false;

  constructor(options: ActiveCueTranslatorOptions) {
    this.videoId = options.videoId;
    this.sessionId = options.sessionId;
    this.cueStore = options.cueStore;
    this.translationService = options.translationService;
    this.settings = options.settings;
    this.cache = options.cache ?? new TranslationCache(500);
  }

  /**
   * Called on playback time changes (video.currentTime).
   * Cheap to call frequently; dedupes evaluation using cue ID + target language.
   */
  onTime(videoTime: number): void {
    if (this.disposed || !Number.isFinite(videoTime) || videoTime < 0) return;
    this.currentVideoTime = videoTime;

    const s = this.settings.get();
    if (!s.enabled || s.displayMode === 'original') return;

    const targetLang = s.targetLang;
    const cue = this.cueStore.getActiveCue(videoTime);

    if (!cue) {
      this.lastEvaluatedKey = null;
      return;
    }

    const evalKey = `${cue.id}::${targetLang}`;
    if (evalKey === this.lastEvaluatedKey) {
      return; // Already evaluated for this exact active cue and target language
    }
    this.lastEvaluatedKey = evalKey;

    // Determine source language
    const sourceLang = s.sourceLang === 'auto' ? cue.lang : s.sourceLang;

    // If source and target language are identical, clear translation line and return
    if (sourceLang && sourceLang.toLowerCase() === targetLang.toLowerCase()) {
      if (cue.translation) {
        cue.translation = null;
        this.cueStore.upsertCue(cue);
      }
      return;
    }

    // If already translated for this exact target language, nothing to do
    if (cue.translation && cue.translation_lang === targetLang) {
      return;
    }

    // Check cache
    const cacheKey = createTranslationCacheKey(this.videoId, cue.id, cue.text, sourceLang, targetLang);
    if (this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey)!;
      cue.translation = cached;
      cue.translation_lang = targetLang;
      this.cueStore.upsertCue(cue);
      return;
    }

    // Check in-flight (prevent duplicate requests while pending)
    if (this.inFlight.has(cacheKey)) {
      return;
    }

    // Request translation for ONLY this active cue
    const promise = this.translationService.translate({
      text: cue.text,
      sourceLang,
      targetLang,
      signal: this.abortController.signal,
    });

    this.inFlight.set(cacheKey, promise);

    promise
      .then((translated) => {
        this.inFlight.delete(cacheKey);
        this.cache.set(cacheKey, translated);

        if (this.disposed) return;

        // Verify target language has not changed in settings while waiting
        if (this.settings.get().targetLang !== targetLang) return;

        // Verify that this cue is STILL currently active at current video time
        const activeNow = this.cueStore.getActiveCue(this.currentVideoTime);
        if (!activeNow || activeNow.id !== cue.id) {
          // Late response: cue already passed or user seeked away.
          // Do not overwrite whatever is currently on screen!
          return;
        }

        // Apply translation to active cue
        cue.translation = translated;
        cue.translation_lang = targetLang;
        this.cueStore.upsertCue(cue);
      })
      .catch((err) => {
        this.inFlight.delete(cacheKey);
        if ((err as DOMException)?.name !== 'AbortError') {
          console.warn(LOG, 'Translation failed for active cue', cue.id, err);
        }
      });
  }

  /** Re-evaluate active cue (e.g. after target language changes in settings). */
  refresh(): void {
    this.lastEvaluatedKey = null;
    this.onTime(this.currentVideoTime);
  }

  dispose(): void {
    this.disposed = true;
    this.abortController.abort();
    this.inFlight.clear();
  }
}
