import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { learningService, type WordLookupResult } from './learning-service';
import { isWordSaved, saveVocabularyItem, deleteVocabularyItem, createVocabularyId } from './vocabulary-store';

export interface LearningPopupProps {
  word: string;
  sentence: string;
  sourceLang: string;
  targetLang: string;
  videoTitle?: string;
  videoUrl?: string;
  timestampSeconds?: number;
  anchorRect: DOMRect;
  containerRect: DOMRect;
  onClose: () => void;
}

const LANGUAGE_FLAGS: Record<string, string> = {
  en: '🇺🇸',
  hi: '🇮🇳',
  mr: '🇮🇳',
  ta: '🇮🇳',
  te: '🇮🇳',
};

export function LearningPopup({
  word,
  sentence,
  sourceLang,
  targetLang,
  videoTitle,
  videoUrl,
  timestampSeconds,
  anchorRect,
  containerRect,
  onClose,
}: LearningPopupProps) {
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<WordLookupResult | null>(null);
  const [isSaved, setIsSaved] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const popupRef = useRef<HTMLDivElement>(null);

  // Check saved status
  useEffect(() => {
    let active = true;
    void isWordSaved(word, sourceLang, targetLang).then((saved) => {
      if (active) setIsSaved(saved);
    });
    return () => {
      active = false;
    };
  }, [word, sourceLang, targetLang]);

  // Fetch word details
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    learningService
      .lookupWord({
        word,
        sentence,
        sourceLang,
        targetLang,
        videoTitle,
        videoUrl,
        timestampSeconds,
        signal: controller.signal,
      })
      .then((res) => {
        setData(res);
        setLoading(false);
      })
      .catch((err) => {
        if (err?.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : 'Could not retrieve word meaning.');
        setLoading(false);
      });

    return () => {
      controller.abort();
    };
  }, [word, sentence, sourceLang, targetLang, videoTitle, videoUrl, timestampSeconds]);

  // Handle Escape key to close
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Compute position relative to player container
  const POPUP_WIDTH = 310;
  const POPUP_HEIGHT = 230; // estimated max height

  const relLeft = anchorRect.left - containerRect.left + anchorRect.width / 2;
  const relTop = anchorRect.top - containerRect.top;

  // Center horizontally over word, but clamp to container bounds
  let left = relLeft - POPUP_WIDTH / 2;
  left = Math.max(12, Math.min(left, containerRect.width - POPUP_WIDTH - 12));

  // Prefer placing above word; if too close to top, place below
  let top = relTop - POPUP_HEIGHT - 12;
  if (top < 12) {
    top = relTop + anchorRect.height + 12;
  }

  const style: CSSProperties = {
    position: 'absolute',
    left: `${Math.round(left)}px`,
    top: `${Math.round(top)}px`,
    width: `${POPUP_WIDTH}px`,
    zIndex: 9999,
    pointerEvents: 'auto',
  };

  const handleToggleSave = async () => {
    if (!data || saving) return;
    setSaving(true);
    try {
      const id = createVocabularyId(data.word, sourceLang, targetLang);
      if (isSaved) {
        await deleteVocabularyItem(id);
        setIsSaved(false);
      } else {
        await saveVocabularyItem({
          word: data.word,
          normalizedWord: data.normalizedWord,
          sourceLanguage: sourceLang,
          targetLanguage: targetLang,
          meaning: data.meaning,
          translation: data.translation,
          exampleSentence: data.exampleSentence,
          exampleTranslation: data.exampleTranslation,
          pronunciation: data.pronunciation,
          partOfSpeech: data.partOfSpeech,
          contextSentence: sentence,
          videoTitle,
          videoUrl,
          timestampSeconds,
        });
        setIsSaved(true);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleSpeak = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (data?.word) {
      learningService.speak(data.word, sourceLang);
    }
  };

  return (
    <div
      ref={popupRef}
      className="ls-learning-popup"
      style={style}
      role="dialog"
      aria-label={`Learning details for ${word}`}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="ls-lp-header">
        <div className="ls-lp-word-row">
          <span className="ls-lp-word">{word}</span>
          {data?.partOfSpeech && <span className="ls-lp-pos">{data.partOfSpeech}</span>}
          <button
            type="button"
            className="ls-lp-audio-btn"
            title="Listen to pronunciation"
            onClick={handleSpeak}
            aria-label="Pronounce word"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
            </svg>
          </button>
        </div>

        <button
          type="button"
          className="ls-lp-close-btn"
          onClick={onClose}
          aria-label="Close learning popup"
        >
          ✕
        </button>
      </div>

      {data?.pronunciation && <div className="ls-lp-phonetic">{data.pronunciation}</div>}

      {/* Body */}
      {loading ? (
        <div className="ls-lp-loading">
          <div className="ls-lp-skeleton" style={{ width: '80%', height: '14px', marginBottom: '8px' }} />
          <div className="ls-lp-skeleton" style={{ width: '100%', height: '12px', marginBottom: '6px' }} />
          <div className="ls-lp-skeleton" style={{ width: '65%', height: '12px' }} />
        </div>
      ) : error ? (
        <div className="ls-lp-error">
          <span>{error}</span>
        </div>
      ) : data ? (
        <div className="ls-lp-content">
          {/* Translation */}
          <div className="ls-lp-section">
            <div className="ls-lp-label">
              <span>{LANGUAGE_FLAGS[targetLang] ?? '🌐'}</span>
              <span>Translation ({targetLang.toUpperCase()}):</span>
            </div>
            <div className="ls-lp-translation-text">{data.translation}</div>
          </div>

          {/* Meaning / Contextual Definition */}
          {data.meaning && (
            <div className="ls-lp-section">
              <div className="ls-lp-label">Meaning:</div>
              <div className="ls-lp-meaning-text">{data.meaning}</div>
            </div>
          )}

          {/* Example Sentence */}
          {data.exampleSentence && (
            <div className="ls-lp-section ls-lp-example-box">
              <div className="ls-lp-label">Example:</div>
              <div className="ls-lp-example-text">“{data.exampleSentence}”</div>
              {data.exampleTranslation && (
                <div className="ls-lp-example-trans">“{data.exampleTranslation}”</div>
              )}
            </div>
          )}
        </div>
      ) : null}

      {/* Footer */}
      {!loading && !error && data && (
        <div className="ls-lp-footer">
          <button
            type="button"
            className={`ls-lp-save-btn ${isSaved ? 'ls-lp-save-btn--saved' : ''}`}
            onClick={handleToggleSave}
            disabled={saving}
          >
            {isSaved ? (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <span>Saved in Vocabulary</span>
              </>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
                </svg>
                <span>Save Word</span>
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
