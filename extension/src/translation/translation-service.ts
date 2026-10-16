export interface TranslationRequest {
  text: string;
  sourceLang?: string;
  targetLang: string;
  signal?: AbortSignal;
}

export interface TranslationService {
  translate(req: TranslationRequest): Promise<string>;
}

const LOG = '[LiveSub Translation]';

/**
 * Free Google Translate API service (client=gtx).
 * Requires no API keys, runs directly in browser extension context,
 * and accurately handles English, Hindi, Marathi, Tamil, Telugu.
 */
export class GoogleGtxTranslationService implements TranslationService {
  constructor(private readonly timeoutMs = 8000) {}

  async translate(req: TranslationRequest): Promise<string> {
    const { text, sourceLang = 'auto', targetLang, signal } = req;
    const clean = text.trim();
    if (!clean) return '';

    // If source and target are identical, return as is
    if (sourceLang && sourceLang !== 'auto' && sourceLang.toLowerCase() === targetLang.toLowerCase()) {
      return clean;
    }

    const sl = encodeURIComponent(sourceLang || 'auto');
    const tl = encodeURIComponent(targetLang);
    const q = encodeURIComponent(clean);
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sl}&tl=${tl}&dt=t&q=${q}`;

    const controller = new AbortController();
    const onAbort = () => controller.abort();
    if (signal) {
      if (signal.aborted) throw new DOMException('aborted', 'AbortError');
      signal.addEventListener('abort', onAbort, { once: true });
    }

    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) {
        throw new Error(`Translation HTTP error: ${res.status}`);
      }

      const data = await res.json();
      if (!Array.isArray(data) || !Array.isArray(data[0])) {
        throw new Error('Unexpected translation response structure');
      }

      // data[0] contains pairs of [translatedSegment, sourceSegment]
      const translated = (data[0] as Array<[string, ...unknown[]]>)
        .map((chunk) => (typeof chunk?.[0] === 'string' ? chunk[0] : ''))
        .join('');

      return translated.trim() || clean;
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') {
        throw err;
      }
      console.warn(LOG, 'Translation failed', err);
      throw err;
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
    }
  }
}

/**
 * Deterministic mock translation service for unit tests and offline testing.
 */
export class MockTranslationService implements TranslationService {
  private customHandlers: Array<(req: TranslationRequest) => string | undefined> = [];

  registerHandler(handler: (req: TranslationRequest) => string | undefined): () => void {
    this.customHandlers.push(handler);
    return () => {
      this.customHandlers = this.customHandlers.filter((h) => h !== handler);
    };
  }

  async translate(req: TranslationRequest): Promise<string> {
    for (const h of this.customHandlers) {
      const res = h(req);
      if (res !== undefined) return res;
    }
    return `[${req.targetLang}] ${req.text}`;
  }
}
