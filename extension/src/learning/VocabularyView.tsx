import { useEffect, useMemo, useState } from 'react';
import { browser } from 'wxt/browser';
import {
  deleteVocabularyItem,
  loadVocabulary,
  subscribeVocabulary,
  type VocabularyItem,
} from './vocabulary-store';
import { learningService } from './learning-service';
import { ReviewMode } from './ReviewMode';

const LANGUAGE_FLAGS: Record<string, string> = {
  en: '🇺🇸',
  hi: '🇮🇳',
  mr: '🇮🇳',
  ta: '🇮🇳',
  te: '🇮🇳',
};

const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  hi: 'Hindi',
  mr: 'Marathi',
  ta: 'Tamil',
  te: 'Telugu',
};

export function VocabularyView() {
  const [items, setItems] = useState<VocabularyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [langFilter, setLangFilter] = useState('all');
  const [sortBy, setSortBy] = useState<'newest' | 'alpha'>('newest');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [isReviewing, setIsReviewing] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void loadVocabulary().then((res) => {
      if (active) {
        setItems(res);
        setLoading(false);
      }
    });

    const unsub = subscribeVocabulary((updated) => {
      if (active) setItems(updated);
    });

    return () => {
      active = false;
      unsub();
    };
  }, []);

  const flashToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 2500);
  };

  const handleDelete = async (id: string, word: string) => {
    const success = await deleteVocabularyItem(id);
    if (success) {
      flashToast(`Removed "${word}"`);
    }
  };

  const handleSpeak = (e: React.MouseEvent, item: VocabularyItem) => {
    e.stopPropagation();
    learningService.speak(item.word, item.sourceLanguage);
  };

  const handleWatchAgain = (item: VocabularyItem) => {
    const timeSec = Math.floor(item.timestampSeconds || 0);
    if (item.videoUrl) {
      // Append or replace timestamp in url
      let targetUrl = item.videoUrl;
      try {
        const u = new URL(item.videoUrl);
        u.searchParams.set('t', `${timeSec}s`);
        targetUrl = u.toString();
      } catch {
        targetUrl = `${item.videoUrl}&t=${timeSec}s`;
      }
      void browser.tabs.create({ url: targetUrl });
    } else {
      // Seek in active YouTube tab if available
      void browser.tabs.query({ active: true, currentWindow: true }).then(([active]) => {
        if (active?.id) {
          void browser.tabs.sendMessage(active.id, {
            type: 'LIVESUB_SEEK',
            time: timeSec,
          });
          flashToast(`Seeked to ${timeSec}s`);
        }
      });
    }
  };

  // Filter and sort items
  const filteredItems = useMemo(() => {
    return items
      .filter((item) => {
        // Language filter
        if (langFilter !== 'all') {
          if (item.sourceLanguage !== langFilter && item.targetLanguage !== langFilter) {
            return false;
          }
        }
        // Search query filter
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase().trim();
          const matchWord = item.word.toLowerCase().includes(q);
          const matchTrans = item.translation.toLowerCase().includes(q);
          const matchMeaning = item.meaning.toLowerCase().includes(q);
          if (!matchWord && !matchTrans && !matchMeaning) return false;
        }
        return true;
      })
      .sort((a, b) => {
        if (sortBy === 'alpha') {
          return a.word.localeCompare(b.word);
        }
        return b.createdAt - a.createdAt;
      });
  }, [items, searchQuery, langFilter, sortBy]);

  if (isReviewing) {
    return <ReviewMode items={filteredItems} onExit={() => setIsReviewing(false)} />;
  }

  return (
    <div className="vocab-container">
      {/* Action / Header Bar */}
      <div className="vocab-top-bar">
        <div className="vocab-count-badge">
          <strong>{filteredItems.length}</strong> {filteredItems.length === 1 ? 'word' : 'words'} saved
        </div>

        {items.length > 0 && (
          <button
            type="button"
            className="vocab-review-cta"
            onClick={() => setIsReviewing(true)}
            title="Start Spaced Repetition Review"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
            </svg>
            <span>Start Review</span>
          </button>
        )}
      </div>

      {/* Search & Filter Controls */}
      {items.length > 0 && (
        <div className="vocab-controls">
          <div className="vocab-search-wrap">
            <svg
              className="vocab-search-icon"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              className="vocab-search-input"
              placeholder="Search words, meanings or translations…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button
                type="button"
                className="vocab-search-clear"
                onClick={() => setSearchQuery('')}
              >
                ✕
              </button>
            )}
          </div>

          <div className="vocab-filter-row">
            <select
              className="vocab-select"
              value={langFilter}
              onChange={(e) => setLangFilter(e.target.value)}
              aria-label="Filter by language"
            >
              <option value="all">All Languages</option>
              {Object.entries(LANGUAGE_NAMES).map(([code, name]) => (
                <option key={code} value={code}>
                  {LANGUAGE_FLAGS[code] ?? ''} {name}
                </option>
              ))}
            </select>

            <select
              className="vocab-select"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              aria-label="Sort vocabulary"
            >
              <option value="newest">Recently Added</option>
              <option value="alpha">Alphabetical (A-Z)</option>
            </select>
          </div>
        </div>
      )}

      {/* Toast */}
      {toastMessage && <div className="vocab-toast">{toastMessage}</div>}

      {/* Vocabulary List */}
      {loading ? (
        <div className="vocab-loading">Loading vocabulary…</div>
      ) : filteredItems.length === 0 ? (
        <div className="vocab-empty">
          <div className="vocab-empty-icon">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
            </svg>
          </div>
          <h3 className="vocab-empty-title">
            {searchQuery || langFilter !== 'all' ? 'No matching words found' : 'No words saved yet'}
          </h3>
          <p className="vocab-empty-text">
            {searchQuery || langFilter !== 'all'
              ? 'Try adjusting your search terms or language filter.'
              : 'While watching any video with subtitles, click any word to see its contextual meaning, translation, and save it directly to this list!'}
          </p>
        </div>
      ) : (
        <div className="vocab-list">
          {filteredItems.map((item) => {
            const isExpanded = expandedId === item.id;
            const statusLabel =
              item.reviewStatus === 'mastered'
                ? 'Mastered'
                : item.reviewStatus === 'learning'
                  ? 'Learning'
                  : 'New';

            const statusClass =
              item.reviewStatus === 'mastered'
                ? 'vocab-badge--mastered'
                : item.reviewStatus === 'learning'
                  ? 'vocab-badge--learning'
                  : 'vocab-badge--new';

            return (
              <div
                key={item.id}
                className={`vocab-card ${isExpanded ? 'vocab-card--expanded' : ''}`}
                onClick={() => setExpandedId(isExpanded ? null : item.id)}
              >
                {/* Header row */}
                <div className="vocab-card-header">
                  <div className="vocab-card-word-block">
                    <span className="vocab-card-word">{item.word}</span>
                    {item.partOfSpeech && (
                      <span className="vocab-card-pos">{item.partOfSpeech}</span>
                    )}
                    <button
                      type="button"
                      className="vocab-card-speak-btn"
                      onClick={(e) => handleSpeak(e, item)}
                      title="Listen"
                      aria-label="Listen"
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                        <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
                      </svg>
                    </button>
                  </div>

                  <div className="vocab-card-meta">
                    <span className={`vocab-badge ${statusClass}`}>{statusLabel}</span>
                    <button
                      type="button"
                      className="vocab-card-delete-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleDelete(item.id, item.word);
                      }}
                      title="Delete from vocabulary"
                      aria-label="Delete"
                    >
                      ✕
                    </button>
                  </div>
                </div>

                {/* Translation & Meaning */}
                <div className="vocab-card-body">
                  <div className="vocab-card-trans">
                    <span className="vocab-lang-flag">{LANGUAGE_FLAGS[item.targetLanguage] ?? '🌐'}</span>
                    <span className="vocab-trans-text">{item.translation}</span>
                  </div>
                  {item.meaning && <div className="vocab-card-meaning">{item.meaning}</div>}
                </div>

                {/* Expanded Details */}
                {isExpanded && (
                  <div className="vocab-card-details" onClick={(e) => e.stopPropagation()}>
                    {item.pronunciation && (
                      <div className="vocab-detail-row">
                        <span className="vocab-detail-label">Pronunciation:</span>
                        <span className="vocab-detail-val">{item.pronunciation}</span>
                      </div>
                    )}

                    {item.exampleSentence && (
                      <div className="vocab-detail-row vocab-example-block">
                        <span className="vocab-detail-label">Example:</span>
                        <div className="vocab-example-sent">“{item.exampleSentence}”</div>
                        {item.exampleTranslation && (
                          <div className="vocab-example-trans">“{item.exampleTranslation}”</div>
                        )}
                      </div>
                    )}

                    {item.contextSentence && (
                      <div className="vocab-detail-row">
                        <span className="vocab-detail-label">Original Subtitle Context:</span>
                        <div className="vocab-context-sent">“{item.contextSentence}”</div>
                      </div>
                    )}

                    {item.videoTitle && (
                      <div className="vocab-detail-row">
                        <span className="vocab-detail-label">Video:</span>
                        <span className="vocab-video-title">{item.videoTitle}</span>
                      </div>
                    )}

                    {/* Actions */}
                    <div className="vocab-card-actions">
                      {(item.videoUrl || typeof item.timestampSeconds === 'number') && (
                        <button
                          type="button"
                          className="vocab-action-btn vocab-action-btn--watch"
                          onClick={() => handleWatchAgain(item)}
                        >
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                            <polygon points="5 3 19 12 5 21 5 3" />
                          </svg>
                          <span>Watch Again ({Math.floor(item.timestampSeconds || 0)}s)</span>
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
