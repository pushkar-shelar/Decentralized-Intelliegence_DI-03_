from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Optional, List
import numpy as np

@dataclass
class TranscriptionSegment:
    start: float
    end: float
    text: str

@dataclass
class ASRResult:
    text: str
    language: str
    is_final: bool
    segments: List[TranscriptionSegment] = field(default_factory=list)

class BaseASREngine(ABC):
    """
    Common abstraction for all Speech-to-Text inference engines
    (Shrutam-2, Whisper Turbo, IndicConformer).
    """

    @abstractmethod
    def transcribe(
        self,
        audio_16k_mono: np.ndarray,
        language: Optional[str] = None,
        is_final: bool = True,
    ) -> ASRResult:
        """
        Transcribe a 16kHz single-channel audio numpy array into text.
        `audio_16k_mono` is normalized float32 in range [-1.0, 1.0].
        """
        pass

    @abstractmethod
    def is_ready(self) -> bool:
        """Returns True if model weights are loaded and resident in VRAM."""
        pass
