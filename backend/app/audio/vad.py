import time
from typing import List, Optional, Tuple
import numpy as np
import torch

class SileroVAD:
    """
    Neural Voice Activity Detector using Silero VAD.
    Detects speech vs silence/background music on 16kHz mono audio.
    """

    def __init__(self, device: str = "cpu", threshold: float = 0.5):
        self.device = torch.device(device)
        self.threshold = threshold
        self.model = None
        self._load_model()

    def _load_model(self):
        try:
            model, _ = torch.hub.load(
                repo_or_dir="snakers4/silero-vad",
                model="silero_vad",
                force_reload=False,
                trust_repo=True,
            )
            self.model = model.to(self.device).eval()
        except Exception as e:
            print(f"[LiveSub VAD] Warning: Could not load torch.hub Silero VAD ({e}), falling back to energy VAD")
            self.model = None

    def speech_probability(self, audio_16k: np.ndarray) -> float:
        """
        Evaluate speech probability of a 16kHz audio array.
        Audio should be normalized float32 in [-1.0, 1.0].
        """
        if len(audio_16k) == 0:
            return 0.0

        if self.model is not None:
            try:
                # Silero expects chunks of 512 samples (32ms)
                tensor = torch.from_numpy(audio_16k).float().to(self.device)
                if tensor.ndim == 1:
                    tensor = tensor.unsqueeze(0)
                
                # If chunk is longer, evaluate over 512-sample windows and take mean
                num_windows = tensor.shape[1] // 512
                if num_windows == 0:
                    return 0.0

                probs = []
                for w in range(num_windows):
                    sub = tensor[:, w * 512 : (w + 1) * 512]
                    with torch.no_grad():
                        prob = float(self.model(sub, 16000).item())
                    probs.append(prob)

                return float(np.mean(probs)) if probs else 0.0
            except Exception:
                pass

        # Fallback energy-based VAD
        rms = float(np.sqrt(np.mean(audio_16k ** 2)))
        return 1.0 if rms > 0.015 else 0.0

    def is_speech(self, audio_16k: np.ndarray) -> bool:
        return self.speech_probability(audio_16k) >= self.threshold


class UtteranceBuffer:
    """
    Accumulates streaming audio chunks into cohesive speech utterances.
    Fires partial decoding triggers and finalization boundaries upon speech pauses.
    """

    def __init__(
        self,
        vad: SileroVAD,
        silence_timeout_sec: float = 0.5,
        min_speech_duration_sec: float = 0.6,
        max_utterance_sec: float = 8.0,
    ):
        self.vad = vad
        self.silence_timeout_sec = silence_timeout_sec
        self.min_speech_duration_sec = min_speech_duration_sec
        self.max_utterance_sec = max_utterance_sec

        self.chunks: List[np.ndarray] = []
        self.total_samples: int = 0
        self.is_speaking: bool = False
        self.silence_start_time: Optional[float] = None
        self.utterance_start_perf: Optional[float] = None
        self.last_partial_samples: int = 0

    def feed(
        self,
        chunk_pcm: np.ndarray,
        perf_now: float,
    ) -> Tuple[bool, bool, Optional[np.ndarray]]:
        """
        Feed an incoming 16kHz float32 audio chunk (~200ms).
        Returns: (should_emit_partial, should_finalize, accumulated_audio)
        """
        has_speech = self.vad.is_speech(chunk_pcm)
        chunk_len = len(chunk_pcm)
        now = time.time()

        if has_speech:
            if not self.is_speaking:
                self.is_speaking = True
                self.utterance_start_perf = perf_now
                self.chunks = []
                self.total_samples = 0
                self.last_partial_samples = 0

            self.chunks.append(chunk_pcm)
            self.total_samples += chunk_len
            self.silence_start_time = None

            # Check if max utterance duration reached
            duration_sec = self.total_samples / 16000.0
            if duration_sec >= self.max_utterance_sec:
                combined = np.concatenate(self.chunks)
                self.reset()
                return False, True, combined

            # Trigger partial hypothesis every ~0.8s of new speech (12800 samples)
            if (self.total_samples - self.last_partial_samples) >= 12800:
                self.last_partial_samples = self.total_samples
                return True, False, np.concatenate(self.chunks)

            return False, False, None

        else:
            # Silence chunk
            if self.is_speaking:
                if self.silence_start_time is None:
                    self.silence_start_time = now

                # Add small silence padding
                self.chunks.append(chunk_pcm)
                self.total_samples += chunk_len

                # If silence exceeds timeout, finalize utterance
                if (now - self.silence_start_time) >= self.silence_timeout_sec:
                    duration_sec = self.total_samples / 16000.0
                    if duration_sec >= self.min_speech_duration_sec:
                        combined = np.concatenate(self.chunks)
                        self.reset()
                        return False, True, combined
                    else:
                        # Too short (noise click), discard
                        self.reset()
                        return False, False, None

            return False, False, None

    def reset(self):
        self.is_speaking = False
        self.chunks = []
        self.total_samples = 0
        self.silence_start_time = None
        self.utterance_start_perf = None
        self.last_partial_samples = 0
