import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchCaptionCues } from '../src/captions/caption-client';
import type { CaptionTrack } from '../src/captions/track-detector';

describe('caption-client', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('fetches and parses JSON3 caption cues successfully', async () => {
    const track: CaptionTrack = {
      languageCode: 'en',
      name: 'English',
      isAsr: false,
      baseUrl: 'https://www.youtube.com/api/timedtext?v=test&lang=en',
    };

    const mockPayload = {
      events: [
        {
          tStartMs: 1000,
          dDurationMs: 2000,
          segs: [{ utf8: 'Hello world' }],
        },
      ],
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify(mockPayload),
    } as any);

    const cues = await fetchCaptionCues(track);
    expect(cues.length).toBe(1);
    expect(cues[0]?.text).toBe('Hello world');
    expect(cues[0]?.start).toBe(1.0);
    expect(cues[0]?.end).toBe(3.0);
  });

  it('fetches and parses XML caption tracks when server returns XML', async () => {
    const track: CaptionTrack = {
      languageCode: 'hi',
      name: 'Hindi',
      isAsr: false,
      baseUrl: 'https://www.youtube.com/api/timedtext?v=test&lang=hi',
    };

    const mockXml = '<transcript><text start="2.5" dur="3.0">नमस्ते दुनिया</text></transcript>';

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => mockXml,
    } as any);

    const cues = await fetchCaptionCues(track);
    expect(cues.length).toBe(1);
    expect(cues[0]?.text).toBe('नमस्ते दुनिया');
    expect(cues[0]?.start).toBe(2.5);
    expect(cues[0]?.end).toBe(5.5);
  });

  it('handles HTTP error or empty response gracefully without throwing', async () => {
    const track: CaptionTrack = {
      languageCode: 'en',
      name: 'English',
      isAsr: false,
      baseUrl: 'https://www.youtube.com/api/timedtext?v=test&lang=en',
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    } as any);

    const cues = await fetchCaptionCues(track);
    expect(cues).toEqual([]);
  });

  it('respects AbortSignal when cancelled', async () => {
    const track: CaptionTrack = {
      languageCode: 'en',
      name: 'English',
      isAsr: false,
      baseUrl: 'https://www.youtube.com/api/timedtext?v=test&lang=en',
    };

    const controller = new AbortController();
    controller.abort();

    await expect(fetchCaptionCues(track, { signal: controller.signal })).rejects.toThrow();
  });
});
