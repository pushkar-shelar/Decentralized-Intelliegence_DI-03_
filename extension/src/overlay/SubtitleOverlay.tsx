import { useEffect, useState, useSyncExternalStore, type CSSProperties } from 'react';
import type { Cue } from '../shared/cue';
import type { CueProvider } from '../shared/cue-provider';
import type { Store } from '../shared/store';
import type { LiveSubSettings } from '../settings/settings-core';
import type { PlayerStateTracker } from '../youtube/player-state';

export interface SubtitleOverlayProps {
  video: HTMLVideoElement;
  tracker: PlayerStateTracker;
  provider: CueProvider;
  settings: Store<LiveSubSettings>;
}

/** Reference player height the base font size is designed for. */
const REFERENCE_HEIGHT = 720;

function cueKey(cue: Cue | null): string | null {
  return cue ? `${cue.id}\u0000${cue.text}\u0000${cue.translation ?? ''}` : null;
}

/**
 * Hook: the cue active at the video's CURRENT time. Video time is the single source of truth —
 * a rAF loop samples video.currentTime and only triggers a React render when the cue changes.
 */
function useActiveCue(video: HTMLVideoElement, provider: CueProvider): Cue | null {
  const [cue, setCue] = useState<Cue | null>(() => provider.getActiveCue(video.currentTime));

  useEffect(() => {
    let raf = 0;
    let lastKey: string | null = cueKey(cue);

    const evaluate = () => {
      const currentTime = video.currentTime;
      const next = provider.getActiveCue(currentTime);
      const key = cueKey(next);
      if (key !== lastKey) {
        lastKey = key;
        setCue(next);
        if (next && next.first_shown_at == null && (next.is_final ?? true)) {
          provider.recordFirstShown?.(next.id, currentTime);
        }
      }
    };

    const tick = () => {
      evaluate();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    // While paused rAF still runs, but also re-evaluate immediately on discrete events for snappy seeks.
    const onDiscrete = () => evaluate();
    video.addEventListener('seeked', onDiscrete);
    video.addEventListener('timeupdate', onDiscrete);
    const unsubProvider = provider.subscribe?.(evaluate);

    return () => {
      cancelAnimationFrame(raf);
      video.removeEventListener('seeked', onDiscrete);
      video.removeEventListener('timeupdate', onDiscrete);
      unsubProvider?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cue is only the initial seed
  }, [video, provider]);

  return cue;
}

export function SubtitleOverlay({ video, tracker, provider, settings: settingsStore }: SubtitleOverlayProps) {
  const settings = useSyncExternalStore(settingsStore.subscribe, settingsStore.get);
  const ui = useSyncExternalStore(
    (cb) => tracker.subscribe(() => cb()),
    () => tracker.snapshot,
  );
  const cue = useActiveCue(video, provider);

  if (!settings.enabled || ui.isAd || !cue) return null;

  const original = cue.text;
  const translation = cue.translation ?? null;
  const lines: Array<{ kind: 'original' | 'translation'; text: string }> = [];
  if (settings.displayMode === 'original') {
    lines.push({ kind: 'original', text: original });
  } else if (settings.displayMode === 'translated') {
    lines.push(translation ? { kind: 'translation', text: translation } : { kind: 'original', text: original });
  } else {
    lines.push({ kind: 'original', text: original });
    if (translation) lines.push({ kind: 'translation', text: translation });
  }

  const scale = Math.min(2.2, Math.max(0.6, ui.playerHeight / REFERENCE_HEIGHT));
  const controlsLift = ui.controlsVisible ? (ui.viewMode === 'fullscreen' ? 84 : 56) : 0;

  const style = {
    '--ls-font-size': `${(settings.fontSize * scale).toFixed(1)}px`,
    '--ls-bg-alpha': settings.bgOpacity,
    bottom: `calc(${settings.position}% + ${controlsLift}px)`,
  } as CSSProperties;

  return (
    <div className="ls-stage" style={style} data-view-mode={ui.viewMode}>
      <div className="ls-cue" key={cue.id} lang={cue.lang} data-source={cue.source}>
        {lines.map((line) => (
          <span
            key={line.kind}
            className={`ls-line ls-${line.kind}`}
            lang={line.kind === 'translation' ? cue.translation_lang ?? undefined : cue.lang}
          >
            {line.text}
          </span>
        ))}
      </div>
    </div>
  );
}
