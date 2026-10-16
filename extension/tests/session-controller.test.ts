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

  it('starts in demo mode when demoMode setting is enabled', async () => {
    const settings = createStore<LiveSubSettings>({
      ...DEFAULT_SETTINGS,
      demoMode: true,
    });

    const controller = new SessionController(settings);
    await controller.onVideoChange('vid-001');

    expect(controller.current).not.toBeNull();
    expect(controller.current?.videoId).toBe('vid-001');
    expect(controller.mode).toBe('demo');
    expect((globalThis as any).document.documentElement.dataset.livesubSource).toBe('demo');

    controller.dispose();
  });

  it('blocks audio capture while checking or active on caption path', async () => {
    const settings = createStore<LiveSubSettings>({
      ...DEFAULT_SETTINGS,
      demoMode: false,
    });

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
    const settings = createStore<LiveSubSettings>({
      ...DEFAULT_SETTINGS,
      demoMode: true,
    });

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
    const settings = createStore<LiveSubSettings>({
      ...DEFAULT_SETTINGS,
      demoMode: true,
    });

    const controller = new SessionController(settings);

    // Fast sequential navigation triggers
    const p1 = controller.onVideoChange('race-1');
    const p2 = controller.onVideoChange('race-2');

    await Promise.all([p1, p2]);

    // The second navigation must win the race
    expect(controller.current?.videoId).toBe('race-2');

    controller.dispose();
  });
});
