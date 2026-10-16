import type { Cue } from '../shared/cue';

export interface YouTubeJson3Segment {
  utf8?: string;
  tOffsetMs?: number;
}

export interface YouTubeJson3Event {
  tStartMs?: number;
  dDurationMs?: number;
  wWinId?: number;
  segs?: YouTubeJson3Segment[];
  aAppend?: number;
}

export interface YouTubeJson3Payload {
  wireMagic?: string;
  events?: YouTubeJson3Event[];
}

/** Decode common HTML entities in subtitle text. */
export function decodeHtmlEntities(raw: string): string {
  if (!raw || !raw.includes('&')) return raw;
  return raw
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, code) => {
      const n = parseInt(code, 10);
      return Number.isFinite(n) ? String.fromCharCode(n) : _;
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
      const n = parseInt(hex, 16);
      return Number.isFinite(n) ? String.fromCharCode(n) : _;
    });
}

/** Clean up whitespace and line breaks from segment text. */
export function cleanText(raw: string): string {
  return decodeHtmlEntities(raw)
    .replace(/\r?\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parse a YouTube timedtext JSON3 payload into normalized LiveSub Cues.
 * Drops empty/structural events, joins segments, and converts ms to seconds.
 */
export function parseYouTubeJson3(data: unknown, lang = 'en'): Cue[] {
  if (!data || typeof data !== 'object') return [];
  const payload = data as YouTubeJson3Payload;
  if (!Array.isArray(payload.events)) return [];

  const cues: Cue[] = [];
  let index = 0;

  for (const ev of payload.events) {
    if (typeof ev.tStartMs !== 'number') continue;

    // Extract text from segments
    const rawSegments = ev.segs?.map((s) => s.utf8 ?? '').join('') ?? '';
    const text = cleanText(rawSegments);

    // Skip empty cues (e.g. window commands or newline markers)
    if (!text) continue;

    const start = ev.tStartMs / 1000;
    const duration = typeof ev.dDurationMs === 'number' && ev.dDurationMs > 0 ? ev.dDurationMs / 1000 : 2.5; // default 2.5s fallback
    const end = Number((start + duration).toFixed(3));

    const id = `yt-cap-${index++}-${start.toFixed(1)}`;

    cues.push({
      id,
      start: Number(start.toFixed(3)),
      end,
      lang,
      text,
      source: 'captions',
      is_final: true,
      revisions: [{ at: Number(start.toFixed(3)), text }],
    });
  }

  return cues;
}

/**
 * Parse YouTube XML format (<transcript><text start="1.2" dur="3.4">Hello &amp; welcome</text></transcript>).
 * Works reliably in both browser (DOMParser) and headless/Node environments (regex fallback).
 */
export function parseYouTubeXml(xml: string, lang = 'en'): Cue[] {
  if (!xml || typeof xml !== 'string' || !xml.includes('<text')) return [];

  const cues: Cue[] = [];
  const textTagRegex = /<text\b([^>]*?)>([\s\S]*?)<\/text>/gi;
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = textTagRegex.exec(xml)) !== null) {
    const rawAttrs = match[1] ?? '';
    const rawBody = match[2] ?? '';

    const startMatch = rawAttrs.match(/\bstart="([\d.]+)"/i);
    const durMatch = rawAttrs.match(/\bdur="([\d.]+)"/i);

    if (!startMatch || !startMatch[1]) continue;

    const startSec = parseFloat(startMatch[1]);
    if (!Number.isFinite(startSec)) continue;

    const durSec = durMatch && durMatch[1] ? parseFloat(durMatch[1]) : 2.5;
    const duration = Number.isFinite(durSec) && durSec > 0 ? durSec : 2.5;
    const endSec = Number((startSec + duration).toFixed(3));

    const text = cleanText(rawBody);
    if (!text) continue;

    const id = `yt-xml-${index++}-${startSec.toFixed(1)}`;

    cues.push({
      id,
      start: Number(startSec.toFixed(3)),
      end: endSec,
      lang,
      text,
      source: 'captions',
      is_final: true,
      revisions: [{ at: Number(startSec.toFixed(3)), text }],
    });
  }

  return cues;
}

/**
 * Universal caption parser: automatically detects whether the input is JSON3 or XML string.
 */
export function parseCaptionData(data: unknown, lang = 'en'): Cue[] {
  if (!data) return [];
  if (typeof data === 'object') {
    return parseYouTubeJson3(data, lang);
  }
  if (typeof data === 'string') {
    const trimmed = data.trim();
    if (trimmed.startsWith('{')) {
      try {
        const json = JSON.parse(trimmed);
        return parseYouTubeJson3(json, lang);
      } catch {
        // Fall back to XML
      }
    }
    return parseYouTubeXml(trimmed, lang);
  }
  return [];
}
