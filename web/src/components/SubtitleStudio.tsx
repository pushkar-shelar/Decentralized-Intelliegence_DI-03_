import React, { useState, useRef, useEffect } from 'react';
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  Sliders,
  Download,
  FileText,
  FileCode,
  FileJson,
  Video,
  Loader2,
  Check,
  RotateCcw,
} from 'lucide-react';
import type { SubtitleCue, SubtitleSettings } from '../types/cue';
import {
  exportToSrt,
  exportToVtt,
  exportToTxt,
  exportToJson,
  triggerDownload,
  formatSpeaker,
  formatSrtTime,
  renderBurnedInVideo,
} from '../services/export-service';

interface SubtitleStudioProps {
  videoFile: File;
  cues: SubtitleCue[];
  targetLangName: string;
  onNewVideo: () => void;
}

export const SubtitleStudio: React.FC<SubtitleStudioProps> = ({
  videoFile,
  cues,
  targetLangName,
  onNewVideo,
}) => {
  const [videoUrl, setVideoUrl] = useState<string>('');
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [volume, setVolume] = useState<number>(1.0);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [playbackRate, setPlaybackRate] = useState<number>(1.0);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [showSettingsDrawer, setShowSettingsDrawer] = useState<boolean>(false);

  // Subtitle settings
  const [settings, setSettings] = useState<SubtitleSettings>({
    showOriginal: true,
    showTranslated: true,
    fontSize: 18,
    bgOpacity: 0.8,
    position: 10, // 10% from bottom
  });

  // Export state
  const [isRenderingVideo, setIsRenderingVideo] = useState<boolean>(false);
  const [renderProgress, setRenderProgress] = useState<number>(0);
  const [downloadSuccess, setDownloadSuccess] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const activeTranscriptRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const url = URL.createObjectURL(videoFile);
    setVideoUrl(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [videoFile]);

  // Video time updates
  const handleTimeUpdate = () => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      setDuration(videoRef.current.duration || 0);
    }
  };

  const togglePlay = () => {
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
      setIsPlaying(false);
    } else {
      videoRef.current.play().catch(() => {});
      setIsPlaying(true);
    }
  };

  const handleSeek = (newTime: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = newTime;
      setCurrentTime(newTime);
    }
  };

  const handleVolumeChange = (newVol: number) => {
    if (videoRef.current) {
      videoRef.current.volume = newVol;
      setVolume(newVol);
      setIsMuted(newVol === 0);
    }
  };

  const toggleMute = () => {
    if (!videoRef.current) return;
    if (isMuted) {
      videoRef.current.muted = false;
      setIsMuted(false);
    } else {
      videoRef.current.muted = true;
      setIsMuted(true);
    }
  };

  const handleSpeedChange = (speed: number) => {
    if (videoRef.current) {
      videoRef.current.playbackRate = speed;
      setPlaybackRate(speed);
    }
  };

  const toggleFullscreen = () => {
    const container = document.getElementById('studio-player-box');
    if (!container) return;
    if (!document.fullscreenElement) {
      container.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  // Find active cue at video's currentTime
  const activeCue = cues.find((c) => currentTime >= c.start && currentTime <= c.end) || null;

  // Auto-scroll active cue into view in transcript
  useEffect(() => {
    if (activeTranscriptRef.current) {
      activeTranscriptRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      });
    }
  }, [activeCue?.id]);

  // Filtered cues for transcript
  const filteredCues = cues.filter((c) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    const orig = c.text?.toLowerCase() || '';
    const trans = c.translation?.toLowerCase() || '';
    const spk = c.speaker?.toLowerCase() || '';
    return orig.includes(q) || trans.includes(q) || spk.includes(q);
  });

  const baseFileName = videoFile.name.replace(/\.[^/.]+$/, '');

  // Subtitle exports
  const handleExportSrt = () => {
    const content = exportToSrt(cues, {
      includeOriginal: settings.showOriginal,
      includeTranslation: settings.showTranslated,
    });
    triggerDownload(content, `${baseFileName}_subtitles.srt`, 'text/plain');
    flashSuccess('SRT Subtitles downloaded');
  };

  const handleExportVtt = () => {
    const content = exportToVtt(cues, {
      includeOriginal: settings.showOriginal,
      includeTranslation: settings.showTranslated,
    });
    triggerDownload(content, `${baseFileName}_subtitles.vtt`, 'text/vtt');
    flashSuccess('WebVTT Subtitles downloaded');
  };

  const handleExportTxt = () => {
    const content = exportToTxt(cues);
    triggerDownload(content, `${baseFileName}_transcript.txt`, 'text/plain');
    flashSuccess('Transcript TXT downloaded');
  };

  const handleExportJson = () => {
    const content = exportToJson(cues, videoFile.name);
    triggerDownload(content, `${baseFileName}_subtitles.json`, 'application/json');
    flashSuccess('Subtitle JSON downloaded');
  };

  const handleExportBurnedVideo = async () => {
    if (!videoRef.current || isRenderingVideo) return;
    setIsRenderingVideo(true);
    setRenderProgress(0);

    try {
      const blob = await renderBurnedInVideo({
        videoElement: videoRef.current,
        cues,
        settings,
        onProgress: (p) => setRenderProgress(Math.round(p * 100)),
      });

      triggerDownload(blob, `${baseFileName}_subtitled.webm`, 'video/webm');
      flashSuccess('Burned-in subtitled video downloaded');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      alert(`Video rendering error: ${msg}`);
    } finally {
      setIsRenderingVideo(false);
      setRenderProgress(0);
    }
  };

  const flashSuccess = (msg: string) => {
    setDownloadSuccess(msg);
    setTimeout(() => setDownloadSuccess(null), 3500);
  };

  const formatSeconds = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Top action bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1 className="page-title" style={{ fontSize: '24px', marginBottom: '2px' }}>
            {videoFile.name}
          </h1>
          <p className="page-subtitle" style={{ fontSize: '13px', margin: 0 }}>
            {cues.length} speech segments • Subtitles translated to <strong>{targetLangName}</strong>
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button className="btn btn-secondary btn-sm" onClick={() => setShowSettingsDrawer(!showSettingsDrawer)}>
            <Sliders size={14} />
            <span>Customize Subtitles</span>
          </button>
          <button className="btn btn-secondary btn-sm" onClick={onNewVideo}>
            <RotateCcw size={14} />
            <span>New Video</span>
          </button>
        </div>
      </div>

      {downloadSuccess && (
        <div
          style={{
            padding: '10px 16px',
            borderRadius: 'var(--radius-md)',
            background: 'var(--color-success-light)',
            color: 'var(--color-success)',
            fontSize: '13px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <Check size={16} />
          <span>{downloadSuccess}</span>
        </div>
      )}

      {/* Main Studio Layout */}
      <div className="studio-layout">
        {/* Left: Video Player & Subtitle Canvas */}
        <div className="studio-main">
          <div id="studio-player-box" className="video-player-container" style={{ borderRadius: 'var(--radius-lg)' }}>
            <video
              ref={videoRef}
              src={videoUrl || undefined}
              onTimeUpdate={handleTimeUpdate}
              onLoadedMetadata={handleLoadedMetadata}
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
              onClick={togglePlay}
            />

            {/* Synchronized Bilingual Subtitle Overlay */}
            {activeCue && (
              <div
                className="video-subtitle-overlay"
                style={{
                  bottom: `${settings.position}%`,
                  '--sub-font-size': `${settings.fontSize}px`,
                  '--sub-bg-opacity': settings.bgOpacity,
                } as React.CSSProperties}
              >
                <div className="sub-cue-box">
                  {activeCue.speaker && (
                    <span className="sub-speaker-tag">{formatSpeaker(activeCue.speaker)}</span>
                  )}
                  {settings.showOriginal && activeCue.text && (
                    <span className="sub-text-orig">{activeCue.text}</span>
                  )}
                  {settings.showTranslated &&
                    activeCue.translation &&
                    activeCue.translation.trim().toLowerCase() !== activeCue.text.trim().toLowerCase() && (
                      <span className="sub-text-trans">{activeCue.translation}</span>
                    )}
                </div>
              </div>
            )}
          </div>

          {/* Video Controls Bar */}
          <div
            className="card"
            style={{
              padding: '12px 16px',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
            }}
          >
            {/* Scrubber track */}
            <input
              type="range"
              min={0}
              max={duration || 100}
              step={0.1}
              value={currentTime}
              onChange={(e) => handleSeek(parseFloat(e.target.value))}
              style={{
                width: '100%',
                accentColor: 'var(--color-primary)',
                cursor: 'pointer',
              }}
            />

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <button
                  className="btn btn-ghost"
                  onClick={togglePlay}
                  style={{ width: '36px', height: '36px', padding: 0 }}
                  title={isPlaying ? 'Pause' : 'Play'}
                >
                  {isPlaying ? <Pause size={18} /> : <Play size={18} />}
                </button>

                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <button
                    className="btn btn-ghost"
                    onClick={toggleMute}
                    style={{ width: '32px', height: '32px', padding: 0 }}
                    title={isMuted ? 'Unmute' : 'Mute'}
                  >
                    {isMuted || volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
                  </button>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={isMuted ? 0 : volume}
                    onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
                    style={{ width: '70px', accentColor: 'var(--color-primary)' }}
                  />
                </div>

                <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', fontFamily: 'monospace' }}>
                  {formatSeconds(currentTime)} / {formatSeconds(duration)}
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <select
                  value={playbackRate}
                  onChange={(e) => handleSpeedChange(parseFloat(e.target.value))}
                  style={{
                    height: '30px',
                    padding: '0 8px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--color-border)',
                    fontSize: '12px',
                    background: 'var(--color-surface)',
                  }}
                >
                  <option value={0.5}>0.5x</option>
                  <option value={0.75}>0.75x</option>
                  <option value={1.0}>1.0x</option>
                  <option value={1.25}>1.25x</option>
                  <option value={1.5}>1.5x</option>
                  <option value={2.0}>2.0x</option>
                </select>

                <button
                  className="btn btn-ghost"
                  onClick={toggleFullscreen}
                  style={{ width: '32px', height: '32px', padding: 0 }}
                  title="Fullscreen"
                >
                  <Maximize size={16} />
                </button>
              </div>
            </div>
          </div>

          {/* Subtitle Customization Drawer */}
          {showSettingsDrawer && (
            <div className="card" style={{ padding: '16px' }}>
              <div style={{ fontWeight: 600, fontSize: '14px', marginBottom: '12px' }}>
                Subtitle Appearance & Language Controls
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                  gap: '16px',
                  fontSize: '13px',
                }}
              >
                <div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={settings.showOriginal}
                      onChange={(e) => setSettings({ ...settings, showOriginal: e.target.checked })}
                    />
                    <span>Show Original Subtitles</span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginTop: '8px' }}>
                    <input
                      type="checkbox"
                      checked={settings.showTranslated}
                      onChange={(e) => setSettings({ ...settings, showTranslated: e.target.checked })}
                    />
                    <span>Show Translated ({targetLangName})</span>
                  </label>
                </div>

                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <span>Font Size</span>
                    <span>{settings.fontSize}px</span>
                  </div>
                  <input
                    type="range"
                    min={14}
                    max={32}
                    value={settings.fontSize}
                    onChange={(e) => setSettings({ ...settings, fontSize: parseInt(e.target.value, 10) })}
                    style={{ width: '100%', accentColor: 'var(--color-primary)' }}
                  />
                </div>

                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <span>Background Opacity</span>
                    <span>{Math.round(settings.bgOpacity * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min={0.2}
                    max={1.0}
                    step={0.05}
                    value={settings.bgOpacity}
                    onChange={(e) => setSettings({ ...settings, bgOpacity: parseFloat(e.target.value) })}
                    style={{ width: '100%', accentColor: 'var(--color-primary)' }}
                  />
                </div>

                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <span>Vertical Position</span>
                    <span>{settings.position}%</span>
                  </div>
                  <input
                    type="range"
                    min={4}
                    max={40}
                    value={settings.position}
                    onChange={(e) => setSettings({ ...settings, position: parseInt(e.target.value, 10) })}
                    style={{ width: '100%', accentColor: 'var(--color-primary)' }}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Download & Export Section */}
          <div className="card">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
              <Download size={18} color="var(--color-primary)" />
              <div style={{ fontWeight: 600, fontSize: '15px' }}>Download & Export</div>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: '12px',
              }}
            >
              {/* Burned-in video download */}
              <button
                className="btn btn-primary"
                onClick={handleExportBurnedVideo}
                disabled={isRenderingVideo}
                style={{ height: '44px' }}
              >
                {isRenderingVideo ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    <span>Burning Video ({renderProgress}%)</span>
                  </>
                ) : (
                  <>
                    <Video size={16} />
                    <span>Video with Subtitles (.webm)</span>
                  </>
                )}
              </button>

              <button className="btn btn-secondary" onClick={handleExportSrt}>
                <FileCode size={16} />
                <span>SubRip (.SRT)</span>
              </button>

              <button className="btn btn-secondary" onClick={handleExportVtt}>
                <FileCode size={16} />
                <span>WebVTT (.VTT)</span>
              </button>

              <button className="btn btn-secondary" onClick={handleExportTxt}>
                <FileText size={16} />
                <span>Transcript (.TXT)</span>
              </button>

              <button className="btn btn-secondary" onClick={handleExportJson}>
                <FileJson size={16} />
                <span>Cues Data (.JSON)</span>
              </button>
            </div>
          </div>
        </div>

        {/* Right: Timestamped Transcript Panel */}
        <div className="studio-sidebar">
          <div className="transcript-panel">
            <div className="transcript-header">
              <span style={{ fontWeight: 600, fontSize: '14px' }}>Timestamped Transcript</span>
              <span style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                {filteredCues.length} segments
              </span>
            </div>

            <div className="transcript-search">
              <div style={{ position: 'relative' }}>
                <input
                  type="text"
                  placeholder="Search in transcript..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
            </div>

            <div className="transcript-list">
              {filteredCues.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '32px 16px', color: 'var(--color-text-secondary)' }}>
                  {cues.length === 0 ? 'No speech detected in this video' : 'No matching transcript segments'}
                </div>
              ) : (
                filteredCues.map((c) => {
                  const isActive = activeCue?.id === c.id;
                  return (
                    <div
                      key={c.id}
                      ref={isActive ? activeTranscriptRef : null}
                      className={`transcript-item ${isActive ? 'active' : ''}`}
                      onClick={() => handleSeek(c.start)}
                    >
                      <div className="transcript-meta">
                        <span className="transcript-time">
                          {formatSrtTime(c.start).slice(3, 8)} - {formatSrtTime(c.end).slice(3, 8)}
                        </span>
                        {c.speaker && (
                          <span style={{ color: 'var(--color-primary)', fontWeight: 600 }}>
                            {formatSpeaker(c.speaker)}
                          </span>
                        )}
                      </div>

                      <div className="transcript-orig">{c.text}</div>

                      {c.translation && (
                        <div className="transcript-trans">{c.translation}</div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
