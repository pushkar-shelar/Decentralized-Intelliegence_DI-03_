import os
os.environ["PROTOCOL_BUFFERS_PYTHON_IMPLEMENTATION"] = "python"
from typing import List, Dict, Any, Optional
import torch
import numpy as np

class WhisperXEngine:
    """
    Unified Speech Recognition, Forced Phoneme Alignment, and Speaker Diarization
    Engine using WhisperX.
    """

    def __init__(
        self,
        model_size: str = "large-v3-turbo",
        device: Optional[str] = None,
        hf_token: Optional[str] = None,
    ):
        self.model_size = model_size
        self.device = device or ("cuda" if torch.cuda.is_available() else "cpu")
        self.compute_type = "float16" if self.device == "cuda" else "int8"
        self.hf_token = hf_token or os.getenv("HF_TOKEN") or os.getenv("HUGGING_FACE_HUB_TOKEN")

        self.model = None
        self.align_model = None
        self.align_metadata = None
        self.diarize_pipeline = None

        self._load_asr()

    def _load_asr(self):
        try:
            import whisperx
            print(f"[WhisperXEngine] Loading WhisperX '{self.model_size}' onto {self.device}...")
            self.model = whisperx.load_model(
                self.model_size,
                self.device,
                compute_type=self.compute_type,
            )
            print(f"[WhisperXEngine] ASR model loaded successfully.")
        except Exception as e:
            print(f"[WhisperXEngine] Failed to load WhisperX model: {e}")
            self.model = None

    def is_ready(self) -> bool:
        return self.model is not None

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
        Returns list of segment dicts with start, end, text, and optional speaker.
        """
        if not self.is_ready() or len(audio_16k_mono) == 0:
            return []

        import whisperx

        # 1. Transcribe
        batch_size = 16
        lang = language if language and language != "auto" else None
        result = self.model.transcribe(
            audio_16k_mono,
            batch_size=batch_size,
            language=lang,
        )

        detected_lang = result.get("language", language or "en")

        # 2. Phoneme Forced Alignment
        try:
            align_model, metadata = whisperx.load_align_model(
                language_code=detected_lang,
                device=self.device,
            )
            aligned_result = whisperx.align(
                result["segments"],
                align_model,
                metadata,
                audio_16k_mono,
                self.device,
                return_char_alignments=False,
            )
            del align_model
        except Exception as e:
            print(f"[WhisperXEngine] Forced alignment skipped/failed: {e}")
            aligned_result = result

        # 3. Speaker Diarization
        if enable_diarization and self.hf_token:
            try:
                diarize_pipeline = whisperx.DiarizationPipeline(
                    use_auth_token=self.hf_token,
                    device=self.device,
                )
                diarize_segments = diarize_pipeline(
                    audio_16k_mono,
                    min_speakers=min_speakers,
                    max_speakers=max_speakers,
                )
                aligned_result = whisperx.assign_word_speakers(
                    diarize_segments,
                    aligned_result,
                )
                del diarize_pipeline
            except Exception as e:
                print(f"[WhisperXEngine] Diarization skipped/failed: {e}")

        # Format output segments
        output_segments = []
        for s in aligned_result.get("segments", []):
            text = s.get("text", "").strip()
            if not text:
                continue

            speaker = s.get("speaker", None)
            output_segments.append({
                "start": round(float(s.get("start", 0.0)), 3),
                "end": round(float(s.get("end", 0.0)), 3),
                "text": text,
                "speaker": speaker,
                "language": detected_lang,
            })

        return output_segments
