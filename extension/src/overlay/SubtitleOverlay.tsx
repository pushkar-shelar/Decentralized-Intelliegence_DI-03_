import { useEffect, useState, useSyncExternalStore, type CSSProperties } from 'react';
import type { Cue } from '../shared/cue';
import type { CueProvider } from '../shared/cue-provider';
import type { Store } from '../shared/store';
import type { LiveSubSettings } from '../settings/settings-core';
import type { PlayerStateTracker } from '../youtube/player-state';
import { tokenizeSubtitleText } from '../learning/word-tokenizer';
import { LearningPopup } from '../learning/LearningPopup';

export interface SubtitleOverlayProps {
  video: HTMLVideoElement;
  tracker: PlayerStateTracker;
  provider: CueProvider;
  settings: Store<LiveSubSettings>;
}

/** Reference player height the base font size is designed for. */
const REFERENCE_HEIGHT = 720;

export function formatSpeakerDisplay(rawSpeaker: string): string {
  const trimmed = rawSpeaker.trim();
  if (!trimmed) return '';
  const match = trimmed.match(/^SPEAKER_(\d+)$/i);
  if (match && match[1]) {
    const num = parseInt(match[1], 10) + 1;
    return `Speaker ${num}`;
  }
  return trimmed.replace(/_/g, ' ');
}

function cuesKey(cues: readonly Cue[]): string {
  if (cues.length === 0) return '';
  return cues.map((c) => `${c.id}\u0000${c.text}\u0000${c.translation ?? ''}\u0000${c.speaker ?? ''}`).join('\u0001');
}

/**
 * Hook: all cues active at the video's CURRENT time. Supports multi-speaker dialogue
 * where multiple speakers talk simultaneously or in rapid succession.
 */
