from typing import Optional, Tuple
import numpy as np
import torch
from faster_whisper import WhisperModel
from backend.app.models.asr_interface import BaseASREngine, ASRResult, TranscriptionSegment

class WhisperEngine(BaseASREngine):
    """
    ASR Engine using faster-whisper (Whisper large-v3-turbo or small).
    Provides rapid language identification (LID) and English transcription with timestamps.
    """

    def __init__(self, model_size: str = "large-v3-turbo", device: Optional[str] = None):
        self.model_size = model_size
        self.device = device or ("cuda" if torch.cuda.is_available() else "cpu")
        self.compute_type = "float16" if self.device == "cuda" else "int8"
        self.model: Optional[WhisperModel] = None
        self._load()

    def _load(self):
        print(f"[WhisperEngine] Loading Whisper '{self.model_size}' onto {self.device} ({self.compute_type})...")
        try:
            self.model = WhisperModel(
                self.model_size,
                device=self.device,
                compute_type=self.compute_type,
            )
            print(f"[WhisperEngine] Whisper '{self.model_size}' loaded successfully")
        except Exception as e:
            print(f"[WhisperEngine] Error loading Whisper model: {e}")
            self.model = None

    def is_ready(self) -> bool:
        return self.model is not None

    def detect_language(self, audio_16k_mono: np.ndarray) -> Tuple[str, float]:
        """Detect dominant spoken language and confidence probability."""
        if not self.is_ready() or len(audio_16k_mono) == 0:
            return "en", 0.0

        try:
            # Whisper expects float32 in [-1.0, 1.0]
            segments, info = self.model.transcribe(
                audio_16k_mono,
                beam_size=1,
                without_timestamps=True,
            )
            return info.language, float(info.language_probability)
        except Exception as e:
            print(f"[WhisperEngine] LID error: {e}")
            return "en", 0.0

    def transcribe(
        self,
        audio_16k_mono: np.ndarray,
        language: Optional[str] = "en",
        is_final: bool = True,
    ) -> ASRResult:
        if not self.is_ready():
            return ASRResult(text="", language=language or "en", is_final=is_final)

        beam_size = 5 if is_final else 1
        lang = language if language and language != "auto" else None

        try:
            segments, info = self.model.transcribe(
                audio_16k_mono,
                language=lang,
                beam_size=beam_size,
                word_timestamps=True,
                no_speech_threshold=0.6,
                compression_ratio_threshold=2.4,
                log_prob_threshold=-1.0,
                condition_on_previous_text=False, # Prevents hallucinations across short phrases/silence
                vad_filter=True, # Drops acoustic hallucinations and non-speech tails
                repetition_penalty=1.2, # Disallows autoregressive loops (...enaaadenaa)
                temperature=[0.0, 0.2, 0.4], # Staged fallback temperature
            )

            seg_list = []
            full_text_parts = []
            for s in segments:
                text_part = s.text.strip()
                if text_part:
                    # Precise word-level start & end alignment
                    seg_start = s.start
                    seg_end = s.end
                    if hasattr(s, "words") and s.words and len(s.words) > 0:
                        seg_start = s.words[0].start
                        seg_end = s.words[-1].end

                    full_text_parts.append(text_part)
                    seg_obj = TranscriptionSegment(start=round(seg_start, 3), end=round(seg_end, 3), text=text_part)
                    seg_list.append(seg_obj)

            full_text = " ".join(full_text_parts).strip()
            detected_lang = info.language or (language or "en")

            # Log each Whisper STT output line to whispr_logs.txt
            from backend.app.models.whisper_logger import log_stt_output
            for s in seg_list:
                log_stt_output(
                    text=s.text,
                    start=s.start,
                    end=s.end,
                    language=detected_lang,
                    source="Whisper STT",
                    status="FINAL" if is_final else "PARTIAL",
                )

            return ASRResult(
                text=full_text,
                language=detected_lang,
                is_final=is_final,
                segments=seg_list,
            )
        except Exception as e:
            print(f"[WhisperEngine] Transcription error: {e}")
            return ASRResult(text="", language=language or "en", is_final=is_final)
