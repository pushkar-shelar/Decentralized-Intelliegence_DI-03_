import { describe, expect, it } from 'vitest';
import type { Cue } from '../src/shared/cue';
import { CueStore } from '../src/timeline/cue-store';
import {
  buildSessionExport,
  formatCueForExport,
  type ExportedCueEntry,
  type LiveSubSessionExport,
} from '../src/export/session-export';

describe('Session Cue Log Export for Judges', () => {
  it('formats a cue strictly according to the judge requirements', () => {
    const cue: Cue = {
      id: 'cue-001',
      start: 12.4,
      end: 14.1,
      lang: 'hi',
      text: 'आज हम पनीर टिक्का बनाएंगे',
      translation: 'Today we will make paneer tikka',
      translation_lang: 'en',
      source: 'stt',
      first_shown_at: 16.3,
      revisions: [
        { at: 15.1, text: 'आज हम' },
        { at: 15.8, text: 'आज हम पनीर' },
        { at: 16.3, text: 'आज हम पनीर टिक्का बनाएंगे' },
      ],
    };

    const formatted: ExportedCueEntry = formatCueForExport(cue);

    expect(formatted.id).toBe('cue-001');
    expect(formatted.start).toBe(12.4);
    expect(formatted.end).toBe(14.1);
    expect(formatted.lang).toBe('hi');
    expect(formatted.text).toBe('आज हम पनीर टिक्का बनाएंगे');
    expect(formatted.translation).toBe('Today we will make paneer tikka');
    expect(formatted.translation_lang).toBe('en');
    expect(formatted.source).toBe('stt');
    expect(formatted.first_shown_at).toBe(16.3);
    expect(formatted.revisions).toEqual([
      { at: 15.1, text: 'आज हम' },
      { at: 15.8, text: 'आज हम पनीर' },
      { at: 16.3, text: 'आज हम पनीर टिक्का बनाएंगे' },
    ]);
  });

  it('guarantees revisions list has at least initial text if not explicitly specified', () => {
    const cue: Cue = {
      id: 'cap-1',
      start: 5.25,
      end: 8.5,
      lang: 'en',
      text: 'Native caption text',
      source: 'captions',
      revisions: [],
    };

    const formatted = formatCueForExport(cue);
    expect(formatted.revisions).toEqual([{ at: 5.25, text: 'Native caption text' }]);
    expect(formatted.translation).toBeNull();
    expect(formatted.first_shown_at).toBeNull();
  });

  it('builds a complete enveloped session export object with metadata and sorted cues', () => {
    const cues: Cue[] = [
      {
        id: 'c2',
        start: 10.0,
        end: 13.0,
        lang: 'en',
        text: 'Second subtitle',
        source: 'captions',
        revisions: [{ at: 10.0, text: 'Second subtitle' }],
      },
      {
        id: 'c1',
        start: 2.0,
        end: 5.0,
        lang: 'en',
        text: 'First subtitle',
        source: 'captions',
        first_shown_at: 2.05,
        revisions: [{ at: 2.0, text: 'First subtitle' }],
      },
    ];

    const exportData: LiveSubSessionExport = buildSessionExport({
      sessionId: 'sess-abc-123',
      videoId: 'dQw4w9WgXcQ',
      cues,
      currentTime: 12.5,
      version: '0.1.0',
    });

    expect(exportData.session_id).toBe('sess-abc-123');
    expect(exportData.video_id).toBe('dQw4w9WgXcQ');
    expect(exportData.video_url).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(exportData.total_cues).toBe(2);
    expect(exportData.playback_time).toBe(12.5);
    expect(exportData.generator).toContain('LiveSub Extension');

    // Cues must be chronologically sorted
    expect(exportData.cues[0]?.id).toBe('c1');
    expect(exportData.cues[0]?.start).toBe(2.0);
    expect(exportData.cues[0]?.first_shown_at).toBe(2.05);

    expect(exportData.cues[1]?.id).toBe('c2');
    expect(exportData.cues[1]?.start).toBe(10.0);
  });

  it('records first_shown_at and tracks revisions in CueStore', () => {
    const store = new CueStore();

    // 1. Initial partial hypothesis
    store.upsertCue({
      id: 'live-1',
      start: 20.0,
      end: 22.0,
      lang: 'hi',
      text: 'नमस्ते',
      source: 'stt',
      is_final: false,
      revisions: [{ at: 20.1, text: 'नमस्ते' }],
    });

    expect(store.getActiveCue(20.5)?.first_shown_at).toBeNull();
    expect(store.getActiveCue(20.5)?.revisions.length).toBe(1);

    // 2. Updated text revision
    store.upsertCue({
      id: 'live-1',
      start: 20.0,
      end: 23.5,
      lang: 'hi',
      text: 'नमस्ते दोस्तों',
      source: 'stt',
      is_final: true,
      revisions: [{ at: 21.0, text: 'नमस्ते दोस्तों' }],
    });

    const updated = store.getActiveCue(20.5);
    expect(updated?.text).toBe('नमस्ते दोस्तों');
    expect(updated?.revisions).toHaveLength(2);
    expect(updated?.revisions[0]?.text).toBe('नमस्ते');
    expect(updated?.revisions[1]?.text).toBe('नमस्ते दोस्तों');

    // 3. Record first display on screen
    store.recordFirstShown('live-1', 21.2);
    expect(store.getActiveCue(20.5)?.first_shown_at).toBe(21.2);

    // 4. Repeated render does not overwrite original first_shown_at
    store.recordFirstShown('live-1', 22.0);
    expect(store.getActiveCue(20.5)?.first_shown_at).toBe(21.2);
  });

  it('supports cue store export with first_shown_at and translations', () => {
    const store = new CueStore();
    store.upsertCue({
      id: 'cue-0',
      start: 0.0,
      end: 3.5,
      lang: 'hi',
      text: 'हेलो दोस्तों',
      translation: 'Hello friends',
      translation_lang: 'en',
      source: 'stt',
      first_shown_at: 0.2,
      revisions: [{ at: 0.2, text: 'हेलो दोस्तों' }],
    });

    const cues = store.getCues();
    expect(cues.length).toBeGreaterThan(0);
    expect(cues[0]?.id).toBe('cue-0');
    expect(cues[0]?.first_shown_at).toBe(0.2);
    expect(cues[0]?.translation).toBe('Hello friends');
    expect(cues[0]?.revisions).toHaveLength(1);
  });

  describe('SRT & WebVTT conversion', () => {
    const testCues: Cue[] = [
      {
        id: 'cue-1',
        start: 12.4,
        end: 14.15,
        lang: 'hi',
        text: 'आज हम पनीर टिक्का बनाएंगे',
        translation: 'Today we will make paneer tikka',
        source: 'captions',
        revisions: [{ at: 12.4, text: 'आज हम पनीर टिक्का बनाएंगे' }],
      },
      {
        id: 'cue-2',
        start: 65.0,
        end: 68.25,
        lang: 'en',
        text: 'Next, cut into cubes.',
        translation: 'इसके बाद, टुकड़ों में काट लें।',
        source: 'stt',
        revisions: [{ at: 65.0, text: 'Next, cut into cubes.' }],
      },
    ];

    it('formats timestamps accurately for SRT (comma) and VTT (period)', async () => {
      const { formatTimestamp } = await import('../src/export/session-export');
      expect(formatTimestamp(0, ',')).toBe('00:00:00,000');
      expect(formatTimestamp(12.4, ',')).toBe('00:00:12,400');
      expect(formatTimestamp(65.125, ',')).toBe('00:01:05,125');
      expect(formatTimestamp(3661.05, '.')).toBe('01:01:01.050');
    });

    it('converts cues to valid SubRip (.srt) in dual mode', async () => {
      const { cuesToSrt } = await import('../src/export/session-export');
      const srt = cuesToSrt(testCues, 'dual');

      expect(srt).toContain('1\n00:00:12,400 --> 00:00:14,150\nआज हम पनीर टिक्का बनाएंगे\nToday we will make paneer tikka');
      expect(srt).toContain('2\n00:01:05,000 --> 00:01:08,250\nNext, cut into cubes.\nइसके बाद, टुकड़ों में काट लें।');
    });

    it('converts cues to valid SubRip (.srt) in original and translated modes', async () => {
      const { cuesToSrt } = await import('../src/export/session-export');
      const srtOrig = cuesToSrt(testCues, 'original');
      expect(srtOrig).toContain('आज हम पनीर टिक्का बनाएंगे');
      expect(srtOrig).not.toContain('Today we will make paneer tikka');

      const srtTrans = cuesToSrt(testCues, 'translated');
      expect(srtTrans).toContain('Today we will make paneer tikka');
      expect(srtTrans).not.toContain('आज हम पनीर टिक्का बनाएंगे');
    });

    it('converts cues to valid WebVTT (.vtt) with header and period timestamps', async () => {
      const { cuesToVtt } = await import('../src/export/session-export');
      const vtt = cuesToVtt(testCues, 'dual', 'Recipe Video');

      expect(vtt).toMatch(/^WEBVTT - Recipe Video\n/);
      expect(vtt).toContain('1\n00:00:12.400 --> 00:00:14.150\nआज हम पनीर टिक्का बनाएंगे\nToday we will make paneer tikka');
      expect(vtt).toContain('2\n00:01:05.000 --> 00:01:08.250\nNext, cut into cubes.\nइसके बाद, टुकड़ों में काट लें।');
    });
  });
});
