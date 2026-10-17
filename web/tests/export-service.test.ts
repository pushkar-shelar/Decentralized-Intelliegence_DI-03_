import { describe, expect, it } from 'vitest';
import {
  exportToSrt,
  exportToVtt,
  exportToTxt,
  exportToJson,
  formatSpeaker,
  formatSrtTime,
  formatVttTime,
} from '../src/services/export-service';
import type { SubtitleCue } from '../src/types/cue';

describe('Subtitle Export Service (Website)', () => {
  const sampleCues: SubtitleCue[] = [
    {
      id: 'c1',
      start: 1.25,
      end: 4.5,
      text: 'नमस्ते दोस्तों, कैसे हैं आप?',
      translation: 'Hello friends, how are you?',
      speaker: 'SPEAKER_00',
      lang: 'hi',
      translation_lang: 'en',
      source: 'stt',
      is_final: true,
    },
    {
      id: 'c2',
      start: 5.0,
      end: 7.75,
      text: 'हम सब बिल्कुल ठीक हैं।',
      translation: 'We are all totally fine.',
      speaker: 'SPEAKER_01',
      lang: 'hi',
      translation_lang: 'en',
      source: 'stt',
      is_final: true,
    },
    {
      id: 'c3',
      start: 8.0,
      end: 10.0,
      text: 'No speaker specified here.',
      translation: null,
      speaker: null,
      lang: 'en',
      source: 'stt',
      is_final: true,
    },
  ];

  it('formats speaker tags cleanly (SPEAKER_00 -> Speaker 1)', () => {
    expect(formatSpeaker('SPEAKER_00')).toBe('Speaker 1');
    expect(formatSpeaker('SPEAKER_01')).toBe('Speaker 2');
    expect(formatSpeaker('SPEAKER_09')).toBe('Speaker 10');
    expect(formatSpeaker('Narrator_Main')).toBe('Narrator Main');
    expect(formatSpeaker(null)).toBeNull();
    expect(formatSpeaker(undefined)).toBeNull();
  });

  it('formats SRT and VTT timestamps with correct millisecond precision', () => {
    expect(formatSrtTime(0)).toBe('00:00:00,000');
    expect(formatSrtTime(65.432)).toBe('00:01:05,432');
    expect(formatVttTime(65.432)).toBe('00:01:05.432');
  });

  it('exports valid SubRip (.srt) with speaker brackets and bilingual lines', () => {
    const srt = exportToSrt(sampleCues, { includeOriginal: true, includeTranslation: true });

    expect(srt).toContain('1\n00:00:01,250 --> 00:00:04,500');
    expect(srt).toContain('[Speaker 1] नमस्ते दोस्तों, कैसे हैं आप?\nHello friends, how are you?');

    expect(srt).toContain('2\n00:00:05,000 --> 00:00:07,750');
    expect(srt).toContain('[Speaker 2] हम सब बिल्कुल ठीक हैं।\nWe are all totally fine.');

    expect(srt).toContain('3\n00:00:08,000 --> 00:00:10,000\nNo speaker specified here.');
    expect(srt).not.toContain('[Speaker null]');
  });

  it('exports valid WebVTT (.vtt) with voice tags and bilingual lines', () => {
    const vtt = exportToVtt(sampleCues, { includeOriginal: true, includeTranslation: true });

    expect(vtt.startsWith('WEBVTT')).toBe(true);
    expect(vtt).toContain('00:00:01.250 --> 00:00:04.500');
    expect(vtt).toContain('<v Speaker 1>नमस्ते दोस्तों, कैसे हैं आप?');
    expect(vtt).toContain('<v Speaker 1>Hello friends, how are you?');
    expect(vtt).toContain('<v Speaker 2>हम सब बिल्कुल ठीक हैं।');
  });

  it('exports clean readable transcript (.txt) with timestamps', () => {
    const txt = exportToTxt(sampleCues);

    expect(txt).toContain('[00:01 - 00:04] [Speaker 1] नमस्ते दोस्तों, कैसे हैं आप?');
    expect(txt).toContain('Hello friends, how are you?');
    expect(txt).toContain('[00:05 - 00:07] [Speaker 2] हम सब बिल्कुल ठीक हैं।');
  });

  it('exports enveloped JSON metadata', () => {
    const jsonStr = exportToJson(sampleCues, 'sample_talk.mp4');
    const parsed = JSON.parse(jsonStr);

    expect(parsed.generator).toBe('LiveSub Subtitle Studio');
    expect(parsed.video_name).toBe('sample_talk.mp4');
    expect(parsed.total_cues).toBe(3);
    expect(parsed.cues[0].speaker).toBe('SPEAKER_00');
    expect(parsed.cues[0].translation).toBe('Hello friends, how are you?');
  });
});
