import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LearningService } from '../src/learning/learning-service';
import { MockTranslationService } from '../src/translation/translation-service';

describe('learning-service', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (typeof url === 'string' && url.includes('dictionaryapi.dev')) {
          const word = url.split('/').pop() || 'test';
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () =>
              Promise.resolve([
                {
                  word,
                  phonetic: `/${word}/`,
                  meanings: [
                    {
                      partOfSpeech: 'adjective',
                      definitions: [
                        {
                          definition: `Pleasing or fine quality of ${word}.`,
                          example: `This is a truly ${word} example.`,
                        },
                      ],
                    },
                  ],
                },
              ]),
          });
        }
        return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve([]) });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('looks up a word and returns structured result', async () => {
    const mockTrans = new MockTranslationService();
    mockTrans.registerHandler((req) => {
      if (req.text.toLowerCase() === 'beautiful') return 'அழகான';
      return undefined;
    });

    const service = new LearningService(mockTrans);
    const result = await service.lookupWord({
      word: 'beautiful,',
      sentence: 'The view is beautiful from here.',
      sourceLang: 'en',
      targetLang: 'ta',
    });

    expect(result.word).toBe('beautiful');
    expect(result.translation).toBe('அழகான');
    expect(result.sourceLang).toBe('en');
    expect(result.targetLang).toBe('ta');
    expect(result.meaning).toBeTruthy();
    expect(result.exampleSentence).toBeTruthy();
  });

  it('reuses cached results without triggering redundant translation calls', async () => {
    let callCount = 0;
    const mockTrans = new MockTranslationService();
    mockTrans.registerHandler((req) => {
      callCount++;
      return `translated-${req.text}`;
    });

    const service = new LearningService(mockTrans);
    const res1 = await service.lookupWord({
      word: 'wisdom',
      sentence: 'Wisdom comes with age.',
      sourceLang: 'en',
      targetLang: 'hi',
    });

    const initialCalls = callCount;

    const res2 = await service.lookupWord({
      word: 'wisdom',
      sentence: 'Another sentence with wisdom.',
      sourceLang: 'en',
      targetLang: 'hi',
    });

    expect(res2.translation).toBe(res1.translation);
    expect(callCount).toBe(initialCalls); // Cache hit, no new translation call
  });

  it('handles non-English source words cleanly', async () => {
    const mockTrans = new MockTranslationService();
    mockTrans.registerHandler((req) => {
      if (req.text === 'ज्ञान') return 'knowledge';
      return undefined;
    });

    const service = new LearningService(mockTrans);
    const result = await service.lookupWord({
      word: 'ज्ञान',
      sentence: 'यह सच्चा ज्ञान है।',
      sourceLang: 'hi',
      targetLang: 'en',
    });

    expect(result.word).toBe('ज्ञान');
    expect(result.translation).toBe('knowledge');
    expect(result.meaning).toContain('English equivalent');
  });

  it('rejects with AbortError when signal is already aborted', async () => {
    const mockTrans = new MockTranslationService();
    const service = new LearningService(mockTrans);

    const controller = new AbortController();
    controller.abort();

    await expect(
      service.lookupWord({
        word: 'test',
        sentence: 'test sentence',
        sourceLang: 'en',
        targetLang: 'hi',
        signal: controller.signal,
      }),
    ).rejects.toThrow();
  });
});
