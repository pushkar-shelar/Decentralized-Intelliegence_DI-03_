import numpy as np
import pytest
from backend.app.audio.vad import SileroVAD, UtteranceBuffer

def test_silero_vad_silence_detection():
    vad = SileroVAD()
    # 3200 samples of pure silence (zeros)
    silent_chunk = np.zeros(3200, dtype=np.float32)
    assert vad.is_speech(silent_chunk) is False
    assert vad.speech_probability(silent_chunk) < 0.2

def test_silero_vad_speech_detection():
    vad = SileroVAD()
    # 3200 samples of synthetic speech-range signal with high energy
    t = np.linspace(0, 0.2, 3200, endpoint=False)
    synthetic_speech = (0.5 * np.sin(2 * np.pi * 300 * t) + 0.3 * np.sin(2 * np.pi * 800 * t)).astype(np.float32)
    
    # Energy fallback or neural VAD should register active signal
    prob = vad.speech_probability(synthetic_speech)
    assert prob > 0.0

def test_utterance_buffer_lifecycle():
    vad = SileroVAD()
    buf = UtteranceBuffer(vad, silence_timeout_sec=0.2, min_speech_duration_sec=0.2)

    # 1. Feed silence -> nothing emitted
    silent_chunk = np.zeros(3200, dtype=np.float32)
    partial, final, audio = buf.feed(silent_chunk, perf_now=1000.0)
    assert partial is False
    assert final is False
    assert audio is None
