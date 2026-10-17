import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import overlayCss from './overlay.css?inline';

const HOST_ID = 'livesub-overlay-host';

/**
 * Mount a React tree in an isolated Shadow DOM inside #movie_player.
 * Being a descendant of the player means it automatically follows theatre and fullscreen modes.
 * Returns an unmount function that fully removes the host element.
 */
export function mountOverlay(player: HTMLElement, node: ReactNode): () => void {
  // Defensive: never leave two overlays in the same player (e.g. after an extension reload).
  player.querySelectorAll(`#${HOST_ID}`).forEach((el) => el.remove());

  const host = document.createElement('div');
  host.id = HOST_ID;
  Object.assign(host.style, {
    position: 'absolute',
    inset: '0',
    pointerEvents: 'none',
    // Above the video and YouTube's own caption window (~z 40), below the control bar/menus (~z 60+).
    zIndex: '45',
  } satisfies Partial<CSSStyleDeclaration>);

  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = overlayCss;
  const container = document.createElement('div');
  container.className = 'ls-container';
  shadow.append(style, container);
  player.append(host);

  const root = createRoot(container);
  root.render(node);

  // Self-healing: if YouTube DOM swap detaches the host element, re-attach it automatically
  const reattachTimer = window.setInterval(() => {
    if (!host.isConnected && player.isConnected) {
      player.append(host);
    }
  }, 500);

  return () => {
    window.clearInterval(reattachTimer);
    root.unmount();
    host.remove();
  };
}
