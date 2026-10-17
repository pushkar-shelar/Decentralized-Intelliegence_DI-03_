import { describe, expect, it, vi } from 'vitest';
import type { Cue } from '../src/shared/cue';
import { CueStore } from '../src/timeline/cue-store';
import {
  formatSrtTimestamp,
  serializeSrt,
} from '../src/export/srt-serializer';
import {
  formatVttTimestamp,
  serializeWebVtt,
  escapeVttMarkup,
} from '../src/export/vtt-serializer';
import {
  normalizeCuesForExport,
  resolveCueLines,
  cleanSubtitleLines,
} from '../src/export/cue-normalizer';
import {
  generateSubtitleFilename,
  sanitizeFilenameComponent,
} from '../src/export/filename';
import {
  buildSessionExport,
  downloadTextFile,
  downloadSrtFile,
  downloadVttFile,
} from '../src/export/session-export';

describe('Subtitle Export: Cue Normalization and Validation', () => {
  it('preserves immutable input collection and rejects invalid timestamps or non-positive durations', () => {
    const raw: any[] = [
      { id: 'c1', start: 0, end: 2.5, text: 'Valid initial cue', lang: 'en' },
      { id: 'c2', start: -1.0, end: 3.0, text: 'Negative start', lang: 'en' },
      { id: 'c3', start: 5.0, end: 5.0, text: 'Zero duration', lang: 'en' },
      { id: 'c4', start: 8.0, end: 7.0, text: 'Negative duration (end < start)', lang: 'en' },
      { id: 'c5', start: NaN, end: 10.0, text: 'NaN timestamp', lang: 'en' },
      { id: 'c6', start: 10.0, end: Infinity, text: 'Infinite end', lang: 'en' },
      { id: 'c7', start: 12.0, end: 14.0, text: '   ', lang: 'en' }, // empty text
    ];

    const copy = raw.map((item) => ({ ...item }));
    const report = normalizeCuesForExport(raw, { mode: 'original' });

    // Verify input was not mutated
    expect(raw).toEqual(copy);

    expect(report.totalInputCues).toBe(7);
    expect(report.validCuesCount).toBe(1);
    expect(report.cues[0]?.id).toBe('c1');
    expect(report.droppedInvalidTimestamps).toBe(3); // c2 (negative), c5 (NaN), c6 (Infinity)
    expect(report.droppedNonPositiveDuration).toBe(2); // c3 (duration 0), c4 (end < start)
    expect(report.droppedEmpty).toBe(1); // c7 (whitespace only)
  });

  it('filters cues according to playback time range without modifying originals', () => {
    const cues: Cue[] = [
      { id: '1', start: 0.0, end: 1.5, text: 'First', lang: 'en', source: 'captions', revisions: [] },
      { id: '2', start: 3.5, end: 6.0, text: 'Second', lang: 'en', source: 'captions', revisions: [] },
      { id: '3', start: 6.5, end: 7.0, text: 'Third', lang: 'en', source: 'captions', revisions: [] },
      { id: '4', start: 10.0, end: 12.0, text: 'Fourth', lang: 'en', source: 'captions', revisions: [] },
    ];

    const report = normalizeCuesForExport(cues, {
      timeRange: { start: 2.0, end: 7.0 },
    });

    expect(report.validCuesCount).toBe(2);
    expect(report.cues.map((c) => c.id)).toEqual(['2', '3']);
    expect(report.droppedOutOfRange).toBe(2);
  });

  it('preserves legitimate overlapping cues in chronological order with deterministic tie breaker', () => {
    const overlapping: Cue[] = [
      { id: 'c-late', start: 5.0, end: 8.0, text: 'Late started', lang: 'en', source: 'stt', revisions: [] },
      { id: 'c-early', start: 2.0, end: 6.0, text: 'Early started', lang: 'en', source: 'captions', revisions: [] },
      { id: 'c-overlap', start: 2.0, end: 5.5, text: 'Same start earlier end', lang: 'en', source: 'captions', revisions: [] },
    ];

    const report = normalizeCuesForExport(overlapping);
    expect(report.validCuesCount).toBe(3);
    // 2.0 end 5.5, then 2.0 end 6.0, then 5.0 end 8.0
    expect(report.cues[0]?.id).toBe('c-overlap');
    expect(report.cues[1]?.id).toBe('c-early');
    expect(report.cues[2]?.id).toBe('c-late');
  });

  it('cleans multiline text and collapses internal blank lines', () => {
    const lines = cleanSubtitleLines('Line 1\n\n\nLine 2\r\n  Line 3  \n\n');
    expect(lines).toEqual(['Line 1', 'Line 2', 'Line 3']);
  });

  it('handles fallback policies when translation is missing or identical to original', () => {
    // Mode: both
    const bothWithTrans = resolveCueLines({ text: 'Hello', translation: 'नमस्ते' }, 'both');
    expect(bothWithTrans).toEqual(['Hello', 'नमस्ते']);

    // Identical translation should not duplicate
    const bothIdentical = resolveCueLines({ text: 'LiveSub', translation: 'LiveSub' }, 'both');
    expect(bothIdentical).toEqual(['LiveSub']);

    // Missing translation in both mode falls back to original
    const bothMissing = resolveCueLines({ text: 'Original only', translation: null }, 'both');
    expect(bothMissing).toEqual(['Original only']);

    // Mode: translated
    const transOnly = resolveCueLines({ text: 'Hello', translation: 'नमस्ते' }, 'translated');
    expect(transOnly).toEqual(['नमस्ते']);

    // Missing translation in translated mode falls back to original if fallback allowed
    const transFallback = resolveCueLines({ text: 'Original only', translation: null }, 'translated', true);
    expect(transFallback).toEqual(['Original only']);

    const transNoFallback = resolveCueLines({ text: 'Original only', translation: null }, 'translated', false);
    expect(transNoFallback).toEqual([]);

    // Mode: original
    const origOnly = resolveCueLines({ text: 'Original only', translation: 'कुछ अनुवाद' }, 'original');
    expect(origOnly).toEqual(['Original only']);
  });
});

