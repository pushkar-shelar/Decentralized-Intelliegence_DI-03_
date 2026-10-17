import React, { useState, useRef } from 'react';
import { UploadCloud, Film, Languages, ArrowRight, X, AlertCircle } from 'lucide-react';
import { SUPPORTED_TARGET_LANGUAGES, SUPPORTED_SOURCE_LANGUAGES } from '../types/cue';

interface UploadCardProps {
  onStartProcessing: (file: File, sourceLang: string, targetLang: string) => void;
  isBackendOnline: boolean;
}

export const UploadCard: React.FC<UploadCardProps> = ({ onStartProcessing, isBackendOnline }) => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [videoDuration, setVideoDuration] = useState<number | null>(null);
  const [sourceLang, setSourceLang] = useState<string>('auto');
  const [targetLang, setTargetLang] = useState<string>('en');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (file: File) => {
    setErrorMsg(null);
    if (!file.type.startsWith('video/')) {
      setErrorMsg('Please upload a valid video file (MP4, WebM, MOV).');
      return;
    }

    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }

    const url = URL.createObjectURL(file);
    setSelectedFile(file);
    setPreviewUrl(url);

    // Load duration
    const tempVideo = document.createElement('video');
    tempVideo.preload = 'metadata';
    tempVideo.src = url;
    tempVideo.onloadedmetadata = () => {
      setVideoDuration(tempVideo.duration);
    };
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileSelect(e.dataTransfer.files[0]);
    }
  };

  const handleRemove = () => {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    setSelectedFile(null);
    setPreviewUrl(null);
    setVideoDuration(null);
    setErrorMsg(null);
  };

  const formatFileSize = (bytes: number): string => {
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(1)} MB`;
  };

  const formatDuration = (secs: number): string => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div style={{ maxWidth: '680px', margin: '0 auto' }}>
      <div style={{ textAlign: 'center', marginBottom: '28px' }}>
        <h1 className="page-title">Generate subtitles</h1>
        <p className="page-subtitle">
          Upload any video to extract speech, auto-detect language, transcribe with WhisperX, and translate with cultural nuances.
        </p>
      </div>

      {!selectedFile ? (
        <div
          className={`dropzone ${isDragging ? 'active' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="video/mp4,video/webm,video/quicktime,video/x-matroska"
            style={{ display: 'none' }}
            onChange={(e) => {
              if (e.target.files && e.target.files[0]) {
                handleFileSelect(e.target.files[0]);
              }
            }}
          />
          <UploadCloud className="dropzone-icon" />
          <div className="dropzone-title">Click to browse or drag and drop a video</div>
          <div className="dropzone-subtitle">Supports MP4, WebM, MOV, and MKV files</div>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={(e) => {
              e.stopPropagation();
              fileInputRef.current?.click();
            }}
            style={{ marginTop: '8px' }}
          >
            Browse files
          </button>
        </div>
      ) : (
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Film size={20} color="var(--color-primary)" />
              <div>
                <div style={{ fontWeight: 600, fontSize: '15px' }}>{selectedFile.name}</div>
                <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                  {formatFileSize(selectedFile.size)}
                  {videoDuration !== null && ` • ${formatDuration(videoDuration)}`}
                </div>
              </div>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={handleRemove} title="Remove video">
              <X size={16} />
              <span>Remove</span>
            </button>
          </div>

          {previewUrl && (
            <div style={{ borderRadius: 'var(--radius-md)', overflow: 'hidden', background: '#000', marginBottom: '20px' }}>
              <video
                src={previewUrl}
                controls
                style={{ width: '100%', maxHeight: '280px', display: 'block', objectFit: 'contain' }}
              />
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '20px' }}>
            <div>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  fontSize: '13px',
                  fontWeight: 500,
                  marginBottom: '8px',
                }}
              >
                <Languages size={16} color="var(--color-primary)" />
                <span>Spoken Audio Language</span>
              </label>
              <select
                value={sourceLang}
                onChange={(e) => setSourceLang(e.target.value)}
                style={{
                  width: '100%',
                  height: '40px',
                  padding: '0 12px',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--color-border)',
                  background: 'var(--color-surface)',
                  outline: 'none',
                  fontSize: '14px',
                }}
              >
                {SUPPORTED_SOURCE_LANGUAGES.map((lang) => (
                  <option key={lang.code} value={lang.code}>
                    {lang.name} {lang.nativeName && `(${lang.nativeName})`}
                  </option>
                ))}
              </select>
              <div style={{ fontSize: '11px', color: 'var(--color-text-secondary)', marginTop: '4px' }}>
                Auto-detects spoken speech or select to force script.
              </div>
            </div>

            <div>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  fontSize: '13px',
                  fontWeight: 500,
                  marginBottom: '8px',
                }}
              >
                <Languages size={16} color="var(--color-primary)" />
                <span>Target Subtitle Language</span>
              </label>
              <select
                value={targetLang}
                onChange={(e) => setTargetLang(e.target.value)}
                style={{
                  width: '100%',
                  height: '40px',
                  padding: '0 12px',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--color-border)',
                  background: 'var(--color-surface)',
                  outline: 'none',
                  fontSize: '14px',
                }}
              >
                {SUPPORTED_TARGET_LANGUAGES.map((lang) => (
                  <option key={lang.code} value={lang.code}>
                    {lang.name} {lang.nativeName && `(${lang.nativeName})`}
                  </option>
                ))}
              </select>
              <div style={{ fontSize: '11px', color: 'var(--color-text-secondary)', marginTop: '4px' }}>
                Cultural idioms will be translated to this language.
              </div>
            </div>
          </div>

          {!isBackendOnline && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '10px 14px',
                borderRadius: 'var(--radius-md)',
                background: 'var(--color-warning-light)',
                color: 'var(--color-warning)',
                fontSize: '12px',
                marginBottom: '16px',
              }}
            >
              <AlertCircle size={16} />
              <span>Backend server is currently offline. Please ensure LiveSub backend is running on port 8765.</span>
            </div>
          )}

          <button
            className="btn btn-primary"
            style={{ width: '100%', height: '42px', fontSize: '14px' }}
            disabled={!isBackendOnline}
            onClick={() => onStartProcessing(selectedFile, sourceLang, targetLang)}
          >
            <span>Generate Subtitles</span>
            <ArrowRight size={16} />
          </button>
        </div>
      )}

      {errorMsg && (
        <div
          style={{
            marginTop: '16px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '12px 16px',
            borderRadius: 'var(--radius-md)',
            background: 'var(--color-error-light)',
            color: 'var(--color-error)',
            fontSize: '13px',
          }}
        >
          <AlertCircle size={18} />
          <span>{errorMsg}</span>
        </div>
      )}
    </div>
  );
};
