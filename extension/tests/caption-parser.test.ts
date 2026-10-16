import { describe, expect, it } from 'vitest';
import {
  cleanText,
  decodeHtmlEntities,
  parseCaptionData,
  parseYouTubeJson3,
  parseYouTubeXml,
} from '../src/captions/caption-parser';

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

    it('correctly handles non-English Indian language Unicode text in JSON3', () => {
      const fixture = {
        events: [
          {
            tStartMs: 0,
            dDurationMs: 3000,
            segs: [{ utf8: 'आज हम पनीर टिक्का बनाएंगे' }],
          },
          {
            tStartMs: 3500,
            dDurationMs: 2500,
            segs: [{ utf8: 'இன்று நாம் சமையல் செய்வோம்' }],
          },
          {
            tStartMs: 6500,
            dDurationMs: 2000,
            segs: [{ utf8: 'ఈ రోజు వంట నేర్చుకుందాం' }],
          },
        ],
      };

      const cues = parseYouTubeJson3(fixture, 'hi');
      expect(cues.length).toBe(3);
      expect(cues[0]?.text).toBe('आज हम पनीर टिक्का बनाएंगे');
      expect(cues[1]?.text).toBe('இன்று நாம் சமையல் செய்வோம்');
      expect(cues[2]?.text).toBe('ఈ రోజు వంట నేర్చుకుందాం');
    });
  });

  describe('parseYouTubeXml & parseCaptionData', () => {
    it('returns empty array for invalid or empty XML', () => {
      expect(parseYouTubeXml('')).toEqual([]);
      expect(parseYouTubeXml('not-xml')).toEqual([]);
      expect(parseYouTubeXml('<transcript></transcript>')).toEqual([]);
    });

    it('parses YouTube XML caption track with durations and multiline text', () => {
      const xml = `
        <transcript>
          <text start="1.5" dur="2.8">First line&#10;second line &amp; more</text>
          <text start="5.0" dur="3.0">आज का &quot;विशेष&quot; भोजन</text>
        </transcript>
      `;

      const cues = parseYouTubeXml(xml, 'hi');
      expect(cues.length).toBe(2);

      expect(cues[0]?.start).toBe(1.5);
      expect(cues[0]?.end).toBe(4.3);
      expect(cues[0]?.text).toBe('First line second line & more');

      expect(cues[1]?.start).toBe(5.0);
      expect(cues[1]?.end).toBe(8.0);
      expect(cues[1]?.text).toBe('आज का "विशेष" भोजन');
      expect(cues[1]?.lang).toBe('hi');
    });

    it('parseCaptionData automatically detects JSON vs XML strings', () => {
      const jsonStr = JSON.stringify({
        events: [{ tStartMs: 2000, dDurationMs: 1000, segs: [{ utf8: 'JSON cue' }] }],
      });
      const xmlStr = '<transcript><text start="2.0" dur="1.0">XML cue</text></transcript>';

      const fromJson = parseCaptionData(jsonStr);
      const fromXml = parseCaptionData(xmlStr);

      expect(fromJson.length).toBe(1);
      expect(fromJson[0]?.text).toBe('JSON cue');

      expect(fromXml.length).toBe(1);
      expect(fromXml[0]?.text).toBe('XML cue');
    });
  });
});
