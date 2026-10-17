import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore } from '../src/shared/store';
import { DEFAULT_SETTINGS, type LiveSubSettings } from '../src/settings/settings-core';
import { SessionController } from '../src/session/session-controller';
import { MockTranslationService } from '../src/translation/translation-service';

// Mock dependencies that require full browser DOM
vi.mock('../src/youtube/player-detector', () => ({
  waitForPlayer: vi.fn().mockImplementation(async (signal?: AbortSignal) => {
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
    const mockEl = {
      classList: { contains: () => false },
      getBoundingClientRect: () => ({ height: 720 }),
      addEventListener: () => {},
      removeEventListener: () => {},
    };
    return {
      player: mockEl,
      video: {
        ...mockEl,
        paused: false,
        playbackRate: 1,
        currentTime: 0,
      },
    };
  }),
}));

vi.mock('../src/overlay/mount', () => ({
  mountOverlay: vi.fn().mockReturnValue(() => {}),
}));

describe('SessionController', () => {
  beforeEach(() => {
    class MockObserver {
      observe() {}
      disconnect() {}
    }
    (globalThis as any).MutationObserver = MockObserver;
    (globalThis as any).ResizeObserver = MockObserver;

    // Setup minimal document and window mocks for Node environment
    (globalThis as any).document = {
      documentElement: { dataset: {} },
      querySelector: () => null,
      addEventListener: () => {},
      removeEventListener: () => {},
    };
    (globalThis as any).window = {
      addEventListener: () => {},
      removeEventListener: () => {},
      postMessage: () => {},
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('initializes real session cleanly on video change', async () => {
    const settings = createStore<LiveSubSettings>({ ...DEFAULT_SETTINGS });

    const controller = new SessionController(settings);
    await controller.onVideoChange('vid-001');

    expect(controller.current).not.toBeNull();
    expect(controller.current?.videoId).toBe('vid-001');
    expect(controller.mode).toBe('checking');

    controller.dispose();
  });

  it('blocks audio capture while checking or active on caption path', async () => {
    const settings = createStore<LiveSubSettings>({ ...DEFAULT_SETTINGS });

    const mockTranslator = new MockTranslationService();
    const controller = new SessionController(settings, mockTranslator);

    // Initial state before video loads
    expect(controller.isAudioCaptureBlocked).toBe(false);

    // Start video session (starts in 'checking' mode)
    const changePromise = controller.onVideoChange('vid-002');
    await changePromise;

    expect(controller.current?.videoId).toBe('vid-002');
    // Mode is checking initially, so audio capture is strictly prohibited
    expect(controller.isAudioCaptureBlocked).toBe(true);

    controller.dispose();
  });

  it('resets session cleanly when video changes without leaking previous session', async () => {
    const settings = createStore<LiveSubSettings>({ ...DEFAULT_SETTINGS });

    const controller = new SessionController(settings);

    await controller.onVideoChange('vid-aaa');
    const firstSessionId = controller.current?.id;
    expect(firstSessionId).toBeDefined();

    // Navigate to new video
    await controller.onVideoChange('vid-bbb');
    const secondSessionId = controller.current?.id;

    expect(secondSessionId).toBeDefined();
    expect(secondSessionId).not.toBe(firstSessionId);
    expect(controller.current?.videoId).toBe('vid-bbb');

    // Navigate to null (e.g. YouTube home or search page)
    await controller.onVideoChange(null);
    expect(controller.current).toBeNull();
    expect((globalThis as any).document.documentElement.dataset.livesubSession).toBeUndefined();

    controller.dispose();
  });

  it('prevents older asynchronous navigation races from attaching to new video', async () => {
    const settings = createStore<LiveSubSettings>({ ...DEFAULT_SETTINGS });

    const controller = new SessionController(settings);

    // Fast sequential navigation triggers
    const p1 = controller.onVideoChange('race-1');
    const p2 = controller.onVideoChange('race-2');

    await Promise.all([p1, p2]);

    // The second navigation must win the race
    expect(controller.current?.videoId).toBe('race-2');

    controller.dispose();
  });

  it('suppresses STT cues received during ad playback and accepts them during normal playback', async () => {
    const settings = createStore<LiveSubSettings>({ ...DEFAULT_SETTINGS });

    const controller = new SessionController(settings);
    await controller.onVideoChange('ad-test-video');

    const session = controller.current;
    expect(session).not.toBeNull();

    // 1. Normal state: STT cues are ingested
    controller.onSttCue({
      id: 'stt-001',
      start: 5.0,
      end: 8.0,
      text: 'Main video dialogue',
      lang: 'en',
      source: 'stt',
      revisions: [{ at: 5.0, text: 'Main video dialogue' }],
      is_final: true,
      first_shown_at: 5.0,
    });

    expect(session?.cueStore.length).toBe(1);
    expect(session?.cueStore.getActiveCue(6.0)?.text).toBe('Main video dialogue');

    // 2. Simulate ad state on player
    (session?.tracker as any).state = {
      ...session?.tracker.snapshot,
      isAd: true,
    };

    // 3. Ad STT cue arrives
    controller.onSttCue({
      id: 'stt-ad-001',
      start: 0.0,
      end: 15.0,
      text: 'Buy this commercial product now!',
      lang: 'en',
      source: 'stt',
      revisions: [{ at: 0.0, text: 'Buy this commercial product now!' }],
      is_final: true,
      first_shown_at: 0.0,
    });

    // CueStore must NOT contain the ad cue!
    expect(session?.cueStore.length).toBe(1);
    expect(session?.cueStore.getActiveCue(10.0)?.text).not.toBe('Buy this commercial product now!');

    // 4. Simulate ad completion: isAd becomes false
    (session?.tracker as any).state = {
      ...session?.tracker.snapshot,
      isAd: false,
    };

    controller.onSttCue({
      id: 'stt-002',
      start: 8.5,
      end: 12.0,
      text: 'Resumed main video content',
      lang: 'en',
      source: 'stt',
      revisions: [{ at: 8.5, text: 'Resumed main video content' }],
      is_final: true,
      first_shown_at: 8.5,
    });

    expect(session?.cueStore.length).toBe(2);
    expect(session?.cueStore.getActiveCue(9.0)?.text).toBe('Resumed main video content');

    controller.dispose();
  });
});
