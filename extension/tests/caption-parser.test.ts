import { describe, expect, it } from 'vitest';
import { cleanText, decodeHtmlEntities, parseYouTubeJson3 } from '../src/captions/caption-parser';

describe('caption-parser', () => {
  describe('decodeHtmlEntities & cleanText', () => {
    it('decodes common entities correctly', () => {
      expect(decodeHtmlEntities('&quot;Hello&quot; &amp; welcome&#39;s!')).toBe('"Hello" & welcome\'s!');
      expect(decodeHtmlEntities('&lt;b&gt;bold&lt;/b&gt;')).toBe('<b>bold</b>');
      expect(decodeHtmlEntities('Price: &#36;100 &#x20AC;50')).toBe('Price: $100 €50');
    });

    it('cleans whitespace and replaces newlines with spaces', () => {
      expect(cleanText('  Hello\n\rworld   &amp; friends!  ')).toBe('Hello world & friends!');
    });
  });

  describe('parseYouTubeJson3', () => {
    it('returns empty array for invalid input', () => {
      expect(parseYouTubeJson3(null)).toEqual([]);
      expect(parseYouTubeJson3({})).toEqual([]);
      expect(parseYouTubeJson3({ events: 'not-an-array' })).toEqual([]);
    });

    it('parses valid YouTube JSON3 payload into normalized cues', () => {
      const fixture = {
        wireMagic: 'pb3',
        events: [
          {
            tStartMs: 1200,
            dDurationMs: 2500,
            segs: [{ utf8: 'Welcome to ' }, { utf8: 'LiveSub &amp; YouTube' }],
          },
          {
            // Empty newline marker that should be discarded
            tStartMs: 3700,
            dDurationMs: 500,
            segs: [{ utf8: '\n' }],
          },
          {
            tStartMs: 4200,
            dDurationMs: 3100,
            segs: [{ utf8: 'Real-time multilingual captions' }],
          },
        ],
      };

      const cues = parseYouTubeJson3(fixture, 'en');
      expect(cues.length).toBe(2);

      const [c1, c2] = cues;
      expect(c1?.start).toBe(1.2);
      expect(c1?.end).toBe(3.7);
      expect(c1?.text).toBe('Welcome to LiveSub & YouTube');
      expect(c1?.lang).toBe('en');
      expect(c1?.source).toBe('captions');
      expect(c1?.is_final).toBe(true);

      expect(c2?.start).toBe(4.2);
      expect(c2?.end).toBe(7.3);
      expect(c2?.text).toBe('Real-time multilingual captions');
    });

    it('provides fallback duration when dDurationMs is missing or zero', () => {
      const fixture = {
        events: [
          {
            tStartMs: 10000,
            segs: [{ utf8: 'No duration provided' }],
          },
        ],
      };

      const cues = parseYouTubeJson3(fixture);
      expect(cues[0]?.start).toBe(10);
      expect(cues[0]?.end).toBe(12.5); // 10 + default 2.5s fallback
    });
  });
});
