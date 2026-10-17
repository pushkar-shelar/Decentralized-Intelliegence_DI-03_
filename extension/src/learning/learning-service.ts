import { GoogleGtxTranslationService, type TranslationService } from '../translation/translation-service';
import { cleanWordForLookup } from './word-tokenizer';

export interface WordLookupRequest {
  word: string;
  sentence: string;
  sourceLang: string;
  targetLang: string;
  videoTitle?: string;
  videoUrl?: string;
  timestampSeconds?: number;
  signal?: AbortSignal;
}

export interface WordLookupResult {
  word: string;
  normalizedWord: string;
  meaning: string;
  translation: string;
  exampleSentence: string;
  exampleTranslation?: string;
  partOfSpeech?: string;
  pronunciation?: string;
  sourceLang: string;
  targetLang: string;
}

const cache = new Map<string, WordLookupResult>();

export class LearningService {
  constructor(private readonly translationService: TranslationService = new GoogleGtxTranslationService()) {}

  /**
   * Look up contextual definition, translation, and example sentence for a selected word.
   */
  async lookupWord(req: WordLookupRequest): Promise<WordLookupResult> {
    const cleanWord = cleanWordForLookup(req.word);
    if (!cleanWord) {
      throw new Error('Invalid or empty word');
    }

    const sourceLang = (req.sourceLang || 'auto').toLowerCase().split('-')[0]!;
    const targetLang = (req.targetLang || 'en').toLowerCase().split('-')[0]!;
    const cacheKey = `${cleanWord.toLowerCase()}::${sourceLang}::${targetLang}`;

    if (cache.has(cacheKey)) {
      return cache.get(cacheKey)!;
    }

    if (req.signal?.aborted) {
      throw new DOMException('aborted', 'AbortError');
    }

    // 1. Contextual Translation of the word into target language
    let translation = '';
    try {
      translation = await this.translationService.translate({
        text: cleanWord,
        sourceLang,
        targetLang,
        signal: req.signal,
      });
    } catch (e: any) {
      if (e?.name === 'AbortError') throw e;
      translation = cleanWord;
    }

    // 2. Fetch definition, part of speech, pronunciation, and example sentence
    let meaning = '';
    let exampleSentence = '';
    let exampleTranslation = '';
    let partOfSpeech = '';
    let pronunciation = '';

    // Check if word is English (either source is en, or word contains only ASCII alphabetic characters)
    const isEnglish = sourceLang === 'en' || /^[A-Za-z'-]+$/.test(cleanWord);

    if (isEnglish) {
      const dictData = await this.fetchEnglishDictionary(cleanWord, req.signal);
      if (dictData) {
        pronunciation = dictData.pronunciation || '';
        partOfSpeech = dictData.partOfSpeech || '';
        // Find definition that best matches surrounding sentence context
        meaning = this.pickBestContextualDefinition(dictData.definitions, req.sentence);
        exampleSentence = dictData.example || `The word "${cleanWord}" is commonly used in this context.`;
      }
    }

    // Fallback if no English dictionary definition found or non-English word
    if (!meaning) {
      if (sourceLang !== targetLang && translation && translation.toLowerCase() !== cleanWord.toLowerCase()) {
        meaning = `The ${this.getLanguageName(targetLang)} equivalent of "${cleanWord}" in this context.`;
      } else {
        meaning = `Key term extracted from dialogue: "${cleanWord}".`;
      }
    }

    if (!exampleSentence) {
      // Use original subtitle sentence as realistic context example
      exampleSentence = req.sentence.trim();
    }

    // Translate example sentence to target language if target is different from sentence language
    if (exampleSentence && sourceLang !== targetLang) {
      try {
        exampleTranslation = await this.translationService.translate({
          text: exampleSentence,
          sourceLang,
          targetLang,
          signal: req.signal,
        });
      } catch {
        // ignore example translation failure
      }
    }

    const result: WordLookupResult = {
      word: cleanWord,
      normalizedWord: cleanWord.toLowerCase(),
      meaning,
      translation: translation || cleanWord,
      exampleSentence,
      exampleTranslation: exampleTranslation || undefined,
      partOfSpeech: partOfSpeech || undefined,
      pronunciation: pronunciation || undefined,
      sourceLang,
      targetLang,
    };

    cache.set(cacheKey, result);
    return result;
  }

  /**
   * Helper to speak a word aloud using Web Speech API synthesis.
   */
  speak(word: string, lang = 'en'): void {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(word);
      utterance.rate = 0.9; // Slightly slower for language learners

      const langCode = lang.toLowerCase().split('-')[0]!;
      const langMap: Record<string, string> = {
        en: 'en-US',
        hi: 'hi-IN',
        mr: 'mr-IN',
        ta: 'ta-IN',
        te: 'te-IN',
      };
      utterance.lang = langMap[langCode] || 'en-US';

      window.speechSynthesis.speak(utterance);
    } catch {
      // ignore synthesis errors
    }
  }

  /**
   * Query Free Dictionary API for English definitions and examples.
   */
  private async fetchEnglishDictionary(
    word: string,
    signal?: AbortSignal,
  ): Promise<{
    pronunciation?: string;
    partOfSpeech?: string;
    definitions: string[];
    example?: string;
  } | null> {
    try {
      const url = `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`;
      const res = await fetch(url, { signal });
      if (!res.ok) return null;

      const data = await res.json();
      if (!Array.isArray(data) || data.length === 0) return null;

      const entry = data[0];
      const pronunciation = entry.phonetic || entry.phonetics?.find((p: any) => p?.text)?.text || '';

      const definitions: string[] = [];
      let partOfSpeech = '';
      let example = '';

      if (Array.isArray(entry.meanings)) {
        for (const m of entry.meanings) {
          if (!partOfSpeech && m.partOfSpeech) partOfSpeech = m.partOfSpeech;
          if (Array.isArray(m.definitions)) {
            for (const d of m.definitions) {
              if (d.definition) definitions.push(d.definition);
              if (!example && d.example) example = d.example;
            }
          }
        }
      }

      if (definitions.length === 0) return null;

      return {
        pronunciation,
        partOfSpeech,
        definitions,
        example,
      };
    } catch {
      return null;
    }
  }

  /**
   * Picks the definition that has highest keyword overlap with the sentence context,
   * or falls back to the primary definition.
   */
  private pickBestContextualDefinition(definitions: string[], sentence: string): string {
    if (definitions.length === 0) return '';
    if (definitions.length === 1 || !sentence) return definitions[0]!;

    const sentenceWords = new Set(
      sentence
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 3),
    );

    let bestScore = -1;
    let bestDef = definitions[0]!;

    for (const def of definitions) {
      const defWords = def
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 3);

      let score = 0;
      for (const dw of defWords) {
        if (sentenceWords.has(dw)) score++;
      }

      if (score > bestScore) {
        bestScore = score;
        bestDef = def;
      }
    }

    return bestDef;
  }

  private getLanguageName(code: string): string {
    const names: Record<string, string> = {
      en: 'English',
      hi: 'Hindi',
      mr: 'Marathi',
      ta: 'Tamil',
      te: 'Telugu',
    };
    return names[code] || code.toUpperCase();
  }
}

export const learningService = new LearningService();
