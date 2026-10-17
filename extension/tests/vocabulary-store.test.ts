import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadVocabulary,
  saveVocabularyItem,
  deleteVocabularyItem,
  updateVocabularyReview,
  isWordSaved,
  setStorageAdapter,
  type StorageAdapter,
  VOCABULARY_STORAGE_KEY,
} from '../src/learning/vocabulary-store';

describe('vocabulary-store', () => {
  let memoryStore: Record<string, any> = {};

  const memoryAdapter: StorageAdapter = {
    get: async (key: string) => memoryStore[key],
    set: async (items: Record<string, any>) => {
      Object.assign(memoryStore, items);
    },
  };

  beforeEach(() => {
    memoryStore = {};
    setStorageAdapter(memoryAdapter);
  });

  it('saves a new vocabulary word and retrieves it', async () => {
    const item = await saveVocabularyItem({
      word: 'beautiful',
      sourceLanguage: 'en',
      targetLanguage: 'ta',
      meaning: 'pleasing to the senses or mind',
      translation: 'அழகான',
      exampleSentence: 'The mountain view is beautiful.',
      contextSentence: 'She has a beautiful smile.',
    });

    expect(item.id).toBe('beautiful::en::ta');
    expect(item.reviewStatus).toBe('new');
    expect(item.reviewCount).toBe(0);

    const all = await loadVocabulary();
    expect(all.length).toBe(1);
    expect(all[0]!.word).toBe('beautiful');
    expect(all[0]!.translation).toBe('அழகான');
  });

  it('prevents duplicate entries for the same word and language pair', async () => {
    await saveVocabularyItem({
      word: 'knowledge',
      sourceLanguage: 'en',
      targetLanguage: 'hi',
      meaning: 'facts and information',
      translation: 'ज्ञान',
      exampleSentence: 'Knowledge is power.',
      contextSentence: 'Enjoy the knowledge.',
    });

    // Save again with slightly updated meaning
    await saveVocabularyItem({
      word: 'knowledge',
      sourceLanguage: 'en',
      targetLanguage: 'hi',
      meaning: 'facts, information, and skills acquired through experience',
      translation: 'ज्ञान',
      exampleSentence: 'Knowledge is power.',
      contextSentence: 'Enjoy the knowledge.',
    });

    const all = await loadVocabulary();
    expect(all.length).toBe(1);
    expect(all[0]!.meaning).toContain('skills acquired through experience');
  });

  it('stores distinct entries for different target language pairs', async () => {
    await saveVocabularyItem({
      word: 'friend',
      sourceLanguage: 'en',
      targetLanguage: 'hi',
      meaning: 'a person whom one knows and with whom one has a bond',
      translation: 'दोस्त',
      exampleSentence: 'He is my best friend.',
      contextSentence: 'Hello my friend.',
    });

    await saveVocabularyItem({
      word: 'friend',
      sourceLanguage: 'en',
      targetLanguage: 'mr',
      meaning: 'a person whom one knows and with whom one has a bond',
      translation: 'मित्र',
      exampleSentence: 'He is my best friend.',
      contextSentence: 'Hello my friend.',
    });

    const all = await loadVocabulary();
    expect(all.length).toBe(2);
    expect(await isWordSaved('friend', 'en', 'hi')).toBe(true);
    expect(await isWordSaved('friend', 'en', 'mr')).toBe(true);
    expect(await isWordSaved('friend', 'en', 'ta')).toBe(false);
  });

  it('deletes an item by id', async () => {
    const item = await saveVocabularyItem({
      word: 'wisdom',
      sourceLanguage: 'en',
      targetLanguage: 'hi',
      meaning: 'quality of having experience',
      translation: 'बुद्धिमत्ता',
      exampleSentence: 'Wisdom comes with age.',
      contextSentence: 'Words of wisdom.',
    });

    expect(await isWordSaved('wisdom', 'en', 'hi')).toBe(true);
    const deleted = await deleteVocabularyItem(item.id);
    expect(deleted).toBe(true);
    expect(await isWordSaved('wisdom', 'en', 'hi')).toBe(false);

    const all = await loadVocabulary();
    expect(all.length).toBe(0);
  });

  it('advances review status with spaced repetition responses', async () => {
    const item = await saveVocabularyItem({
      word: 'resilient',
      sourceLanguage: 'en',
      targetLanguage: 'hi',
      meaning: 'able to withstand or recover quickly from difficult conditions',
      translation: 'लचीला',
      exampleSentence: 'She is remarkably resilient.',
      contextSentence: 'LiveSub is resilient.',
    });

    expect(item.reviewStatus).toBe('new');

    // First remembered: moves to 'learning'
    const step1 = await updateVocabularyReview(item.id, true);
    expect(step1?.reviewStatus).toBe('learning');
    expect(step1?.reviewCount).toBe(1);

    // Second remembered
    const step2 = await updateVocabularyReview(item.id, true);
    expect(step2?.reviewStatus).toBe('learning');
    expect(step2?.reviewCount).toBe(2);

    // Third remembered: moves to 'mastered'
    const step3 = await updateVocabularyReview(item.id, true);
    expect(step3?.reviewStatus).toBe('mastered');
    expect(step3?.reviewCount).toBe(3);

    // Review again failure: moves back to 'learning'
    const step4 = await updateVocabularyReview(item.id, false);
    expect(step4?.reviewStatus).toBe('learning');
  });
});
