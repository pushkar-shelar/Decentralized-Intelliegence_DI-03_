import os
os.environ["PROTOCOL_BUFFERS_PYTHON_IMPLEMENTATION"] = "python"
import threading
from typing import List, Dict, Any, Optional, Tuple
import numpy as np

class WhisperXEngine:
    """
    Unified Speech Recognition, Forced Phoneme Alignment, and Speaker Diarization
    Engine using WhisperX and Pyannote.
    Designed for safe concurrent processing, model reuse, and robust fallbacks.
    """

    def __init__(
        self,
        model_size: str = "large-v3-turbo",
        device: Optional[str] = None,
        hf_token: Optional[str] = None,
        load_asr_on_init: bool = True,
        load_diarize_on_init: bool = True,
    ):
        self.model_size = model_size
        self._lock = threading.Lock()

        # Hardware detection
        import torch
        self.device = device or ("cuda" if torch.cuda.is_available() else "cpu")
        self.compute_type = "float16" if self.device == "cuda" else "int8"
        
        # Hugging Face token resolution
        self.hf_token = (
            hf_token
            or os.getenv("HF_TOKEN")
            or os.getenv("HUGGING_FACE_HUB_TOKEN")
        )

        self.model = None
        self.align_models: Dict[str, Tuple[Any, Any]] = {}
        self.diarize_pipeline = None

        self.asr_error: Optional[str] = None
        self.diarize_error: Optional[str] = None

        if load_asr_on_init:
            self._load_asr()

        if load_diarize_on_init and self.hf_token:
            self._load_diarization_pipeline()

    def _load_asr(self) -> bool:
        try:
            import whisperx
            print(f"[WhisperXEngine] Loading WhisperX '{self.model_size}' onto {self.device} ({self.compute_type})...")
            self.model = whisperx.load_model(
                self.model_size,
                self.device,
                compute_type=self.compute_type,
            )
            print("[WhisperXEngine] ASR model loaded successfully.")
            self.asr_error = None
            return True
        except ImportError:
            msg = "Optional 'whisperx' not installed. Fallback to WhisperEngine (faster-whisper) is active."
            print(f"[WhisperXEngine] {msg}")
            self.asr_error = msg
            self.model = None
            return False
        except Exception as e:
            msg = f"Failed to load WhisperX model: {e}"
            print(f"[WhisperXEngine] {msg}")
            self.asr_error = msg
            self.model = None
            return False

    def _load_diarization_pipeline(self) -> bool:
        if not self.hf_token:
            self.diarize_error = "HF_TOKEN is missing. Diarization is disabled."
            print(f"[WhisperXEngine] {self.diarize_error}")
            return False

        try:
            import whisperx
            print(f"[WhisperXEngine] Initializing DiarizationPipeline on {self.device}...")
            self.diarize_pipeline = whisperx.DiarizationPipeline(
                use_auth_token=self.hf_token,
                device=self.device,
            )
            print("[WhisperXEngine] DiarizationPipeline initialized and cached.")
            self.diarize_error = None
            return True
        except ImportError:
            msg = "whisperx or pyannote.audio package is not installed. Diarization unavailable."
            print(f"[WhisperXEngine] {msg}")
            self.diarize_error = msg
            self.diarize_pipeline = None
            return False
        except Exception as e:
            msg = f"Failed to initialize DiarizationPipeline ({e}). Ensure user agreement is accepted at https://huggingface.co/pyannote/speaker-diarization-3.1"
            print(f"[WhisperXEngine] {msg}")
            self.diarize_error = msg
            self.diarize_pipeline = None
            return False

    def is_asr_ready(self) -> bool:
        return self.model is not None

    def is_diarization_ready(self) -> bool:
        return self.diarize_pipeline is not None

    def is_ready(self) -> bool:
        # Considered ready if ASR is ready; diarization enhances if available
        return self.is_asr_ready()

    def get_status(self) -> Dict[str, Any]:
        return {
            "asr_ready": self.is_asr_ready(),
            "diarization_ready": self.is_diarization_ready(),
            "model_size": self.model_size,
            "device": self.device,
            "has_hf_token": bool(self.hf_token),
            "asr_error": self.asr_error,
            "diarize_error": self.diarize_error,
        }

    def _get_align_model(self, language_code: str) -> Tuple[Optional[Any], Optional[Any]]:
        """Retrieve cached alignment model or load on demand."""
        if language_code in self.align_models:
            return self.align_models[language_code]

        try:
            import whisperx
            print(f"[WhisperXEngine] Loading alignment model for language '{language_code}'...")
            align_model, metadata = whisperx.load_align_model(
                language_code=language_code,
                device=self.device,
            )
            self.align_models[language_code] = (align_model, metadata)
            return align_model, metadata
        except Exception as e:
            print(f"[WhisperXEngine] Phoneme alignment model unavailable for '{language_code}': {e}")
            self.align_models[language_code] = (None, None)
            return None, None

    def _derive_segment_speaker_from_words(self, segment: Dict[str, Any]) -> Optional[str]:
        """
        If segment-level speaker is missing, derive it from word-level durations.
        Assigns the speaker that accounts for >50% of spoken duration in the segment.
        """
        words = segment.get("words", [])
        if not words:
            return None

        speaker_durations: Dict[str, float] = {}
        total_duration = 0.0

        for w in words:
            spk = w.get("speaker")
            if not spk:
                continue
            w_start = float(w.get("start", 0.0))
            w_end = float(w.get("end", w_start))
            dur = max(0.01, w_end - w_start)
            speaker_durations[spk] = speaker_durations.get(spk, 0.0) + dur
            total_duration += dur

        if not speaker_durations or total_duration <= 0.0:
            return None

        # Sort by total duration
        sorted_spks = sorted(speaker_durations.items(), key=lambda x: x[1], reverse=True)
        top_spk, top_dur = sorted_spks[0]

        # Over 50% majority requirement
        if top_dur / total_duration >= 0.5:
            return top_spk

        return None

    def _assign_speakers_by_overlap(
        self,
        segments: List[Dict[str, Any]],
        diarize_segments: Any,
    ) -> List[Dict[str, Any]]:
        """
        Robust fallback when word alignment is unavailable.
        Matches subtitle segment [start, end] with diarization intervals by maximum overlap.
        """
        # Convert diarize_segments to uniform interval list [(start, end, speaker)]
        intervals: List[Tuple[float, float, str]] = []

        try:
            # Handles pandas DataFrame (WhisperX default) or dict list
            if hasattr(diarize_segments, "iterrows"):
                for _, row in diarize_segments.iterrows():
                    spk = row.get("speaker")
                    if spk:
                        intervals.append((float(row["start"]), float(row["end"]), str(spk)))
            elif isinstance(diarize_segments, list):
                for item in diarize_segments:
                    if isinstance(item, dict) and item.get("speaker"):
                        intervals.append((float(item["start"]), float(item["end"]), str(item["speaker"])))
            elif hasattr(diarize_segments, "itertracks"):
                # Handles pyannote.core.Annotation directly
                for turn, _, speaker in diarize_segments.itertracks(yield_label=True):
                    intervals.append((float(turn.start), float(turn.end), str(speaker)))
        except Exception as e:
            print(f"[WhisperXEngine] Warning: parsing diarization intervals failed: {e}")
            return segments

        if not intervals:
            return segments

        for s in segments:
            if s.get("speaker"):
                continue

            seg_start = float(s.get("start", 0.0))
            seg_end = float(s.get("end", seg_start))
            seg_dur = max(0.01, seg_end - seg_start)

            spk_overlaps: Dict[str, float] = {}

            for d_start, d_end, spk in intervals:
                overlap = max(0.0, min(seg_end, d_end) - max(seg_start, d_start))
                if overlap > 0.0:
                    spk_overlaps[spk] = spk_overlaps.get(spk, 0.0) + overlap

            if spk_overlaps:
                top_spk, top_overlap = max(spk_overlaps.items(), key=lambda x: x[1])
                # Require at least 25% overlap or 200ms to assign with confidence
                if top_overlap >= min(0.2, seg_dur * 0.25):
                    s["speaker"] = top_spk

        return segments

    def process_audio(
        self,
        audio_16k_mono: np.ndarray,
        language: Optional[str] = "en",
        enable_diarization: bool = True,
        min_speakers: Optional[int] = None,
        max_speakers: Optional[int] = None,
    ) -> List[Dict[str, Any]]:
        """
        Transcribes, aligns phonemes down to the millisecond, and diarizes speakers.
        Returns list of segment dicts with start, end, text, and speaker.
        """
        if not self.is_ready() or len(audio_16k_mono) == 0:
            return []

        # Ignore silence / empty audio
        if np.max(np.abs(audio_16k_mono)) < 1e-4:
            return []

        with self._lock:
            # 1. Transcribe
            batch_size = 16
            lang = language if language and language != "auto" else None
            result = self.model.transcribe(
                audio_16k_mono,
                batch_size=batch_size,
                language=lang,
            )

            raw_segments = result.get("segments", [])
            if not raw_segments:
                return []

            detected_lang = result.get("language", language or "en")

            # 2. Phoneme Forced Alignment
            aligned_segments = raw_segments
            alignment_succeeded = False

            try:
                align_model, metadata = self._get_align_model(detected_lang)
                if align_model is not None and metadata is not None:
                    import whisperx
                    aligned_result = whisperx.align(
                        raw_segments,
                        align_model,
                        metadata,
                        audio_16k_mono,
                        self.device,
                        return_char_alignments=False,
                    )
                    aligned_segments = aligned_result.get("segments", raw_segments)
                    alignment_succeeded = True
            except Exception as e:
                print(f"[WhisperXEngine] Alignment skipped/failed for '{detected_lang}': {e}")
                aligned_segments = raw_segments
                alignment_succeeded = False

            # 3. Speaker Diarization
            diarize_segments = None
            if enable_diarization:
                if self.is_diarization_ready():
                    try:
                        diarize_segments = self.diarize_pipeline(
                            audio_16k_mono,
                            min_speakers=min_speakers,
                            max_speakers=max_speakers,
                        )
                    except Exception as e:
                        print(f"[WhisperXEngine] Diarization execution error: {e}")
                elif not self.hf_token:
                    print("[WhisperXEngine] Notice: Diarization skipped (HF_TOKEN not set).")
                elif self.diarize_error:
                    print(f"[WhisperXEngine] Notice: Diarization unavailable ({self.diarize_error})")

            # 4. Speaker Assignment
            if diarize_segments is not None:
                if alignment_succeeded:
                    try:
                        import whisperx
                        aligned_result = whisperx.assign_word_speakers(
                            diarize_segments,
                            {"segments": aligned_segments},
                        )
                        aligned_segments = aligned_result.get("segments", aligned_segments)
                    except Exception as e:
                        print(f"[WhisperXEngine] assign_word_speakers failed, falling back to overlap: {e}")
                        aligned_segments = self._assign_speakers_by_overlap(aligned_segments, diarize_segments)
                else:
                    aligned_segments = self._assign_speakers_by_overlap(aligned_segments, diarize_segments)

            # 5. Format output segments & resolve missing segment-level speaker labels
            output_segments = []
            for s in aligned_segments:
                text = s.get("text", "").strip()
                if not text:
                    continue

                speaker = s.get("speaker")
                if not speaker:
                    # Attempt duration-weighted majority derivation from words
                    speaker = self._derive_segment_speaker_from_words(s)

                seg_dict = {
                    "start": round(float(s.get("start", 0.0)), 3),
                    "end": round(float(s.get("end", 0.0)), 3),
                    "text": text,
                    "speaker": speaker,
                    "language": detected_lang,
                }
                output_segments.append(seg_dict)

            # 6. Log each STT output line to whispr_logs.txt
            from backend.app.models.whisper_logger import log_stt_output
            for item in output_segments:
                log_stt_output(
                    text=item["text"],
                    start=item["start"],
                    end=item["end"],
                    language=item["language"],
                    speaker=item.get("speaker"),
                    source="WhisperX STT",
                    status="FINAL",
                )

            return output_segments