describe('Subtitle Export: SubRip (.srt) Serialization', () => {
  it('formats SRT timestamps correctly with millisecond rounding and carry-over', () => {
    expect(formatSrtTimestamp(0)).toBe('00:00:00,000');
    expect(formatSrtTimestamp(1.005)).toBe('00:00:01,005');
    expect(formatSrtTimestamp(12.4)).toBe('00:00:12,400');
    expect(formatSrtTimestamp(65.125)).toBe('00:01:05,125');

    // Millisecond carry into seconds
    expect(formatSrtTimestamp(59.9996)).toBe('00:01:00,000');

    // Second carry into minutes and hours
    expect(formatSrtTimestamp(3599.9996)).toBe('01:00:00,000');

    // Sessions longer than 1 hour
    expect(formatSrtTimestamp(3723.456)).toBe('01:02:03,456');

    // Very large timestamp (e.g. 24 hour stream)
    expect(formatSrtTimestamp(86400)).toBe('24:00:00,000');
  });

  it('serializes single cue and handles empty cue collection', () => {
    const single: Cue[] = [
      {
        id: '1',
        start: 1.2,
        end: 3.5,
        text: 'Hello world',
        lang: 'en',
        source: 'captions',
        revisions: [],
      },
    ];

    const srt = serializeSrt(single, { mode: 'original' });
    expect(srt).toBe('1\n00:00:01,200 --> 00:00:03,500\nHello world\n');

    const empty = serializeSrt([]);
    expect(empty).toBe('');
  });

  it('serializes Indian language Unicode in Hindi, Marathi, Tamil, and Telugu', () => {
    const indianCues: Cue[] = [
      {
        id: 'hi',
        start: 0.0,
        end: 2.5,
        text: 'आज हम पनीर टिक्का बनाएंगे',
        translation: 'Today we will make paneer tikka',
        lang: 'hi',
        translation_lang: 'en',
        source: 'stt',
        revisions: [],
      },
      {
        id: 'mr',
        start: 3.0,
        end: 5.5,
        text: 'आज आपण पनीर टिक्का बनवूया',
        translation: 'Today we will make paneer tikka',
        lang: 'mr',
        translation_lang: 'en',
        source: 'stt',
        revisions: [],
      },
      {
        id: 'ta',
        start: 6.0,
        end: 8.5,
        text: 'இன்று நாம் பனீர் டிக்கா செய்வோம்',
        translation: 'Today we will make paneer tikka',
        lang: 'ta',
        translation_lang: 'en',
        source: 'stt',
        revisions: [],
      },
      {
        id: 'te',
        start: 9.0,
        end: 11.5,
        text: 'ఈ రోజు మనం పనీర్ టిక్కా చేద్దాం',
        translation: 'Today we will make paneer tikka',
        lang: 'te',
        translation_lang: 'en',
        source: 'stt',
        revisions: [],
      },
    ];

    const srt = serializeSrt(indianCues, { mode: 'both' });

    expect(srt).toContain('1\n00:00:00,000 --> 00:00:02,500\nआज हम पनीर टिक्का बनाएंगे\nToday we will make paneer tikka');
    expect(srt).toContain('2\n00:00:03,000 --> 00:00:05,500\nआज आपण पनीर टिक्का बनवूया\nToday we will make paneer tikka');
    expect(srt).toContain('3\n00:00:06,000 --> 00:00:08,500\nஇன்று நாம் பனீர் டிக்கா செய்வோம்\nToday we will make paneer tikka');
    expect(srt).toContain('4\n00:00:09,000 --> 00:00:11,500\nఈ రోజు మనం పనీర్ టిక్కా చేద్దాం\nToday we will make paneer tikka');
  });

  it('formats multiline cues cleanly with exactly one blank line separation', () => {
    const cues: Cue[] = [
      {
        id: 'c1',
        start: 10.0,
        end: 14.0,
        text: 'First line of speech\nSecond line of speech',
        lang: 'en',
        source: 'captions',
        revisions: [],
      },
      {
        id: 'c2',
        start: 15.0,
        end: 18.0,
        text: 'Another cue block',
        lang: 'en',
        source: 'captions',
        revisions: [],
      },
    ];

    const srt = serializeSrt(cues, { mode: 'original' });
    const expected =
      '1\n00:00:10,000 --> 00:00:14,000\nFirst line of speech\nSecond line of speech\n\n' +
      '2\n00:00:15,000 --> 00:00:18,000\nAnother cue block\n';

    expect(srt).toBe(expected);
  });
});

