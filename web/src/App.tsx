import React, { useState, useEffect, useRef } from 'react';
import { Navbar } from './components/Navbar';
import { UploadCard } from './components/UploadCard';
import { ProcessingView } from './components/ProcessingView';
import { SubtitleStudio } from './components/SubtitleStudio';
import { extractAudioFromVideo } from './services/audio-extractor';
import { checkBackendHealth, processAudioStreamViaWebSocket, type StreamingProgress } from './services/livesub-api';
import type { SubtitleCue } from './types/cue';
import { SUPPORTED_TARGET_LANGUAGES } from './types/cue';

export const App: React.FC = () => {
  const [viewState, setViewState] = useState<'upload' | 'processing' | 'studio'>('upload');
  const [isBackendOnline, setIsBackendOnline] = useState<boolean>(true);

  // Active video processing state
  const [activeFile, setActiveFile] = useState<File | null>(null);
  const [targetLang, setTargetLang] = useState<string>('en');

  // Processing telemetry
  const [progress, setProgress] = useState<StreamingProgress>({
    stage: 'extract' as any,
    percent: 0,
    chunksProcessed: 0,
    totalChunks: 0,
    currentTimeSec: 0,
    durationSec: 0,
  });
  const [liveCues, setLiveCues] = useState<SubtitleCue[]>([]);
  const [processingError, setProcessingError] = useState<string | null>(null);

  // Final studio data
  const [finalCues, setFinalCues] = useState<SubtitleCue[]>([]);

  const abortControllerRef = useRef<AbortController | null>(null);

  // Check backend health periodically
  useEffect(() => {
    let active = true;
    const check = async () => {
      const res = await checkBackendHealth();
      if (active) setIsBackendOnline(res.online);
    };

    check();
    const interval = setInterval(check, 8000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  const handleStartProcessing = async (file: File, selectedTargetLang: string) => {
    setActiveFile(file);
    setTargetLang(selectedTargetLang);
    setProcessingError(null);
    setLiveCues([]);
    setViewState('processing');

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      // Step 1: Extract 16kHz PCM audio chunks in browser
      setProgress({
        stage: 'extract' as any,
        percent: 5,
        chunksProcessed: 0,
        totalChunks: 0,
        currentTimeSec: 0,
        durationSec: 0,
      });

      const audioData = await extractAudioFromVideo(file, (p) => {
        setProgress((prev) => ({
          ...prev,
          percent: Math.round(p * 20),
          stage: 'extract' as any,
        }));
      });

      if (abortController.signal.aborted) return;

      // Step 2: Stream extracted chunks through the existing LiveSub WebSocket pipeline
      const results = await processAudioStreamViaWebSocket({
        chunks: audioData.chunks,
        durationSec: audioData.durationSec,
        sourceLang: 'auto',
        targetLang: selectedTargetLang,
        signal: abortController.signal,
        onProgress: (p) => {
          setProgress(p);
        },
        onCue: (cue) => {
          setLiveCues((prev) => {
            const map = new Map(prev.map((c) => [c.id, c]));
            map.set(cue.id, cue);
            return Array.from(map.values()).sort((a, b) => a.start - b.start);
          });
        },
      });

      if (results.length === 0) {
        // Fallback: If no speech was detected by VAD
        setFinalCues([
          {
            id: 'c-empty',
            start: 0,
            end: Math.min(5, audioData.durationSec),
            text: 'No speech detected in this video segment.',
            translation: null,
            lang: 'en',
            source: 'stt',
            is_final: true,
          },
        ]);
      } else {
        setFinalCues(results);
      }

      setViewState('studio');
    } catch (err: unknown) {
      if (abortController.signal.aborted) return;
      const msg = err instanceof Error ? err.message : String(err);
      setProcessingError(msg);
    }
  };

  const handleCancelProcessing = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setViewState('upload');
    setProcessingError(null);
  };

  const handleRetryProcessing = () => {
    if (activeFile) {
      handleStartProcessing(activeFile, targetLang);
    }
  };

  const handleResetToUpload = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setActiveFile(null);
    setLiveCues([]);
    setFinalCues([]);
    setProcessingError(null);
    setViewState('upload');
  };

  const targetLangOption = SUPPORTED_TARGET_LANGUAGES.find((l) => l.code === targetLang);
  const targetLangName = targetLangOption ? targetLangOption.name : targetLang;

  return (
    <div className="app-container">
      <Navbar
        isBackendOnline={isBackendOnline}
        onReset={viewState === 'studio' ? handleResetToUpload : undefined}
        showNewButton={viewState === 'studio'}
      />

      <main className="main-content">
        {viewState === 'upload' && (
          <UploadCard
            onStartProcessing={handleStartProcessing}
            isBackendOnline={isBackendOnline}
          />
        )}

        {viewState === 'processing' && activeFile && (
          <ProcessingView
            fileName={activeFile.name}
            targetLangName={targetLangName}
            progress={progress}
            liveCues={liveCues}
            error={processingError}
            onCancel={handleCancelProcessing}
            onRetry={handleRetryProcessing}
          />
        )}

        {viewState === 'studio' && activeFile && (
          <SubtitleStudio
            videoFile={activeFile}
            cues={finalCues}
            targetLangName={targetLangName}
            onNewVideo={handleResetToUpload}
          />
        )}
      </main>
    </div>
  );
};