function useActiveCues(video: HTMLVideoElement, provider: CueProvider): Cue[] {
  const getCues = (): Cue[] => {
    const currentTime = video.currentTime;
    if (provider.getActiveCues) {
      const all = provider.getActiveCues(currentTime);
      if (all.length > 1) {
        // Multi-speaker check:
        // Only show multiple concurrent subtitle boxes if there are actually DISTINCT speakers tagged!
        const withSpeaker = all.filter((c) => Boolean(c.speaker));
        const distinctSpeakers = new Set(withSpeaker.map((c) => c.speaker));

        if (distinctSpeakers.size > 1) {
          // Multiple distinct speakers speaking simultaneously:
          // Keep at most ONE latest cue per distinct speaker to prevent rolling caption stacking.
          const perSpeaker = new Map<string, Cue>();
          for (const c of all) {
            if (c.speaker) {
              perSpeaker.set(c.speaker, c);
            }
          }
          return Array.from(perSpeaker.values());
        }
      }
    }
    // Standard single-speaker or sequential dialogue:
    // Only return the single most recent active cue (prevents rolling caption stacking)!
    const single = provider.getActiveCue(currentTime);
    return single ? [single] : [];
  };

  const [cues, setCues] = useState<Cue[]>(getCues);

  useEffect(() => {
    let raf = 0;
    let lastKey: string = cuesKey(cues);

    const evaluate = () => {
      const currentTime = video.currentTime;
      const next = getCues();
      const key = cuesKey(next);
      if (key !== lastKey) {
        lastKey = key;
        setCues(next);
        for (const c of next) {
          if (c && c.first_shown_at == null && (c.is_final ?? true)) {
            provider.recordFirstShown?.(c.id, currentTime);
          }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cues is only the initial seed
  }, [video, provider]);

  return cues;
}

export function SubtitleOverlay({ video, tracker, provider, settings: settingsStore }: SubtitleOverlayProps) {
  const settings = useSyncExternalStore(settingsStore.subscribe, settingsStore.get);
  const ui = useSyncExternalStore(
    (cb) => tracker.subscribe(() => cb()),
    () => tracker.snapshot,
  );
  const cues = useActiveCues(video, provider);

  const [selectedWord, setSelectedWord] = useState<{
    word: string;
    sentence: string;
    sourceLang: string;
    targetLang: string;
    timestampSeconds: number;
    anchorRect: DOMRect;
  } | null>(null);

  if (!settings.enabled || ui.isAd || cues.length === 0) return null;

  const scale = Math.min(2.2, Math.max(0.6, ui.playerHeight / REFERENCE_HEIGHT));
  const controlsLift = ui.controlsVisible ? (ui.viewMode === 'fullscreen' ? 84 : 56) : 0;

  const style = {
    '--ls-font-size': `${(settings.fontSize * scale).toFixed(1)}px`,
    '--ls-bg-alpha': settings.bgOpacity,
    bottom: `calc(${settings.position}% + ${controlsLift}px)`,
  } as CSSProperties;

  const containerRect = video.parentElement?.getBoundingClientRect() || document.body.getBoundingClientRect();

  return (
    <>
      <div className="ls-stage" style={style} data-view-mode={ui.viewMode}>
        {cues.map((cue) => {
          const original = cue.text;
          const translation = cue.translation ?? null;
          const lines: Array<{ kind: 'original' | 'translation'; text: string }> = [];
          if (settings.displayMode === 'original') {
            lines.push({ kind: 'original', text: original });
          } else if (settings.displayMode === 'translated') {
            lines.push(translation ? { kind: 'translation', text: translation } : { kind: 'original', text: original });
          } else {
            lines.push({ kind: 'original', text: original });
            // Only show translation line in Dual mode if it is non-empty AND not identical to original
            if (
              translation &&
              translation.trim().length > 0 &&
              translation.trim().toLowerCase() !== original.trim().toLowerCase()
            ) {
              lines.push({ kind: 'translation', text: translation });
            }
          }

          return (
            <div className="ls-cue" key={cue.id} lang={cue.lang} data-source={cue.source}>
              {cue.speaker && (
                <span className="ls-speaker-badge" data-speaker={cue.speaker}>
                  {formatSpeakerDisplay(cue.speaker)}
                </span>
              )}
              {lines.map((line) => {
                const lineLang = line.kind === 'translation' ? cue.translation_lang ?? 'en' : cue.lang ?? 'auto';
                const tokens = tokenizeSubtitleText(line.text);

                return (
                  <span
                    key={line.kind}
                    className={`ls-line ls-${line.kind}`}
                    lang={lineLang}
                  >
                    {tokens.map((token, idx) => {
                      if (!token.isWord) {
                        return <span key={idx}>{token.raw}</span>;
                      }

                      const isSelected = selectedWord?.word === token.word;

                      return (
                        <span key={idx}>
                          {token.leadingPunct}
                          <span
                            role="button"
                            tabIndex={0}
                            className={`ls-word ${isSelected ? 'ls-word--selected' : ''}`}
                            aria-label={`Learn word: ${token.word}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              const rect = e.currentTarget.getBoundingClientRect();
                              setSelectedWord({
                                word: token.word,
                                sentence: line.text,
                                sourceLang: lineLang,
                                targetLang: settings.targetLang,
                                timestampSeconds: cue.start,
                                anchorRect: rect,
                              });
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                const rect = e.currentTarget.getBoundingClientRect();
                                setSelectedWord({
                                  word: token.word,
                                  sentence: line.text,
                                  sourceLang: lineLang,
                                  targetLang: settings.targetLang,
                                  timestampSeconds: cue.start,
                                  anchorRect: rect,
                                });
                              }
                            }}
                          >
                            {token.word}
                          </span>
                          {token.trailingPunct}
                          {token.trailingSpace}
                        </span>
                      );
                    })}
                  </span>
                );
              })}
            </div>
          );
        })}
      </div>

      {selectedWord && (
        <LearningPopup
          word={selectedWord.word}
          sentence={selectedWord.sentence}
          sourceLang={selectedWord.sourceLang}
          targetLang={selectedWord.targetLang}
          videoTitle={typeof document !== 'undefined' ? document.title.replace(/\s*-\s*YouTube$/i, '').trim() : undefined}
          videoUrl={typeof window !== 'undefined' ? window.location.href : undefined}
          timestampSeconds={selectedWord.timestampSeconds}
          anchorRect={selectedWord.anchorRect}
          containerRect={containerRect}
          onClose={() => setSelectedWord(null)}
        />
      )}
    </>
  );
}