describe('Subtitle Export: WebVTT (.vtt) Serialization', () => {
  it('formats WebVTT timestamps with period separator and correct carry-over', () => {
    expect(formatVttTimestamp(0)).toBe('00:00:00.000');
    expect(formatVttTimestamp(12.4)).toBe('00:00:12.400');
    expect(formatVttTimestamp(59.9996)).toBe('00:01:00.000');
    expect(formatVttTimestamp(3661.05)).toBe('01:01:01.050');
  });

  it('outputs standard WebVTT with header, blank line, and no accidental sequential cue numbers', () => {
    const cues: Cue[] = [
      {
        id: 'v1',
        start: 1.2,
        end: 3.5,
        text: 'Hello world',
        lang: 'en',
        source: 'captions',
        revisions: [],
      },
      {
        id: 'v2',
        start: 4.0,
        end: 6.0,
        text: 'Welcome to LiveSub',
        lang: 'en',
        source: 'captions',
        revisions: [],
      },
    ];

    const vtt = serializeWebVtt(cues, { mode: 'original' });

    // Header must have blank line after it
    expect(vtt.startsWith('WEBVTT\n\n')).toBe(true);

    // Timing line must NOT be preceded by SRT-style index number
    expect(vtt).toContain('00:00:01.200 --> 00:00:03.500\nHello world\n\n00:00:04.000 --> 00:00:06.000\nWelcome to LiveSub');
    expect(vtt).not.toMatch(/\n1\n00:00:01\.200/);
  });

  it('supports optional title and optional cue numbers when explicitly requested', () => {
    const cues: Cue[] = [
      {
        id: 'v1',
        start: 1.0,
        end: 2.0,
        text: 'Testing',
        lang: 'en',
        source: 'captions',
        revisions: [],
      },
    ];

    const vtt = serializeWebVtt(cues, {
      title: 'Recipe Video',
      includeCueNumbers: true,
    });

    expect(vtt.startsWith('WEBVTT - Recipe Video\n\n')).toBe(true);
    expect(vtt).toContain('1\n00:00:01.000 --> 00:00:02.000\nTesting');
  });

  it('escapes markup-like characters in WebVTT when escapeMarkup option is enabled', () => {
    expect(escapeVttMarkup('5 < 10 & 20 > 15')).toBe('5 &lt; 10 &amp; 20 &gt; 15');

    const cues: Cue[] = [
      {
        id: 'v1',
        start: 0.5,
        end: 2.0,
        text: 'Special math: x < y && a > b',
        lang: 'en',
        source: 'captions',
        revisions: [],
      },
    ];

    const vtt = serializeWebVtt(cues, { escapeMarkup: true });
    expect(vtt).toContain('Special math: x &lt; y &amp;&amp; a &gt; b');
  });

  it('handles empty collection for WebVTT', () => {
    const vtt = serializeWebVtt([]);
    expect(vtt).toBe('WEBVTT\n');
  });
});

