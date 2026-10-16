import { describe, expect, it } from 'vitest';
import { findBestTrack, parseCaptionTracks } from '../src/captions/track-detector';

describe('track-detector', () => {
  it('parses raw playerCaptionsTracklistRenderer into structured tracks', () => {
    const raw = {
      captionTracks: [
        {
          baseUrl: 'https://www.youtube.com/api/timedtext?v=123&lang=en',
          name: { simpleText: 'English' },
          vssId: '.en',
          languageCode: 'en',
        },
        {
          baseUrl: 'https://www.youtube.com/api/timedtext?v=123&lang=hi',
          name: { runs: [{ text: 'Hindi' }, { text: ' (auto)' }] },
          vssId: 'a.hi',
          languageCode: 'hi',
          kind: 'asr',
        },
      ],
    };

    const tracks = parseCaptionTracks(raw);
    expect(tracks.length).toBe(2);

    expect(tracks[0]?.languageCode).toBe('en');
    expect(tracks[0]?.name).toBe('English');
    expect(tracks[0]?.isAsr).toBe(false);

    expect(tracks[1]?.languageCode).toBe('hi');
    expect(tracks[1]?.name).toBe('Hindi (auto)');
    expect(tracks[1]?.isAsr).toBe(true);
  });

  it('selects the best track according to preferred language and ASR preference', () => {
    const tracks = [
      { languageCode: 'en', name: 'English (auto)', isAsr: true },
      { languageCode: 'en', name: 'English', isAsr: false },
      { languageCode: 'hi', name: 'Hindi', isAsr: false },
    ];

    // Prefers non-ASR exact match
    expect(findBestTrack(tracks, 'en')?.isAsr).toBe(false);

    // Exact match for Hindi
    expect(findBestTrack(tracks, 'hi')?.languageCode).toBe('hi');

    // Falls back to English if preferred lang 'mr' not available
    expect(findBestTrack(tracks, 'mr')?.languageCode).toBe('en');
  });
});
