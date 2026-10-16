import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { ensureDefaults } from '../src/settings/settings';

/**
 * Phase 1: minimal service worker. Later phases add message routing, the offscreen
 * document for tab audio capture (Phase 3), and the backend WebSocket bridge.
 */
export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(() => {
    void ensureDefaults();
  });
});
