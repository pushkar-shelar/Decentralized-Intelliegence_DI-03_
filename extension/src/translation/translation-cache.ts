/**
 * Deterministic cache key for subtitle translations.
 * Incorporates videoId, cue identity, text content hash/string, source language, and target language.
 */
export function createTranslationCacheKey(
  videoId: string,
  cueId: string,
  text: string,
  sourceLang: string,
  targetLang: string,
): string {
  // Normalize text to avoid whitespace mismatches
  const normText = text.trim().replace(/\s+/g, ' ');
  return `${videoId}::${cueId}::${sourceLang}::${targetLang}::${normText}`;
}

/**
 * Bounded in-memory translation cache (LRU eviction).
 * Prevents memory growth during long watch sessions while providing
 * instant seek-back recovery.
 */
export class TranslationCache {
  private readonly map = new Map<string, string>();

  constructor(private readonly maxSize = 500) {}

  get(key: string): string | undefined {
    const val = this.map.get(key);
    if (val !== undefined) {
      // Refresh recency
      this.map.delete(key);
      this.map.set(key, val);
    }
    return val;
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  set(key: string, translation: string): void {
    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.maxSize) {
      // Evict oldest
      const oldestKey = this.map.keys().next().value;
      if (oldestKey !== undefined) {
        this.map.delete(oldestKey);
      }
    }
    this.map.set(key, translation);
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }
}
