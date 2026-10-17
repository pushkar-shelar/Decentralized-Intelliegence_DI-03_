import { browser } from 'wxt/browser';

export interface VocabularyItem {
  id: string;
  word: string;
  normalizedWord: string;
  sourceLanguage: string;
  targetLanguage: string;
  meaning: string;
  translation: string;
  exampleSentence: string;
  exampleTranslation?: string;
  pronunciation?: string;
  partOfSpeech?: string;
  contextSentence: string;
  videoTitle?: string;
  videoUrl?: string;
  timestampSeconds?: number;
  createdAt: number;
  updatedAt: number;
  reviewStatus: 'new' | 'learning' | 'mastered';
  reviewCount: number;
  lastReviewedAt?: number;
}

export const VOCABULARY_STORAGE_KEY = 'livesub:vocabulary';

export function createVocabularyId(word: string, sourceLang: string, targetLang: string): string {
  const norm = word.trim().toLowerCase();
  const sl = (sourceLang || 'auto').toLowerCase();
  const tl = (targetLang || 'en').toLowerCase();
  return `${norm}::${sl}::${tl}`;
}

export interface StorageAdapter {
  get(key: string): Promise<any>;
  set(items: Record<string, any>): Promise<void>;
  onChanged?: {
    addListener(cb: (changes: Record<string, { newValue?: unknown }>, area: string) => void): void;
    removeListener(cb: (changes: Record<string, { newValue?: unknown }>, area: string) => void): void;
  };
}

let activeStorageAdapter: StorageAdapter | null = null;

export function setStorageAdapter(adapter: StorageAdapter | null): void {
  activeStorageAdapter = adapter;
}

function getStorage(): StorageAdapter {
  if (activeStorageAdapter) return activeStorageAdapter;
  return {
    get: async (key: string) => {
      try {
        const res = await browser.storage.local.get(key);
        return res[key];
      } catch {
        return undefined;
      }
    },
    set: async (items: Record<string, any>) => {
      try {
        await browser.storage.local.set(items);
      } catch {
        // ignore
      }
    },
    onChanged: browser.storage?.onChanged,
  };
}

/**
 * Loads the complete vocabulary list from persistent storage.
 */
export async function loadVocabulary(): Promise<VocabularyItem[]> {
  const storage = getStorage();
  const raw = await storage.get(VOCABULARY_STORAGE_KEY);
  if (!Array.isArray(raw)) return [];
  return raw as VocabularyItem[];
}

/**
 * Saves a new word or updates an existing vocabulary item.
 * Preserves existing review progress if the word was already saved.
 */
export async function saveVocabularyItem(
  item: Omit<VocabularyItem, 'id' | 'createdAt' | 'updatedAt' | 'reviewStatus' | 'reviewCount'> &
    Partial<Pick<VocabularyItem, 'id' | 'createdAt' | 'updatedAt' | 'reviewStatus' | 'reviewCount'>>,
): Promise<VocabularyItem> {
  const list = await loadVocabulary();
  const id = item.id || createVocabularyId(item.word, item.sourceLanguage, item.targetLanguage);
  const now = Date.now();

  const existingIdx = list.findIndex((i) => i.id === id);

  let finalItem: VocabularyItem;
  if (existingIdx >= 0) {
    const existing = list[existingIdx]!;
    finalItem = {
      ...existing,
      ...item,
      id,
      normalizedWord: item.word.trim().toLowerCase(),
      updatedAt: now,
      // preserve review counts
      reviewStatus: existing.reviewStatus,
      reviewCount: existing.reviewCount,
    };
    list[existingIdx] = finalItem;
  } else {
    finalItem = {
      id,
      word: item.word.trim(),
      normalizedWord: item.word.trim().toLowerCase(),
      sourceLanguage: item.sourceLanguage || 'en',
      targetLanguage: item.targetLanguage || 'en',
      meaning: item.meaning || '',
      translation: item.translation || '',
      exampleSentence: item.exampleSentence || '',
      exampleTranslation: item.exampleTranslation,
      pronunciation: item.pronunciation,
      partOfSpeech: item.partOfSpeech,
      contextSentence: item.contextSentence || '',
      videoTitle: item.videoTitle,
      videoUrl: item.videoUrl,
      timestampSeconds: item.timestampSeconds,
      createdAt: item.createdAt || now,
      updatedAt: now,
      reviewStatus: item.reviewStatus || 'new',
      reviewCount: item.reviewCount || 0,
    };
    list.unshift(finalItem);
  }

  const storage = getStorage();
  await storage.set({ [VOCABULARY_STORAGE_KEY]: list });
  return finalItem;
}

/**
 * Deletes a word from vocabulary by its unique ID.
 */
export async function deleteVocabularyItem(id: string): Promise<boolean> {
  const list = await loadVocabulary();
  const next = list.filter((i) => i.id !== id);
  if (next.length === list.length) return false;

  const storage = getStorage();
  await storage.set({ [VOCABULARY_STORAGE_KEY]: next });
  return true;
}

/**
 * Updates review spaced-repetition progress:
 * - remembered = true: advances from 'new' -> 'learning' -> 'mastered', increments reviewCount.
 * - remembered = false: resets to 'learning'.
 */
export async function updateVocabularyReview(id: string, remembered: boolean): Promise<VocabularyItem | null> {
  const list = await loadVocabulary();
  const idx = list.findIndex((i) => i.id === id);
  if (idx < 0) return null;

  const item = list[idx]!;
  const now = Date.now();
  const nextCount = item.reviewCount + 1;

  let nextStatus: 'new' | 'learning' | 'mastered' = item.reviewStatus;
  if (remembered) {
    if (item.reviewStatus === 'new') nextStatus = 'learning';
    else if (item.reviewStatus === 'learning' && nextCount >= 3) nextStatus = 'mastered';
  } else {
    nextStatus = 'learning';
  }

  const updated: VocabularyItem = {
    ...item,
    reviewStatus: nextStatus,
    reviewCount: nextCount,
    lastReviewedAt: now,
    updatedAt: now,
  };

  list[idx] = updated;
  const storage = getStorage();
  await storage.set({ [VOCABULARY_STORAGE_KEY]: list });
  return updated;
}

/**
 * Check whether a word is already saved for this language pair.
 */
export async function isWordSaved(word: string, sourceLang: string, targetLang: string): Promise<boolean> {
  const id = createVocabularyId(word, sourceLang, targetLang);
  const list = await loadVocabulary();
  return list.some((i) => i.id === id);
}

/**
 * Subscribe to vocabulary updates across extension components.
 */
export function subscribeVocabulary(listener: (items: VocabularyItem[]) => void): () => void {
  const storage = getStorage();
  if (!storage.onChanged) return () => {};

  const handler = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area === 'local' && VOCABULARY_STORAGE_KEY in changes) {
      const raw = changes[VOCABULARY_STORAGE_KEY]?.newValue;
      listener(Array.isArray(raw) ? (raw as VocabularyItem[]) : []);
    }
  };

  storage.onChanged.addListener(handler);
  return () => storage.onChanged?.removeListener(handler);
}