describe('Subtitle Export: Filesystem-Safe Filename Sanitization', () => {
  it('sanitizes titles with illegal characters, symbols, and whitespace', () => {
    const raw = 'How To Make Paneer: The "Best" Recipe? / 100% Easy* <Hindi>';
    const sanitized = sanitizeFilenameComponent(raw);

    expect(sanitized).toBe('How-To-Make-Paneer-The-Best-Recipe-100-Easy-Hindi');
    expect(sanitized).not.toMatch(/[<>:"/\\|?*]/);
  });

  it('removes YouTube suffix from titles', () => {
    const title = 'Live Cooking Class - YouTube';
    expect(sanitizeFilenameComponent(title)).toBe('Live-Cooking-Class');
  });

  it('safely handles Windows reserved device names', () => {
    expect(sanitizeFilenameComponent('CON')).toBe('livesub_CON');
    expect(sanitizeFilenameComponent('aux')).toBe('livesub_aux');
    expect(sanitizeFilenameComponent('nul')).toBe('livesub_nul');
  });

  it('generates standardized descriptive filenames for original, translated, and bilingual exports', () => {
    const videoTitle = 'Paneer Tikka Recipe';
    const videoId = 'dQw4w9WgXcQ';

    expect(
      generateSubtitleFilename({
        title: videoTitle,
        videoId,
        format: 'srt',
        mode: 'original',
      }),
    ).toBe('livesub_Paneer-Tikka-Recipe_original.srt');

    expect(
      generateSubtitleFilename({
        title: videoTitle,
        videoId,
        format: 'vtt',
        mode: 'translated',
        targetLang: 'hi',
      }),
    ).toBe('livesub_Paneer-Tikka-Recipe_translated_hi.vtt');

    expect(
      generateSubtitleFilename({
        title: videoTitle,
        videoId,
        format: 'srt',
        mode: 'both',
      }),
    ).toBe('livesub_Paneer-Tikka-Recipe_bilingual.srt');

    expect(
      generateSubtitleFilename({
        title: videoTitle,
        videoId,
        format: 'json',
      }),
    ).toBe('livesub_Paneer-Tikka-Recipe_session.json');

    // Fallback to videoId when title is null or empty
    expect(
      generateSubtitleFilename({
        title: null,
        videoId,
        format: 'srt',
        mode: 'both',
      }),
    ).toBe('livesub_dQw4w9WgXcQ_bilingual.srt');
  });
});

describe('Subtitle Export: Session Integration & Store Independence', () => {
  it('exports session history from CueStore without mutating store state', () => {
    const store = new CueStore();

    store.upsertCue({
      id: 'cap-1',
      start: 5.0,
      end: 8.0,
      text: 'Original caption',
      translation: 'मूल कैप्शन',
      lang: 'en',
      translation_lang: 'hi',
      source: 'captions',
      revisions: [{ at: 5.0, text: 'Original caption' }],
    });

    store.upsertCue({
      id: 'stt-1',
      start: 10.0,
      end: 13.0,
      text: 'Speech text',
      translation: 'भाषण पाठ',
      lang: 'en',
      translation_lang: 'hi',
      source: 'stt',
      revisions: [
        { at: 9.8, text: 'Speech' },
        { at: 10.0, text: 'Speech text' },
      ],
    });

    const initialLength = store.length;
    const sessionExport = buildSessionExport({
      sessionId: 'session-xyz',
      videoId: 'vid-123',
      videoTitle: 'Test Video Session',
      cues: store.getCues(),
      currentTime: 11.5,
    });

    expect(store.length).toBe(initialLength);
    expect(sessionExport.total_cues).toBe(2);
    expect(sessionExport.video_title).toBe('Test Video Session');
    expect(sessionExport.cues[0]?.id).toBe('cap-1');
    expect(sessionExport.cues[1]?.id).toBe('stt-1');
    // Ensure final accepted text was used, not intermediate hypothesis
    expect(sessionExport.cues[1]?.text).toBe('Speech text');

    // Generate SRT and VTT from the session cues
    const srt = serializeSrt(sessionExport.cues, { mode: 'both' });
    expect(srt).toContain('1\n00:00:05,000 --> 00:00:08,000\nOriginal caption\nमूल कैप्शन');
    expect(srt).toContain('2\n00:00:10,000 --> 00:00:13,000\nSpeech text\nभाषण पाठ');

    const vtt = serializeWebVtt(sessionExport.cues, { mode: 'both', title: sessionExport.video_title });
    expect(vtt).toContain('00:00:05.000 --> 00:00:08.000\nOriginal caption\nमूल कैप्शन');
  });

  it('safely handles browser text file download with UTF-8 blob and revokes object URL', () => {
    const createObjectURLMock = vi.fn(() => 'blob:chrome-extension://12345');
    const revokeObjectURLMock = vi.fn();
    const clickMock = vi.fn();

    vi.stubGlobal('URL', {
      createObjectURL: createObjectURLMock,
      revokeObjectURL: revokeObjectURLMock,
    });

    vi.stubGlobal('document', {
      createElement: vi.fn(() => ({
        set href(val: string) {},
        set download(val: string) {},
        style: {},
        click: clickMock,
      })),
      body: {
        appendChild: vi.fn(),
        removeChild: vi.fn(),
      },
    });

    const srtSuccess = downloadSrtFile('test.srt', '1\n00:00:01,000 --> 00:00:02,000\nनमस्ते\n');
    expect(srtSuccess).toBe(true);
    expect(createObjectURLMock).toHaveBeenCalled();
    expect(clickMock).toHaveBeenCalled();

    const vttSuccess = downloadVttFile('test.vtt', 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nनमस्ते\n');
    expect(vttSuccess).toBe(true);

    vi.unstubAllGlobals();
  });
});
