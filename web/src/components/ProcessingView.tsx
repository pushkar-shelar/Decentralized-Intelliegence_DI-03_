import React from 'react';
import { Loader2, CheckCircle2, AlertCircle, RefreshCw, XCircle, Mic, Radio } from 'lucide-react';
import type { SubtitleCue } from '../types/cue';
import { getLanguageName } from '../types/cue';
import type { StreamingProgress } from '../services/livesub-api';

interface ProcessingViewProps {
  fileName: string;
  detectedSourceLang?: string;
  targetLangName: string;
  progress: StreamingProgress;
  liveCues: SubtitleCue[];
  error: string | null;
  onCancel: () => void;
  onRetry: () => void;
}

export const ProcessingView: React.FC<ProcessingViewProps> = ({
  fileName,
  detectedSourceLang,
  targetLangName,
  progress,
  liveCues,
  error,
  onCancel,
  onRetry,
}) => {
  const stages = [
    { id: 'extract', label: 'Extracting 16kHz PCM audio from video' },
    { id: 'connecting', label: 'Connecting to LiveSub AI server' },
    { id: 'streaming', label: 'Streaming audio chunks & VAD analysis' },
    { id: 'transcribing', label: 'Speech transcription (WhisperX / faster-whisper)' },
    { id: 'translating', label: `Translating idioms to ${targetLangName} (Grok / Sarvam)` },
    { id: 'completed', label: 'Preparing bilingual subtitle studio' },
  ];

  const getStageStatus = (stageId: string) => {
    const current = progress.stage;
    const order = ['extract', 'connecting', 'streaming', 'transcribing', 'translating', 'completed'];
    const currentIndex = order.indexOf(current);
    const stageIndex = order.indexOf(stageId);

    if (error) return 'error';
    if (stageIndex < currentIndex) return 'completed';
    if (stageIndex === currentIndex) return 'active';
    return 'pending';
  };

  const recentCues = liveCues.slice(-20);
  const detectedLangLabel = detectedSourceLang && detectedSourceLang !== 'auto' ? getLanguageName(detectedSourceLang) : 'Detecting...';

  return (
    <div className="processing-container">
      <div style={{ textAlign: 'center' }}>
        <h1 className="page-title">Processing video</h1>
        <p className="page-subtitle">
          Generating synchronized subtitles for <strong>{fileName}</strong>
        </p>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '4px 12px', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '20px', fontSize: '12px', marginTop: '6px' }}>
          <span>Detected Audio: <strong style={{ color: 'var(--color-primary)' }}>{detectedLangLabel}</strong></span>
          <span>&bull;</span>
          <span>Target Subtitles: <strong>{targetLangName}</strong></span>
        </div>
      </div>

      <div className="card">
        {/* Progress Bar */}
        <div style={{ marginBottom: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginBottom: '8px' }}>
            <span style={{ fontWeight: 500 }}>Overall Progress</span>
            <span style={{ color: 'var(--color-primary)', fontWeight: 600 }}>{progress.percent}%</span>
          </div>
          <div className="progress-bar-track">
            <div className="progress-bar-fill" style={{ width: `${progress.percent}%` }} />
          </div>
          {progress.durationSec > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--color-text-secondary)', marginTop: '4px' }}>
              <span>Processed {progress.currentTimeSec.toFixed(1)}s</span>
              <span>Total {progress.durationSec.toFixed(1)}s</span>
            </div>
          )}
        </div>

        {/* Workflow Stages */}
        <div className="stages-list">
          {stages.map((st) => {
            const status = getStageStatus(st.id);
            return (
              <div
                key={st.id}
                className={`stage-item ${status === 'active' ? 'active' : ''} ${status === 'completed' ? 'completed' : ''}`}
              >
                <div className="stage-icon">
                  {status === 'active' && <Loader2 size={16} className="animate-spin" color="var(--color-primary)" />}
                  {status === 'completed' && <CheckCircle2 size={16} color="var(--color-success)" />}
                  {status === 'pending' && <Radio size={14} color="var(--color-border-hover)" />}
                  {status === 'error' && <AlertCircle size={16} color="var(--color-error)" />}
                </div>
                <div style={{ flex: 1, fontWeight: status === 'active' ? 500 : 400 }}>{st.label}</div>
              </div>
            );
          })}
        </div>

        {/* Live Incoming Cues Ticker */}
        {recentCues.length > 0 && (
          <div
            style={{
              marginTop: '20px',
              padding: '14px',
              borderRadius: 'var(--radius-md)',
              background: 'var(--color-bg)',
              border: '1px solid var(--color-border)',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '11px',
                fontWeight: 600,
                textTransform: 'uppercase',
                color: 'var(--color-text-secondary)',
                marginBottom: '8px',
              }}
            >
              <Mic size={12} color="var(--color-primary)" />
              <span>Live Generated Subtitles ({liveCues.length} cues received)</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '220px', overflowY: 'auto', paddingRight: '4px' }}>
              {recentCues.map((c) => (
                <div key={c.id} style={{ fontSize: '12px' }}>
                  <span style={{ color: 'var(--color-text-secondary)', fontFamily: 'monospace', marginRight: '6px' }}>
                    {c.start.toFixed(1)}s:
                  </span>
                  <span style={{ fontWeight: 500 }}>{c.text}</span>
                  {c.translation && (
                    <div style={{ color: 'var(--color-primary)', fontSize: '11px', marginLeft: '36px' }}>
                      &rarr; {c.translation}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Error Feedback */}
        {error && (
          <div
            style={{
              marginTop: '20px',
              padding: '12px 16px',
              borderRadius: 'var(--radius-md)',
              background: 'var(--color-error-light)',
              color: 'var(--color-error)',
              fontSize: '13px',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
            }}
          >
            <AlertCircle size={18} />
            <div style={{ flex: 1 }}>{error}</div>
          </div>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '24px' }}>
          {error ? (
            <>
              <button className="btn btn-secondary" onClick={onCancel}>
                <XCircle size={15} />
                <span>Cancel</span>
              </button>
              <button className="btn btn-primary" onClick={onRetry}>
                <RefreshCw size={15} />
                <span>Retry</span>
              </button>
            </>
          ) : (
            <button className="btn btn-secondary btn-sm" onClick={onCancel}>
              <XCircle size={14} />
              <span>Cancel processing</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
