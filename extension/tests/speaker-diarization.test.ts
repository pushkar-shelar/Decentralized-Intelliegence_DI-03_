import { describe, expect, it } from 'vitest';
import type { Cue } from '../src/shared/cue';
import { CueStore } from '../src/timeline/cue-store';
import {
  formatCueForExport,
  buildSessionExport,
  cuesToSrt,
  cuesToVtt,
  formatSpeakerTag,
  type ExportedCueEntry,
} from '../src/export/session-export';
import { formatSpeakerDisplay } from '../src/overlay/SubtitleOverlay';

describe('Speaker Diarization End-to-End Frontend Pipeline', () => {
  it('1. Speaker metadata survives cue insertion and update in CueStore', () => {
    const store = new CueStore();

    const initialCue: Cue = {
      id: 'cue-spk-1',
      start: 5.0,
      end: 8.0,
      lang: 'hi',
      text: 'पहला वक्ता बोल रहा है',
      speaker: 'SPEAKER_00',
      source: 'stt',
      revisions: [{ at: 5.0, text: 'पहला वक्ता बोल रहा है' }],
    };

    store.upsertCue(initialCue);
    const active = store.getActiveCue(6.0);
    expect(active).not.toBeNull();
    expect(active?.speaker).toBe('SPEAKER_00');

    // Update with text revision while preserving speaker
    store.upsertCue({
      id: 'cue-spk-1',
      start: 5.0,
      end: 9.0,
      lang: 'hi',
      text: 'पहला वक्ता पूरा बोल चुका है',
      source: 'stt',
      revisions: [{ at: 6.5, text: 'पहला वक्ता पूरा बोल चुका है' }],
    });

    const updated = store.getActiveCue(6.0);
    expect(updated?.text).toBe('पहला वक्ता पूरा बोल चुका है');
    expect(updated?.speaker).toBe('SPEAKER_00');
  });

  it('2. A late speaker assignment updates an existing cue without replacing text', () => {
    const store = new CueStore();

    // Cue arrives first from fast transcription without speaker
    store.upsertCue({
      id: 'live-cue-42',
      start: 10.0,
      end: 14.0,
      lang: 'en',
      text: 'Hello from the second speaker',
      translation: 'नमस्ते दूसरे वक्ता से',
      source: 'stt',
      is_final: false,
      revisions: [{ at: 10.0, text: 'Hello from the second speaker' }],
    });

    expect(store.getActiveCue(11.0)?.speaker).toBeUndefined();

    // Diarization finishes and delivers speaker label
    store.upsertCue({
      id: 'live-cue-42',
      start: 10.0,
      end: 14.0,
      lang: 'en',
      text: 'Hello from the second speaker',
      speaker: 'SPEAKER_01',
      source: 'stt',
      is_final: true,
      revisions: [],
    });

    const enriched = store.getActiveCue(11.0);
    expect(enriched?.speaker).toBe('SPEAKER_01');
    expect(enriched?.text).toBe('Hello from the second speaker');
    expect(enriched?.translation).toBe('नमस्ते दूसरे वक्ता से');
  });

  it('3. Formats speaker labels into human-readable labels (Speaker 1, Speaker 2)', () => {
    expect(formatSpeakerDisplay('SPEAKER_00')).toBe('Speaker 1');
    expect(formatSpeakerDisplay('SPEAKER_01')).toBe('Speaker 2');
    expect(formatSpeakerDisplay('SPEAKER_09')).toBe('Speaker 10');
    expect(formatSpeakerDisplay('Host_A')).toBe('Host A');

    expect(formatSpeakerTag('SPEAKER_00')).toBe('Speaker 1');
    expect(formatSpeakerTag('SPEAKER_01')).toBe('Speaker 2');
    expect(formatSpeakerTag(null)).toBeNull();
    expect(formatSpeakerTag(undefined)).toBeNull();
  });

  it('4. Missing speaker IDs do not display fake or invented labels', () => {
    expect(formatSpeakerTag(null)).toBeNull();
    expect(formatSpeakerTag('')).toBeNull();
    expect(formatSpeakerTag('   ')).toBeNull();
  });

  it('5. Session JSON export preserves speaker in ExportedCueEntry', () => {
    const cue: Cue = {
      id: 'export-spk-1',
      start: 1.5,
      end: 4.2,
      lang: 'hi',
      text: 'हाँ, बिल्कुल सही कहा आपने',
      translation: 'Yes, you said it absolutely right',
      translation_lang: 'en',
      speaker: 'SPEAKER_01',
      source: 'stt',
      revisions: [{ at: 1.5, text: 'हाँ, बिल्कुल सही कहा आपने' }],
    };

    const exported: ExportedCueEntry = formatCueForExport(cue);
    expect(exported.speaker).toBe('SPEAKER_01');

    const envelope = buildSessionExport({
      sessionId: 'sess-diarize-test',
      videoId: 'testVid123',
      cues: [cue],
    });

    expect(envelope.cues[0]?.speaker).toBe('SPEAKER_01');
  });

  it('6. SRT export prefixes speaker tags into subtitle blocks when present', () => {
    const cues: Cue[] = [
      {
        id: 'c1',
        start: 0.0,
        end: 2.0,
        lang: 'hi',
        text: 'अरे ओ, बंसी!',
        translation: 'Hey, Bansi!',
        speaker: 'SPEAKER_00',
        source: 'stt',
        revisions: [{ at: 0.0, text: 'अरे ओ, बंसी!' }],
      },
      {
        id: 'c2',
        start: 2.5,
        end: 4.5,
        lang: 'hi',
        text: 'हाँ, तो मैं क्या करूँ?',
        translation: 'Yes, so what should I do?',
        speaker: 'SPEAKER_01',
        source: 'stt',
        revisions: [{ at: 2.5, text: 'हाँ, तो मैं क्या करूँ?' }],
      },
      {
        id: 'c3',
        start: 5.0,
        end: 7.0,
        lang: 'hi',
        text: 'कोई वक्ता निर्दिष्ट नहीं है',
        source: 'captions',
        revisions: [{ at: 5.0, text: 'कोई वक्ता निर्दिष्ट नहीं है' }],
      },
    ];

    const srt = cuesToSrt(cues, 'dual');

    // First speaker is Speaker 1
    expect(srt).toContain('[Speaker 1] अरे ओ, बंसी!\nHey, Bansi!');
    // Second speaker is Speaker 2
    expect(srt).toContain('[Speaker 2] हाँ, तो मैं क्या करूँ?\nYes, so what should I do?');
    // Third cue without speaker has no speaker bracket
    expect(srt).toContain('00:00:05,000 --> 00:00:07,000\nकोई वक्ता निर्दिष्ट नहीं है');
    expect(srt).not.toContain('[Speaker null]');
  });

  it('7. WebVTT export attaches voice tags (<v Speaker N>) when speaker is present', () => {
    const cues: Cue[] = [
      {
        id: 'c1',
        start: 1.0,
        end: 3.0,
        lang: 'en',
        text: 'Good morning everyone.',
        speaker: 'SPEAKER_00',
        source: 'stt',
        revisions: [{ at: 1.0, text: 'Good morning everyone.' }],
      },
    ];

    const vtt = cuesToVtt(cues, 'original');
    expect(vtt).toContain('<v Speaker 1>Good morning everyone.');
  });
});
