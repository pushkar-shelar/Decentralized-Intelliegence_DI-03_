import time
from typing import Optional, Dict, Any, List
import numpy as np
from backend.app.audio.vad import SileroVAD, UtteranceBuffer
from backend.app.models.shrutam_engine import ShrutamEngine
from backend.app.models.whisper_engine import WhisperEngine
from backend.app.models.whisperx_engine import WhisperXEngine

INDIC_LANGS = {"hi", "mr", "ta", "te", "bn", "gu", "pa", "kn", "ml", "ur", "or", "as"}

class StreamingSpeechProcessor:
    """
    Coordinates VAD segmentation, language routing, low-latency streaming transcription
    via Whisper, and utterance-level speaker diarization via WhisperX/Pyannote.
    """

    def __init__(
        self,
        shrutam: Optional[ShrutamEngine] = None,
        whisper: Optional[WhisperEngine] = None,
        vad: Optional[SileroVAD] = None,
        whisperx: Optional[WhisperXEngine] = None,
    ):
        self.vad = vad or SileroVAD()
        self.utterance_buffer = UtteranceBuffer(self.vad)
        self.shrutam = shrutam
        self.whisper = whisper
        self.whisperx = whisperx

        self.current_cue_id = 0
        self.active_cue_id: Optional[str] = None
        self.cue_start_video_time: Optional[float] = None
        self.detected_lang: str = "en"

        # Session-stable speaker ID mapping (e.g. SPEAKER_00 -> Speaker 1)
        self.speaker_label_map: Dict[str, str] = {}
        self.next_speaker_num = 1

    def _get_stable_speaker_label(self, raw_speaker: Optional[str]) -> Optional[str]:
        if not raw_speaker:
            return None
        
        raw_speaker = str(raw_speaker).strip()
        if not raw_speaker:
            return None

        if raw_speaker not in self.speaker_label_map:
            # Map SPEAKER_00, SPEAKER_01 or arbitrary cluster tags into human-friendly Speaker N
            label = f"Speaker {self.next_speaker_num}"
            self.speaker_label_map[raw_speaker] = label
            self.next_speaker_num += 1

        return self.speaker_label_map[raw_speaker]

    def reset_session(self) -> None:
        """Reset state when switching videos."""
        self.current_cue_id = 0
        self.active_cue_id = None
        self.cue_start_video_time = None
        self.speaker_label_map.clear()
        self.next_speaker_num = 1

    def _detect_utterance_speaker(self, speech_audio_float32: np.ndarray) -> Optional[str]:
        """Run diarization on the finalized speech utterance if whisperx is ready."""
        if not self.whisperx or not self.whisperx.is_diarization_ready():
            return None

        # Require at least ~1.0s of audio for meaningful speaker identification
        if len(speech_audio_float32) < 16000 * 1.0:
            return None

        try:
            # Run diarization pipeline on the float32 16kHz mono audio
            diarize_segments = self.whisperx.diarize_pipeline(speech_audio_float32)
            if diarize_segments is None:
                return None

            # Calculate dominant speaker across the utterance duration
            speaker_durations: Dict[str, float] = {}
            if hasattr(diarize_segments, "iterrows"):
                for _, row in diarize_segments.iterrows():
                    spk = row.get("speaker")
                    if spk:
                        dur = float(row["end"]) - float(row["start"])
                        speaker_durations[str(spk)] = speaker_durations.get(str(spk), 0.0) + max(0.01, dur)
            elif isinstance(diarize_segments, list):
                for item in diarize_segments:
                    if isinstance(item, dict) and item.get("speaker"):
                        dur = float(item["end"]) - float(item["start"])
                        speaker_durations[str(item["speaker"])] = speaker_durations.get(str(item["speaker"]), 0.0) + max(0.01, dur)
            elif hasattr(diarize_segments, "itertracks"):
                for turn, _, speaker in diarize_segments.itertracks(yield_label=True):
                    dur = float(turn.end) - float(turn.start)
                    speaker_durations[str(speaker)] = speaker_durations.get(str(speaker), 0.0) + max(0.01, dur)

            if speaker_durations:
                top_spk = max(speaker_durations.items(), key=lambda x: x[1])[0]
                return self._get_stable_speaker_label(top_spk)
        except Exception as e:
            print(f"[StreamingProcessor] Utterance diarization warning: {e}")

        return None

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

        # Language handling: detect language if not already detected
        target_lang = preferred_lang
        if target_lang == "auto" or not target_lang:
            if self.whisper and len(speech_audio) >= 16000:
                lid_lang, prob = self.whisper.detect_language(speech_audio[:32000])
                if prob > 0.35:
                    self.detected_lang = lid_lang
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

        # Exclusively transcribe with Whisper (configured with language="hi" for Hindi)
        if not self.whisper or not self.whisper.is_ready():
            return None

        res = self.whisper.transcribe(speech_audio, language=target_lang, is_final=should_finalize)

        if not res.text:
            return None

        # Detect speaker if finalized utterance
        detected_speaker = None
        if should_finalize:
            detected_speaker = self._detect_utterance_speaker(speech_audio)

        cue: Dict[str, Any] = {
            "id": self.active_cue_id,
            "start": start_time,
            "end": end_time,
            "lang": res.language,
            "text": res.text,
            "speaker": detected_speaker,
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
