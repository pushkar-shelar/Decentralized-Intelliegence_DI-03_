import os
import unittest
from unittest.mock import MagicMock, patch
import numpy as np
import pytest

from backend.app.models.whisperx_engine import WhisperXEngine
from backend.app.services.streaming_processor import StreamingSpeechProcessor


class TestWhisperXDiarization(unittest.TestCase):

    def setUp(self):
        # Create a mock engine without loading real models onto GPU/RAM
        self.engine = WhisperXEngine(load_asr_on_init=False, load_diarize_on_init=False)
        self.engine.model = MagicMock()
        self.engine.diarize_pipeline = MagicMock()

    def test_1_multiple_speakers_labeled(self):
        """WhisperX correctly labels multiple alternating speakers."""
        audio = np.ones(16000 * 4, dtype=np.float32)

        # Mock ASR transcribe output
        self.engine.model.transcribe.return_value = {
            "language": "hi",
            "segments": [
                {"start": 0.0, "end": 1.8, "text": "अरे ओ, बंसी!"},
                {"start": 2.0, "end": 3.8, "text": "हाँ, तो मैं क्या करूँ?"},
            ]
        }

        # Mock diarization returning two distinct speakers
        diarize_data = [
            {"start": 0.0, "end": 1.9, "speaker": "SPEAKER_00"},
            {"start": 2.0, "end": 3.9, "speaker": "SPEAKER_01"},
        ]
        self.engine.diarize_pipeline.return_value = diarize_data

        # Alignment fails / is skipped, triggering timestamp-overlap fallback
        with patch.object(self.engine, "_get_align_model", return_value=(None, None)):
            output = self.engine.process_audio(audio, language="hi", enable_diarization=True)

        self.assertEqual(len(output), 2)
        self.assertEqual(output[0]["speaker"], "SPEAKER_00")
        self.assertEqual(output[0]["text"], "अरे ओ, बंसी!")
        self.assertEqual(output[1]["speaker"], "SPEAKER_01")
        self.assertEqual(output[1]["text"], "हाँ, तो मैं क्या करूँ?")

    def test_2_single_speaker_consistency(self):
        """A single speaker speaking across multiple segments maintains consistent speaker ID."""
        audio = np.ones(16000 * 3, dtype=np.float32)

        self.engine.model.transcribe.return_value = {
            "language": "en",
            "segments": [
                {"start": 0.0, "end": 1.2, "text": "First sentence."},
                {"start": 1.3, "end": 2.8, "text": "Second sentence."},
            ]
        }

        self.engine.diarize_pipeline.return_value = [
            {"start": 0.0, "end": 3.0, "speaker": "SPEAKER_00"},
        ]

        with patch.object(self.engine, "_get_align_model", return_value=(None, None)):
            output = self.engine.process_audio(audio, language="en", enable_diarization=True)

        self.assertEqual(len(output), 2)
        self.assertEqual(output[0]["speaker"], "SPEAKER_00")
        self.assertEqual(output[1]["speaker"], "SPEAKER_00")

    def test_3_missing_hf_token_disables_diarization_safely(self):
        """Missing HF_TOKEN gracefully disables diarization without crashing transcription."""
        engine_no_token = WhisperXEngine(load_asr_on_init=False, load_diarize_on_init=False, hf_token="")
        engine_no_token.model = MagicMock()
        engine_no_token.model.transcribe.return_value = {
            "language": "hi",
            "segments": [{"start": 0.0, "end": 1.0, "text": "परीक्षण"}]
        }

        self.assertFalse(engine_no_token.is_diarization_ready())
        output = engine_no_token.process_audio(np.ones(16000, dtype=np.float32))
        self.assertEqual(len(output), 1)
        self.assertIsNone(output[0]["speaker"])
        self.assertEqual(output[0]["text"], "परीक्षण")

    def test_4_missing_dependencies_trigger_expected_fallback(self):
        """When whisperx import fails, engine marks is_ready as False and returns empty."""
        unloaded_engine = WhisperXEngine(load_asr_on_init=False, load_diarize_on_init=False)
        self.assertFalse(unloaded_engine.is_ready())
        self.assertFalse(unloaded_engine.is_asr_ready())
        self.assertFalse(unloaded_engine.is_diarization_ready())
        output = unloaded_engine.process_audio(np.ones(16000, dtype=np.float32))
        self.assertEqual(output, [])

    def test_5_alignment_failure_permits_safe_overlap_assignment(self):
        """When forced phoneme alignment fails (e.g. unsupported Indian language), timestamp overlap still assigns speaker."""
        audio = np.ones(16000 * 2, dtype=np.float32)

        self.engine.model.transcribe.return_value = {
            "language": "mr",
            "segments": [{"start": 0.2, "end": 1.8, "text": "नमस्कार मित्रांनो"}]
        }
        self.engine.diarize_pipeline.return_value = [
            {"start": 0.0, "end": 2.0, "speaker": "SPEAKER_00"}
        ]

        with patch.object(self.engine, "_get_align_model", side_effect=RuntimeError("No alignment model for Marathi")):
            output = self.engine.process_audio(audio, language="mr")

        self.assertEqual(len(output), 1)
        self.assertEqual(output[0]["speaker"], "SPEAKER_00")

    def test_6_derive_segment_speaker_from_words(self):
        """When segment has no segment-level speaker, it is derived from majority word speaker duration."""
        segment = {
            "start": 0.0,
            "end": 2.0,
            "text": "one two three",
            "words": [
                {"word": "one", "start": 0.0, "end": 0.4, "speaker": "SPEAKER_00"},
                {"word": "two", "start": 0.5, "end": 1.2, "speaker": "SPEAKER_01"},
                {"word": "three", "start": 1.3, "end": 2.0, "speaker": "SPEAKER_01"},
            ]
        }
        # SPEAKER_01 has 0.7s + 0.7s = 1.4s out of 1.8s spoken duration (>50%)
        derived = self.engine._derive_segment_speaker_from_words(segment)
        self.assertEqual(derived, "SPEAKER_01")

    def test_7_ambiguous_speaker_assignment_returns_null(self):
        """When speech overlap with diarization is ambiguous or non-existent, speaker is null."""
        segments = [{"start": 10.0, "end": 12.0, "text": "Late speech"}]
        # Diarization only detected speech from 0s to 2s
        diarize_segments = [{"start": 0.0, "end": 2.0, "speaker": "SPEAKER_00"}]

        result = self.engine._assign_speakers_by_overlap(segments, diarize_segments)
        self.assertIsNone(result[0].get("speaker"))

    def test_8_empty_audio_and_silence_handled_safely(self):
        """Empty numpy array or pure silence returns [] without throwing."""
        self.assertEqual(self.engine.process_audio(np.array([], dtype=np.float32)), [])
        self.assertEqual(self.engine.process_audio(np.zeros(16000, dtype=np.float32)), [])

    def test_9_chunk_timestamps_and_offsets(self):
        """Video start offsets are correctly preserved in generated output."""
        self.engine.model.transcribe.return_value = {
            "language": "hi",
            "segments": [{"start": 1.25, "end": 3.75, "text": "परीक्षण वाक्य"}]
        }
        output = self.engine.process_audio(np.ones(16000 * 4, dtype=np.float32), enable_diarization=False)
        self.assertEqual(output[0]["start"], 1.25)
        self.assertEqual(output[0]["end"], 3.75)

    def test_10_diarization_exception_does_not_break_transcription(self):
        """If diarization pipeline raises an exception, transcription text is still safely returned."""
        audio = np.ones(16000 * 2, dtype=np.float32)
        self.engine.model.transcribe.return_value = {
            "language": "en",
            "segments": [{"start": 0.0, "end": 1.5, "text": "Resilient output"}]
        }
        self.engine.diarize_pipeline.side_effect = RuntimeError("GPU out of memory in Pyannote")

        with patch.object(self.engine, "_get_align_model", return_value=(None, None)):
            output = self.engine.process_audio(audio)

        self.assertEqual(len(output), 1)
        self.assertEqual(output[0]["text"], "Resilient output")
        self.assertIsNone(output[0]["speaker"])

    def test_11_streaming_processor_maps_human_friendly_stable_speakers(self):
        """StreamingSpeechProcessor maps raw cluster labels into stable session labels (Speaker 1, Speaker 2)."""
        processor = StreamingSpeechProcessor()
        self.assertEqual(processor._get_stable_speaker_label("SPEAKER_00"), "Speaker 1")
        self.assertEqual(processor._get_stable_speaker_label("SPEAKER_01"), "Speaker 2")
        # Idempotent within session
        self.assertEqual(processor._get_stable_speaker_label("SPEAKER_00"), "Speaker 1")
        self.assertEqual(processor._get_stable_speaker_label("SPEAKER_01"), "Speaker 2")

        # Session reset clears mapping for next video
        processor.reset_session()
        self.assertEqual(processor._get_stable_speaker_label("SPEAKER_01"), "Speaker 1")


if __name__ == "__main__":
    unittest.main()
