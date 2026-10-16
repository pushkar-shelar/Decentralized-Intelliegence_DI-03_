import time
from typing import Optional, Dict, Any
import numpy as np
from backend.app.audio.vad import SileroVAD, UtteranceBuffer
from backend.app.models.shrutam_engine import ShrutamEngine
from backend.app.models.whisper_engine import WhisperEngine

INDIC_LANGS = {"hi", "mr", "ta", "te", "bn", "gu", "pa", "kn", "ml", "ur", "or", "as"}

class StreamingSpeechProcessor:
    """
    Coordinates VAD segmentation, language routing (Shrutam-2 vs Whisper),
    and streaming cue updates (partials & finals).
    """

    def __init__(
        self,
        shrutam: Optional[ShrutamEngine] = None,
        whisper: Optional[WhisperEngine] = None,
        vad: Optional[SileroVAD] = None,
    ):
        self.vad = vad or SileroVAD()
        self.utterance_buffer = UtteranceBuffer(self.vad)
        self.shrutam = shrutam
        self.whisper = whisper

        self.current_cue_id = 0
        self.active_cue_id: Optional[str] = None
        self.cue_start_video_time: Optional[float] = None
        self.detected_lang: str = "en"

    def process_chunk(
        self,
        chunk_pcm_int16: np.ndarray,
        perf_now: float,
        anchor: Dict[str, Any],
        preferred_lang: str = "auto",
    ) -> Optional[Dict[str, Any]]:
        """
        Process incoming 16kHz int16 PCM chunk (~200ms).
        Returns a LiveSub cue dictionary if a partial or final transcription is ready.
        """
        # Convert Int16 [-32768, 32767] to normalized Float32 [-1.0, 1.0]
        float32_audio = chunk_pcm_int16.astype(np.float32) / 32768.0

        should_partial, should_finalize, speech_audio = self.utterance_buffer.feed(float32_audio, perf_now)

        if speech_audio is None or len(speech_audio) == 0:
            return None

        # Determine target language
        target_lang = preferred_lang
        if target_lang == "auto":
            # Use detected language or fallback
            target_lang = self.detected_lang

        # Assign or track active cue ID
        if self.active_cue_id is None:
            self.current_cue_id += 1
            self.active_cue_id = f"stt-{self.current_cue_id:04d}"
            # Compute video start time from anchor
            v_now = anchor.get("videoTime", 0.0)
            self.cue_start_video_time = round(v_now, 2)

        start_time = self.cue_start_video_time or round(anchor.get("videoTime", 0.0), 2)
        speech_duration_sec = len(speech_audio) / 16000.0
        rate = anchor.get("rate", 1.0)
        end_time = round(start_time + speech_duration_sec * rate, 2)

        # Route between Shrutam-2 and Whisper
        engine_used = "shrutam" if target_lang in INDIC_LANGS and self.shrutam and self.shrutam.is_ready() else "whisper"

        if engine_used == "shrutam" and self.shrutam:
            res = self.shrutam.transcribe(speech_audio, language=target_lang, is_final=should_finalize)
        elif self.whisper:
            res = self.whisper.transcribe(speech_audio, language=target_lang, is_final=should_finalize)
        else:
            return None

        if not res.text:
            return None

        cue = {
            "id": self.active_cue_id,
            "start": start_time,
            "end": end_time,
            "lang": res.language,
            "text": res.text,
            "source": "stt",
            "is_final": should_finalize,
            "revisions": [{"at": round(anchor.get("videoTime", start_time), 2), "text": res.text}],
        }

        if should_finalize:
            cue["first_shown_at"] = round(anchor.get("videoTime", start_time), 2)
            # Reset active cue ID for the next speech utterance
            self.active_cue_id = None
            self.cue_start_video_time = None

        return cue
