import { browser } from 'wxt/browser';
import { DEFAULT_SETTINGS, mergeSettings, type LiveSubSettings } from './settings-core';

export * from './settings-core';

// storage.local (not sync): slider drags write many times per second and would exceed sync's 120 writes/min quota.
const STORAGE_KEY = 'livesub:settings';

export async function loadSettings(): Promise<LiveSubSettings> {
  const result = await browser.storage.local.get(STORAGE_KEY);
  return mergeSettings(result[STORAGE_KEY]);
}

/** Persist a complete settings snapshot (validated). Callers pass full state, so there is no read-modify-write race. */
export async function saveSettings(next: LiveSubSettings): Promise<LiveSubSettings> {
  const valid = mergeSettings(next);
  await browser.storage.local.set({ [STORAGE_KEY]: valid });
  return valid;
}

/** Write defaults only if nothing is stored yet (called on install). */
export async function ensureDefaults(): Promise<void> {
  const result = await browser.storage.local.get(STORAGE_KEY);
  if (result[STORAGE_KEY] === undefined) {
    await browser.storage.local.set({ [STORAGE_KEY]: { ...DEFAULT_SETTINGS } });
  }
}

/** Subscribe to settings changes from any context (popup → content scripts, live). */
export function subscribeSettings(listener: (settings: LiveSubSettings) => void): () => void {
  const handler = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area === 'local' && STORAGE_KEY in changes) {
      listener(mergeSettings(changes[STORAGE_KEY].newValue));
    }
  };
  browser.storage.onChanged.addListener(handler);
  return () => browser.storage.onChanged.removeListener(handler);
}
