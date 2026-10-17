import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import {
  downloadJsonFile,
  downloadSrtFile,
  downloadVttFile,
  serializeSrt,
  serializeWebVtt,
  normalizeCuesForExport,
  generateSubtitleFilename,
  type ExportTextMode,
} from '../../src/export/session-export';
import {
  DEFAULT_SETTINGS,
  LANGUAGES,
  LIMITS,
  loadSettings,
  saveSettings,
  type LangCode,
  type LiveSubSettings,
} from '../../src/settings/settings';
import { parseVideoId } from '../../src/youtube/video-id';
import './popup.css';

type TabStatus = { kind: 'loading' } | { kind: 'video'; videoId: string } | { kind: 'other' };
type ExportFormat = 'srt' | 'vtt' | 'json';
type ExportScope = 'all' | 'playback';
type ActiveNavTab = 'subtitles' | 'transcript' | 'tools';
type ActiveDrawer = null | 'appearance' | 'vocabulary' | 'export' | 'more' | 'detected-lang';

interface RawCue {
  id: string;
  start: number;
  end: number;
  text: string;
  translation?: string;
  lang?: string;
  speaker?: string;
}

const LANGUAGE_FLAGS: Record<string, string> = {
  en: '🇺🇸',
  hi: '🇮🇳',
  mr: '🇮🇳',
  ta: '🇮🇳',
  te: '🇮🇳',
};

const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English (US)',
  hi: 'Hindi (हिन्दी)',
  mr: 'Marathi (मराठी)',
  ta: 'Tamil (தமிழ்)',
  te: 'Telugu (తెలుగు)',
};

