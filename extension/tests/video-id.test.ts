import { describe, expect, it } from 'vitest';
import { parseVideoId } from '../src/youtube/video-id';

describe('parseVideoId', () => {
  it('parses standard /watch?v= URLs', () => {
    expect(parseVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(parseVideoId('https://youtube.com/watch?v=dQw4w9WgXcQ&t=42s')).toBe('dQw4w9WgXcQ');
    expect(parseVideoId('https://m.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('parses youtu.be short URLs', () => {
    expect(parseVideoId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(parseVideoId('https://youtu.be/dQw4w9WgXcQ?t=10')).toBe('dQw4w9WgXcQ');
  });

  it('parses /live/ streams', () => {
    expect(parseVideoId('https://www.youtube.com/live/jfKfPfyJRdk')).toBe('jfKfPfyJRdk');
  });

  it('returns null for non-watch URLs', () => {
    expect(parseVideoId('https://www.youtube.com/')).toBeNull();
    expect(parseVideoId('https://www.youtube.com/feed/subscriptions')).toBeNull();
    expect(parseVideoId('https://www.youtube.com/results?search_query=test')).toBeNull();
    expect(parseVideoId('https://www.google.com/watch?v=dQw4w9WgXcQ')).toBeNull();
    expect(parseVideoId('not-a-url')).toBeNull();
  });
});
