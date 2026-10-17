import { useState } from 'react';
import type { VocabularyItem } from './vocabulary-store';
import { updateVocabularyReview } from './vocabulary-store';
import { learningService } from './learning-service';

export interface ReviewModeProps {
  items: VocabularyItem[];
  onExit: () => void;
}

export function ReviewMode({ items, onExit }: ReviewModeProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [rememberedCount, setRememberedCount] = useState(0);
  const [reviewAgainCount, setReviewAgainCount] = useState(0);
  const [finished, setFinished] = useState(false);

  const currentItem = items[currentIndex];

  const handleReveal = () => {
    setRevealed(true);
  };

  const handleResponse = async (remembered: boolean) => {
    if (!currentItem) return;

    await updateVocabularyReview(currentItem.id, remembered);

    if (remembered) {
      setRememberedCount((c) => c + 1);
    } else {
      setReviewAgainCount((c) => c + 1);
    }

    if (currentIndex + 1 < items.length) {
      setCurrentIndex((i) => i + 1);
      setRevealed(false);
    } else {
      setFinished(true);
    }
  };

  const handleSpeak = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (currentItem) {
      learningService.speak(currentItem.word, currentItem.sourceLanguage);
    }
  };

  if (items.length === 0) {
    return (
      <div className="review-container">
        <div className="review-empty">
          <p>No words available for review. Save some words first!</p>
          <button type="button" className="btn-secondary" onClick={onExit}>
            Back to Vocabulary
          </button>
        </div>
      </div>
    );
  }

  if (finished) {
    return (
      <div className="review-container">
        <div className="review-card review-card--finished">
          <div className="review-finish-icon">🎉</div>
          <h3 className="review-finish-title">Review Session Complete!</h3>
          <p className="review-finish-subtitle">
            You reviewed {items.length} {items.length === 1 ? 'word' : 'words'}.
          </p>

          <div className="review-stats-grid">
            <div className="review-stat-box review-stat-box--remembered">
              <span className="review-stat-num">{rememberedCount}</span>
              <span className="review-stat-label">Remembered</span>
            </div>
            <div className="review-stat-box review-stat-box--again">
              <span className="review-stat-num">{reviewAgainCount}</span>
              <span className="review-stat-label">Review Again</span>
            </div>
          </div>

          <button type="button" className="btn-primary-cta" onClick={onExit}>
            Done & Return to List
          </button>
        </div>
      </div>
    );
  }

  const progressPct = Math.round(((currentIndex) / items.length) * 100);

  return (
    <div className="review-container">
      {/* Top Header & Progress */}
      <div className="review-header">
        <button type="button" className="btn-link" onClick={onExit}>
          ✕ Exit Review
        </button>
        <span className="review-counter">
          Card {currentIndex + 1} of {items.length}
        </span>
      </div>

      <div className="review-progress-track">
        <div className="review-progress-fill" style={{ width: `${progressPct}%` }} />
      </div>

      {/* Flashcard */}
      <div className="review-card">
        <div className="review-card-front">
          <div className="review-word-row">
            <span className="review-word">{currentItem?.word}</span>
            {currentItem?.partOfSpeech && (
              <span className="review-pos">{currentItem.partOfSpeech}</span>
            )}
            <button
              type="button"
              className="review-audio-btn"
              onClick={handleSpeak}
              title="Pronounce"
              aria-label="Pronounce"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
              </svg>
            </button>
          </div>

          {currentItem?.pronunciation && (
            <div className="review-phonetic">{currentItem.pronunciation}</div>
          )}

          {currentItem?.contextSentence && (
            <div className="review-context-snippet">
              <span className="review-context-label">Context:</span> “{currentItem.contextSentence}”
            </div>
          )}
        </div>

        {/* Revealed details */}
        {revealed ? (
          <div className="review-card-back">
            <div className="review-detail-group">
              <span className="review-detail-label">Translation ({currentItem?.targetLanguage.toUpperCase()}):</span>
              <span className="review-detail-trans">{currentItem?.translation}</span>
            </div>

            {currentItem?.meaning && (
              <div className="review-detail-group">
                <span className="review-detail-label">Meaning:</span>
                <span className="review-detail-meaning">{currentItem.meaning}</span>
              </div>
            )}

            {currentItem?.exampleSentence && (
              <div className="review-detail-group review-example-box">
                <span className="review-detail-label">Example:</span>
                <span className="review-example-text">“{currentItem.exampleSentence}”</span>
                {currentItem.exampleTranslation && (
                  <span className="review-example-trans">“{currentItem.exampleTranslation}”</span>
                )}
              </div>
            )}

            {/* Answer buttons */}
            <div className="review-actions">
              <button
                type="button"
                className="review-btn review-btn--again"
                onClick={() => handleResponse(false)}
              >
                Review Again
              </button>
              <button
                type="button"
                className="review-btn review-btn--remembered"
                onClick={() => handleResponse(true)}
              >
                Remembered ✓
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="review-reveal-btn" onClick={handleReveal}>
            Reveal Meaning & Translation
          </button>
        )}
      </div>
    </div>
  );
}