function formatClock(t: number): string {
  const total = Math.max(0, Math.floor(t));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default function App() {
  const [settings, setSettings] = useState<LiveSubSettings>(DEFAULT_SETTINGS);
  const [capturing, setCapturing] = useState<boolean>(false);
  const [tab, setTab] = useState<TabStatus>({ kind: 'loading' });
  const [activeTabId, setActiveTabId] = useState<number | null>(null);
  const [sessionCueCount, setSessionCueCount] = useState<number | null>(null);
  const [videoTitle, setVideoTitle] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [sessionCues, setSessionCues] = useState<RawCue[]>([]);
  
  // Navigation & Drawer state
  const [navTab, setNavTab] = useState<ActiveNavTab>('subtitles');
  const [activeDrawer, setActiveDrawer] = useState<ActiveDrawer>(null);

  // Export State
  const [exportFormat, setExportFormat] = useState<ExportFormat>('srt');
  const [exportMode, setExportMode] = useState<ExportTextMode>('both');
  const [exportScope, setExportScope] = useState<ExportScope>('all');
  const [exporting, setExporting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [exportMessage, setExportMessage] = useState<string | null>(null);

  useEffect(() => {
    void loadSettings().then(setSettings);
    void browser.tabs.query({ active: true, currentWindow: true }).then(([active]) => {
      const tabId = active?.id ?? null;
      setActiveTabId(tabId);
      const videoId = active?.url ? parseVideoId(active.url) : null;
      setTab(videoId ? { kind: 'video', videoId } : { kind: 'other' });

      if (tabId && videoId) {
        browser.tabs
          .sendMessage(tabId, { type: 'LIVESUB_GET_STATUS' })
          .then((res: any) => {
            if (res) {
              if (typeof res.cueCount === 'number') {
                setSessionCueCount(res.cueCount);
              }
              if (res.videoTitle) {
                setVideoTitle(res.videoTitle);
              }
              if (typeof res.currentTime === 'number') {
                setCurrentTime(res.currentTime);
              }
            }
          })
          .catch(() => {});

        // Fetch recent cues for transcript view
        browser.tabs
          .sendMessage(tabId, { type: 'LIVESUB_EXPORT_SESSION' })
          .then((res: any) => {
            if (res?.ok && res.data?.cues) {
              setSessionCues(res.data.cues);
            }
          })
          .catch(() => {});
      }
    });
  }, []);

  const startAudioCaptureFromPopup = async () => {
    try {
      const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (!activeTab?.id) return;

      (chrome.tabCapture as any).getMediaStreamId({ targetTabId: activeTab.id }, async (streamId: string) => {
        if (chrome.runtime.lastError || !streamId) {
          console.error('[LiveSub Popup] tabCapture error:', chrome.runtime.lastError);
          return;
        }

        console.info('[LiveSub Popup] Got streamId via direct user gesture:', streamId);
        await browser.runtime.sendMessage({
          type: 'START_TAB_CAPTURE_WITH_STREAM_ID',
          streamId,
          tabId: activeTab.id,
        });
        setCapturing(true);
      });
    } catch (err) {
      console.error('[LiveSub Popup] Error initiating tab capture:', err);
    }
  };

  const update = (patch: Partial<LiveSubSettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    void saveSettings(next);
    // 1. Send via background runtime broadcast
    browser.runtime.sendMessage({ type: 'LIVESUB_SETTINGS_UPDATE', settings: next }).catch(() => {});
    // 2. Also send directly to all YouTube tabs
    chrome.tabs.query({ url: '*://*.youtube.com/*' }, (tabs) => {
      for (const t of tabs) {
        if (t.id) {
          chrome.tabs.sendMessage(t.id, { type: 'LIVESUB_SETTINGS_UPDATE', settings: next }, () => {
            if (chrome.runtime.lastError) {}
          });
        }
      }
    });
  };

  const handleExportDownload = async () => {
    if (!activeTabId || exporting) return;
    setExporting(true);
    setExportMessage(null);
    try {
      const res: any = await browser.tabs.sendMessage(activeTabId, { type: 'LIVESUB_EXPORT_SESSION' });
      if (res?.ok && res.data) {
        const vid = res.data.video_id || 'youtube';
        const title = res.data.video_title || videoTitle || vid;
        const rawCues = res.data.cues || [];

        const timeRange =
          exportScope === 'playback' && currentTime > 0
            ? { end: currentTime }
            : undefined;

        if (exportFormat === 'json') {
          const filename = generateSubtitleFilename({
            title,
            videoId: vid,
            format: 'json',
            mode: exportMode,
            targetLang: settings.targetLang,
          });
          const success = downloadJsonFile(filename, res.data);
          if (success) {
            setExportMessage(`Exported ${res.data.total_cues} cues to ${filename}`);
          } else {
            setExportMessage('Browser download failed.');
          }
          return;
        }

        const report = normalizeCuesForExport(rawCues, {
          mode: exportMode,
          targetLang: settings.targetLang,
          timeRange,
        });

        if (report.validCuesCount === 0) {
          setExportMessage('No valid subtitle cues found for the chosen mode and range.');
          return;
        }

        const filename = generateSubtitleFilename({
          title,
          videoId: vid,
          format: exportFormat,
          mode: exportMode,
          targetLang: settings.targetLang,
        });

        let success = false;
        if (exportFormat === 'srt') {
          const srt = serializeSrt(rawCues, {
            mode: exportMode,
            targetLang: settings.targetLang,
            timeRange,
          });
          success = downloadSrtFile(filename, srt);
        } else {
          const vtt = serializeWebVtt(rawCues, {
            mode: exportMode,
            title,
            targetLang: settings.targetLang,
            timeRange,
          });
          success = downloadVttFile(filename, vtt);
        }

        if (success) {
          setExportMessage(`Exported ${report.validCuesCount} cues to ${filename}`);
        } else {
          setExportMessage('Browser download failed to initiate.');
        }
      } else {
        setExportMessage('No active session or cues to export.');
      }
    } catch {
      setExportMessage('Failed to communicate with YouTube tab.');
    } finally {
      setExporting(false);
    }
  };

  const handleCopySubtitles = async () => {
    if (!activeTabId || exporting) return;
    setExporting(true);
    setExportMessage(null);
    try {
      const res: any = await browser.tabs.sendMessage(activeTabId, { type: 'LIVESUB_EXPORT_SESSION' });
      if (res?.ok && res.data) {
        const vid = res.data.video_id || 'youtube';
        const title = res.data.video_title || videoTitle || vid;
        const rawCues = res.data.cues || [];

        const timeRange =
          exportScope === 'playback' && currentTime > 0
            ? { end: currentTime }
            : undefined;

        let textToCopy = '';
        let count = 0;

        if (exportFormat === 'json') {
          textToCopy = JSON.stringify(res.data, null, 2);
          count = res.data.total_cues;
        } else {
          const report = normalizeCuesForExport(rawCues, {
            mode: exportMode,
            targetLang: settings.targetLang,
            timeRange,
          });
          if (report.validCuesCount === 0) {
            setExportMessage('No cues available to copy for chosen options.');
            return;
          }
          count = report.validCuesCount;
          if (exportFormat === 'srt') {
            textToCopy = serializeSrt(rawCues, {
              mode: exportMode,
              targetLang: settings.targetLang,
              timeRange,
            });
          } else {
            textToCopy = serializeWebVtt(rawCues, {
              mode: exportMode,
              title,
              targetLang: settings.targetLang,
              timeRange,
            });
          }
        }

        await navigator.clipboard.writeText(textToCopy);
        setCopied(true);
        setExportMessage(`Copied ${count} cues as ${exportFormat.toUpperCase()}!`);
        setTimeout(() => setCopied(false), 2500);
      } else {
        setExportMessage('No cues available to copy.');
      }
    } catch {
      setExportMessage('Failed to copy session subtitles.');
    } finally {
      setExporting(false);
    }
  };

  const isLive = settings.enabled && tab.kind === 'video';
  const statusLabel = !settings.enabled
    ? 'Paused'
    : isLive
      ? 'Active (Live)'
      : 'Ready';
  const statusClass = !settings.enabled
    ? 'status-pill--off'
    : isLive
      ? 'status-pill--active'
      : 'status-pill--idle';

  return (
    <div className="popup-container">
      {/* ---------- Header ---------- */}
      <header className="popup-header">
        <div className="brand-section">
          <div className="brand-icon-box">
            <div className="brand-icon-waves" aria-hidden="true">
              <span />
              <span />
              <span />
              <span />
              <span />
            </div>
          </div>
          <h1 className="brand-title">LiveSub</h1>
        </div>

        <div className="header-actions">
          <div className={`status-pill ${statusClass}`}>
            <span className="status-pill-dot" />
            <span>{statusLabel}</span>
          </div>
          <button
            id="btn-settings-gear"
            type="button"
            className="btn-icon-gear"
            title="Settings & Diagnostics"
            onClick={() => setActiveDrawer('more')}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
        </div>
      </header>

      {/* ---------- Top Segmented Control ---------- */}
      <nav className="nav-segmented" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={navTab === 'subtitles'}
          className={`nav-tab-btn ${navTab === 'subtitles' ? 'nav-tab-btn--active' : ''}`}
          onClick={() => setNavTab('subtitles')}
        >
          Subtitles
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={navTab === 'transcript'}
          className={`nav-tab-btn ${navTab === 'transcript' ? 'nav-tab-btn--active' : ''}`}
          onClick={() => setNavTab('transcript')}
        >
          Transcript
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={navTab === 'tools'}
          className={`nav-tab-btn ${navTab === 'tools' ? 'nav-tab-btn--active' : ''}`}
          onClick={() => setNavTab('tools')}
        >
          Tools
        </button>
      </nav>

      {/* ---------- Main View: Subtitles Tab ---------- */}
      {navTab === 'subtitles' && (
        <>
          {/* Subtitle Mode */}
          <section className="section-block">
            <h2 className="section-label">Subtitle Mode</h2>
            <div className="mode-grid" role="radiogroup" aria-label="Subtitle Mode">
              {/* Dual Mode Card */}
              <button
                id="mode-dual"
                type="button"
                role="radio"
                aria-checked={settings.displayMode === 'dual'}
                className={`mode-card ${settings.displayMode === 'dual' ? 'mode-card--active' : ''}`}
                onClick={() => update({ displayMode: 'dual' })}
              >
                <div className="mode-card-icon">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="9" />
                    <path d="M12 3a9 9 0 0 1 9 9" strokeWidth="3" />
                    <circle cx="12" cy="12" r="3" fill="currentColor" />
                  </svg>
                </div>
                <div className="mode-card-title">Dual</div>
                <div className="mode-card-subtitle">Original + Translation</div>
              </button>

              {/* Original Only Card */}
              <button
                id="mode-original"
                type="button"
                role="radio"
                aria-checked={settings.displayMode === 'original'}
                className={`mode-card ${settings.displayMode === 'original' ? 'mode-card--active' : ''}`}
                onClick={() => update({ displayMode: 'original' })}
              >
                <div className="mode-card-icon">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                </div>
                <div className="mode-card-title">Original Only</div>
                <div className="mode-card-subtitle">Spoken audio</div>
              </button>

              {/* Translation Only Card */}
              <button
                id="mode-translated"
                type="button"
                role="radio"
                aria-checked={settings.displayMode === 'translated'}
                className={`mode-card ${settings.displayMode === 'translated' ? 'mode-card--active' : ''}`}
                onClick={() => update({ displayMode: 'translated' })}
              >
                <div className="mode-card-icon">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M5 8l6 6" />
                    <path d="M4 14l6-6 2-3" />
                    <path d="M2 5h12" />
                    <path d="M7 2h1" />
                    <path d="M22 22l-5-10-5 10" />
                    <path d="M14 18h6" />
                  </svg>
                </div>
                <div className="mode-card-title">Translation Only</div>
                <div className="mode-card-subtitle">Target only</div>
              </button>
            </div>
          </section>

          {/* Target Language */}
          <section className="section-block">
            <h2 className="section-label">Target Language</h2>
            <div className="lang-selector-wrap">
              <div className="lang-selector-card">
                <div className="lang-selector-content">
                  <span className="lang-flag">{LANGUAGE_FLAGS[settings.targetLang] ?? '🌐'}</span>
                  <div>
                    <div className="lang-name">{LANGUAGE_NAMES[settings.targetLang] ?? settings.targetLang}</div>
                  </div>
                </div>
                <div className="lang-chevron">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </div>
              </div>
              <select
                id="select-target"
                className="lang-native-select"
                value={settings.targetLang}
                onChange={(e) => update({ targetLang: e.target.value as LangCode })}
                aria-label="Select Target Language"
              >
                {LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>
                    {LANGUAGE_FLAGS[l.code] ?? ''} {l.label} ({l.native})
                  </option>
                ))}
              </select>
            </div>
          </section>

          {/* Telemetry & Source Cards */}
          <div className="info-card-list">
            {/* Detected Language Card */}
            <div
              className="info-card"
              role="button"
              tabIndex={0}
              onClick={() => setActiveDrawer('detected-lang')}
            >
              <div className="info-card-left">
                <div className="info-badge-icon info-badge-icon--purple">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 2v20M17 5v14M7 9v6M22 10v4M2 11v2" />
                  </svg>
                </div>
                <div className="info-card-texts">
                  <span className="info-card-label">Detected Language</span>
                  <span className="info-card-value">Hindi (86%) + English (14%)</span>
                </div>
              </div>
              <div className="info-card-arrow">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </div>
            </div>

            {/* Source Card */}
            <div
              className="info-card"
              role="button"
              tabIndex={0}
              onClick={startAudioCaptureFromPopup}
              title="Click to toggle tab audio streaming"
            >
              <div className="info-card-left">
                <div className="info-badge-icon info-badge-icon--green">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="2" y="3" width="20" height="14" rx="2" />
                    <line x1="8" y1="21" x2="16" y2="21" />
                    <line x1="12" y1="17" x2="12" y2="21" />
                  </svg>
                </div>
                <div className="info-card-texts">
                  <span className="info-card-label">Source</span>
                  <span className="info-card-value">
                    <span style={{ color: '#16a34a', fontSize: '10px' }}>●</span>{' '}
                    {capturing ? 'STT (Live Audio)' : 'STT (Live Audio)'}
                  </span>
                </div>
              </div>
              <div className="info-card-arrow">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </div>
            </div>
          </div>

          {/* Primary Action Button */}
          <button
            id="toggle-enabled"
            type="button"
            className={`btn-primary-cta ${settings.enabled ? '' : 'btn-primary-cta--paused'}`}
            onClick={() => update({ enabled: !settings.enabled })}
          >
            {settings.enabled ? (
              <>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="5" y="5" width="14" height="14" rx="2" />
                </svg>
                <span>Stop Subtitles</span>
              </>
            ) : (
              <>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
                <span>Start Subtitles</span>
              </>
            )}
          </button>

          {/* Bottom Action Grid */}
          <div className="action-grid">
            <button
              type="button"
              className={`action-btn-card ${activeDrawer === 'appearance' ? 'action-btn-card--active' : ''}`}
              onClick={() => setActiveDrawer('appearance')}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" />
                <circle cx="17.5" cy="10.5" r=".5" fill="currentColor" />
                <circle cx="8.5" cy="7.5" r=".5" fill="currentColor" />
                <circle cx="6.5" cy="12.5" r=".5" fill="currentColor" />
                <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.563-2.512 5.563-5.563C22 6.5 17.5 2 12 2z" />
              </svg>
              <span>Appearance</span>
            </button>

            <button
              type="button"
              className={`action-btn-card ${activeDrawer === 'vocabulary' ? 'action-btn-card--active' : ''}`}
              onClick={() => setActiveDrawer('vocabulary')}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
              </svg>
              <span>Vocabulary</span>
            </button>

            <button
              type="button"
              className={`action-btn-card ${activeDrawer === 'export' ? 'action-btn-card--active' : ''}`}
              onClick={() => setActiveDrawer('export')}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              <span>Export</span>
            </button>

            <button
              type="button"
              className={`action-btn-card ${activeDrawer === 'more' ? 'action-btn-card--active' : ''}`}
              onClick={() => setActiveDrawer('more')}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="1.5" fill="currentColor" />
                <circle cx="19" cy="12" r="1.5" fill="currentColor" />
                <circle cx="5" cy="12" r="1.5" fill="currentColor" />
              </svg>
              <span>More</span>
            </button>
          </div>
        </>
      )}

      {/* ---------- View: Transcript Tab ---------- */}
      {navTab === 'transcript' && (
        <div className="transcript-container">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 className="section-label">Real-time Transcript</h2>
            <button
              type="button"
              className="btn-secondary"
              style={{ padding: '4px 8px', fontSize: '11px', flex: 'none' }}
              onClick={handleCopySubtitles}
            >
              {copied ? '✓ Copied' : 'Copy All'}
            </button>
          </div>

          {sessionCues.length === 0 ? (
            <div className="transcript-empty">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              <div>No transcript recorded for this video yet. Play the video to stream subtitles live.</div>
            </div>
          ) : (
            sessionCues.map((c, i) => (
              <div key={c.id || i} className="transcript-item">
                <div className="transcript-meta">
                  <span className={`transcript-badge ${c.speaker === 'SPEAKER 01' ? 'transcript-badge--speaker1' : 'transcript-badge--speaker0'}`}>
                    {c.speaker || 'SPEAKER 00'}
                  </span>
                  <span>{formatClock(c.start)} - {formatClock(c.end)}</span>
                </div>
                <div className="transcript-text">{c.text}</div>
                {c.translation && <div className="transcript-trans">{c.translation}</div>}
              </div>
            ))
          )}
        </div>
      )}

      {/* ---------- View: Tools Tab ---------- */}
      {navTab === 'tools' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <h2 className="section-label">Audio & Diagnostics Tools</h2>
          <div className="info-card">
            <div className="info-card-texts">
              <span className="info-card-label">Active Tab</span>
              <span className="info-card-value">
                {tab.kind === 'video' ? `YouTube Video ID: ${tab.videoId}` : 'Non-video tab'}
              </span>
            </div>
          </div>

          {tab.kind === 'video' && (
            <button
              id="btn-start-audio"
              type="button"
              onClick={startAudioCaptureFromPopup}
              className="btn-primary-cta"
            >
              {capturing ? '🟢 Live Audio Capture Active' : '🎙️ Start Tab Audio Stream'}
            </button>
          )}

          <div className="info-card">
            <div className="info-card-texts">
              <span className="info-card-label">Recorded Session Cues</span>
              <span className="info-card-value">
                {sessionCueCount !== null ? `${sessionCueCount} cues accumulated` : '0 cues'}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ---------- Modals / Drawers ---------- */}
      
      {/* 1. Appearance Drawer */}
      {activeDrawer === 'appearance' && (
        <div className="drawer-backdrop" onClick={() => setActiveDrawer(null)}>
          <div className="drawer-content" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-header">
              <h3 className="drawer-title">Subtitle Appearance</h3>
              <button className="btn-drawer-close" onClick={() => setActiveDrawer(null)}>✕</button>
            </div>

            {/* Interactive Real-Time Live Preview */}
            <div className="appearance-preview-box">
              <div
                className="appearance-preview-cue"
                style={{
                  background: `rgba(0, 0, 0, ${settings.bgOpacity})`,
                  marginBottom: `${Math.max(0, (settings.position - LIMITS.position.min) * 0.8)}px`,
                }}
              >
                <span
                  className="appearance-preview-line-orig"
                  style={{ fontSize: `${(settings.fontSize * 0.42).toFixed(1)}px` }}
                >
                  आज हम पनीर टिक्का बनाएंगे
                </span>
                {settings.displayMode !== 'original' && (
                  <span
                    className="appearance-preview-line-trans"
                    style={{ fontSize: `${(settings.fontSize * 0.38).toFixed(1)}px` }}
                  >
                    Today we will make paneer tikka
                  </span>
                )}
              </div>
            </div>

            {/* Font Size Control */}
            <div className="slider-group">
              <div className="slider-header">
                <span className="slider-label">Font Size</span>
                <span className="slider-val">{settings.fontSize}px</span>
              </div>
              <input
                id="slider-font"
                type="range"
                min={LIMITS.fontSize.min}
                max={LIMITS.fontSize.max}
                value={settings.fontSize}
                onChange={(e) => update({ fontSize: Number(e.target.value) })}
              />
              <div className="preset-chips-row">
                {[16, 21, 30, 38].map((size) => (
                  <button
                    key={size}
                    type="button"
                    className={`preset-chip-btn ${settings.fontSize === size ? 'preset-chip-btn--active' : ''}`}
                    onClick={() => update({ fontSize: size })}
                  >
                    {size === 21 ? 'Default (21px)' : `${size}px`}
                  </button>
                ))}
              </div>
            </div>

            {/* Background Opacity Control */}
            <div className="slider-group">
              <div className="slider-header">
                <span className="slider-label">Background Opacity</span>
                <span className="slider-val">{Math.round(settings.bgOpacity * 100)}%</span>
              </div>
              <input
                id="slider-bg"
                type="range"
                min={LIMITS.bgOpacity.min}
                max={LIMITS.bgOpacity.max}
                step={0.05}
                value={settings.bgOpacity}
                onChange={(e) => update({ bgOpacity: Number(e.target.value) })}
              />
              <div className="preset-chips-row">
                {[
                  { label: 'Clear (0%)', val: 0 },
                  { label: 'Glass (40%)', val: 0.4 },
                  { label: 'Std (75%)', val: 0.75 },
                  { label: 'Solid (100%)', val: 1.0 },
                ].map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    className={`preset-chip-btn ${Math.abs(settings.bgOpacity - item.val) < 0.04 ? 'preset-chip-btn--active' : ''}`}
                    onClick={() => update({ bgOpacity: item.val })}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Vertical Position Control */}
            <div className="slider-group">
              <div className="slider-header">
                <span className="slider-label">Vertical Position</span>
                <span className="slider-val">{settings.position}%</span>
              </div>
              <input
                id="slider-position"
                type="range"
                min={LIMITS.position.min}
                max={LIMITS.position.max}
                value={settings.position}
                onChange={(e) => update({ position: Number(e.target.value) })}
              />
              <div className="preset-chips-row">
                {[
                  { label: 'Bottom (6%)', val: 6 },
                  { label: 'Default (8%)', val: 8 },
                  { label: 'Lifted (16%)', val: 16 },
                  { label: 'High (25%)', val: 25 },
                ].map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    className={`preset-chip-btn ${settings.position === item.val ? 'preset-chip-btn--active' : ''}`}
                    onClick={() => update({ position: item.val })}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 2. Export Drawer */}
      {activeDrawer === 'export' && (
        <div className="drawer-backdrop" onClick={() => setActiveDrawer(null)}>
          <div className="drawer-content" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-header">
              <h3 className="drawer-title">Export Subtitles</h3>
              <button className="btn-drawer-close" onClick={() => setActiveDrawer(null)}>✕</button>
            </div>

            <div className="form-group">
              <label className="form-label">Export Format</label>
              <select
                id="select-export-format"
                className="form-select"
                value={exportFormat}
                onChange={(e) => setExportFormat(e.target.value as ExportFormat)}
              >
                <option value="srt">SubRip (.srt)</option>
                <option value="vtt">WebVTT (.vtt)</option>
                <option value="json">JSON (Full Session Log)</option>
              </select>
            </div>

            {exportFormat !== 'json' && (
              <div className="form-group">
                <label className="form-label">Text Mode</label>
                <select
                  id="select-export-mode"
                  className="form-select"
                  value={exportMode}
                  onChange={(e) => setExportMode(e.target.value as ExportTextMode)}
                >
                  <option value="both">Dual (Both Languages)</option>
                  <option value="original">Original Only</option>
                  <option value="translated">Translated Only ({settings.targetLang.toUpperCase()})</option>
                </select>
              </div>
            )}

            <div className="form-group">
              <label className="form-label">Time Range</label>
              <select
                id="select-export-scope"
                className="form-select"
                value={exportScope}
                onChange={(e) => setExportScope(e.target.value as ExportScope)}
              >
                <option value="all">Complete Session (All Cues)</option>
                <option value="playback">Up to Current Playback ({formatClock(currentTime)})</option>
              </select>
            </div>

            <div className="export-actions">
              <button
                id="btn-export-sub"
                type="button"
                className="btn-secondary"
                disabled={exporting || tab.kind !== 'video' || (sessionCueCount === 0 && !settings.demoMode)}
                onClick={handleExportDownload}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                {exporting ? 'Exporting…' : `Save .${exportFormat}`}
              </button>

              <button
                id="btn-copy-sub"
                type="button"
                className="btn-secondary"
                disabled={exporting || tab.kind !== 'video' || (sessionCueCount === 0 && !settings.demoMode)}
                onClick={handleCopySubtitles}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
                {copied ? '✓ Copied' : 'Copy'}
              </button>
            </div>

            {exportMessage && <div className="export-toast">{exportMessage}</div>}
          </div>
        </div>
      )}

      {/* 3. Vocabulary Drawer */}
      {activeDrawer === 'vocabulary' && (
        <div className="drawer-backdrop" onClick={() => setActiveDrawer(null)}>
          <div className="drawer-content" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-header">
              <h3 className="drawer-title">Phonetic & Idiom Normalization</h3>
              <button className="btn-drawer-close" onClick={() => setActiveDrawer(null)}>✕</button>
            </div>

            <div style={{ fontSize: '12px', color: 'var(--text-muted)', lineHeight: '1.4' }}>
              LiveSub automatically repairs noisy Whisper speech-to-text outputs using Grok and Sarvam AI models.
            </div>

            <div className="info-card">
              <div className="info-card-texts">
                <span className="info-card-label">Hindi Idiom Normalization</span>
                <span className="info-card-value">"दाल में कुछ काला है" → "Something is fishy"</span>
              </div>
            </div>

            <div className="info-card">
              <div className="info-card-texts">
                <span className="info-card-label">Acoustic Misspelling Filter</span>
                <span className="info-card-value">"भागध्याना" / "Can Barna" → "भाग जाना" / "कान भरना"</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 4. More & Developer Drawer */}
      {activeDrawer === 'more' && (
        <div className="drawer-backdrop" onClick={() => setActiveDrawer(null)}>
          <div className="drawer-content" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-header">
              <h3 className="drawer-title">Settings & Diagnostics</h3>
              <button className="btn-drawer-close" onClick={() => setActiveDrawer(null)}>✕</button>
            </div>

            <div className="toggle-row">
              <div>
                <div style={{ fontWeight: 600, fontSize: '12.5px' }}>Simulation Demo Mode</div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Generate cues tracking video clock</div>
              </div>
              <button
                id="toggle-demo"
                type="button"
                className={`toggle-switch ${settings.demoMode ? 'is-checked' : ''}`}
                onClick={() => update({ demoMode: !settings.demoMode })}
                aria-label="Toggle Demo Mode"
              >
                <span className="toggle-thumb" />
              </button>
            </div>

            <div className="info-card">
              <div className="info-card-texts">
                <span className="info-card-label">Backend STT Server</span>
                <span className="info-card-value">
                  <span style={{ color: '#16a34a', fontSize: '10px' }}>●</span> http://127.0.0.1:8765
                </span>
              </div>
            </div>

            <button
              id="btn-reset"
              type="button"
              className="btn-secondary"
              onClick={() => update({ ...DEFAULT_SETTINGS })}
            >
              Reset All Settings to Defaults
            </button>

            <div style={{ textAlign: 'center', fontSize: '11px', color: 'var(--text-faint)', paddingTop: '4px' }}>
              LiveSub Extension v{browser.runtime.getManifest().version}
            </div>
          </div>
        </div>
      )}

      {/* 5. Detected Language Details Drawer */}
      {activeDrawer === 'detected-lang' && (
        <div className="drawer-backdrop" onClick={() => setActiveDrawer(null)}>
          <div className="drawer-content" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-header">
              <h3 className="drawer-title">Spoken Language Source</h3>
              <button className="btn-drawer-close" onClick={() => setActiveDrawer(null)}>✕</button>
            </div>

            <div className="form-group">
              <label className="form-label">Input Audio Language</label>
              <select
                id="select-source"
                className="form-select"
                value={settings.sourceLang}
                onChange={(e) => update({ sourceLang: e.target.value as LiveSubSettings['sourceLang'] })}
              >
                <option value="auto">Auto-detect (Hindi 86% + English 14%)</option>
                {LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.label} ({l.native})
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
