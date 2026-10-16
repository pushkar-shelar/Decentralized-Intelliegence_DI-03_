import os
os.environ["USE_TF"] = "0"
os.environ["TRANSFORMERS_NO_TF"] = "1"
os.environ["HF_HUB_DISABLE_SYMLINKS_WARNING"] = "1"

from typing import Optional
import numpy as np
import torch
from transformers import AutoModel, AutoTokenizer
from backend.app.models.asr_interface import BaseASREngine, ASRResult

DEFAULT_MODEL_DIR = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "..", "models", "shrutam-2")
)

LANGUAGE_PROMPTS = {
    "hi": "Transcribe speech to Hindi text.",
    "mr": "Transcribe speech to Marathi text.",
    "ta": "Transcribe speech to Tamil text.",
    "te": "Transcribe speech to Telugu text.",
    "bn": "Transcribe speech to Bengali text.",
    "gu": "Transcribe speech to Gujarati text.",
    "pa": "Transcribe speech to Punjabi text.",
    "kn": "Transcribe speech to Kannada text.",
    "ml": "Transcribe speech to Malayalam text.",
    "ur": "Transcribe speech to Urdu text.",
    "or": "Transcribe speech to Odia text.",
    "as": "Transcribe speech to Assamese text.",
}

DEFAULT_PROMPT = "Transcribe speech to Hindi and English text."

class ShrutamEngine(BaseASREngine):
    """
    ASR Engine using BharatGen Shrutam-2.
    Specialized for Indian languages and code-mixed speech (Hinglish).
    """

    def __init__(self, model_dir: str = DEFAULT_MODEL_DIR, device: Optional[str] = None):
        self.model_dir = model_dir
        self.device = device or ("cuda:0" if torch.cuda.is_available() else "cpu")
        self.model = None
        self.tokenizer = None
        self._load()

    def _load(self):
        if not os.path.exists(self.model_dir):
            print(f"[ShrutamEngine] Model directory not found: {self.model_dir}")
            return

        print(f"[ShrutamEngine] Loading Shrutam-2 onto {self.device}...")
        dtype = torch.bfloat16 if torch.cuda.is_available() and torch.cuda.is_bf16_supported() else torch.float16

        try:
            self.tokenizer = AutoTokenizer.from_pretrained(self.model_dir, trust_remote_code=True)
            self.model = AutoModel.from_pretrained(
                self.model_dir,
                trust_remote_code=True,
                torch_dtype=dtype,
            ).to(self.device).eval()
            print(f"[ShrutamEngine] Shrutam-2 successfully resident in VRAM on {self.device}")
        except Exception as e:
            print(f"[ShrutamEngine] Error loading Shrutam-2: {e}")
            self.model = None
            self.tokenizer = None

    def is_ready(self) -> bool:
        return self.model is not None and self.tokenizer is not None

    def transcribe(
        self,
        audio_16k_mono: np.ndarray,
        language: Optional[str] = None,
        is_final: bool = True,
    ) -> ASRResult:
        if not self.is_ready():
            return ASRResult(text="", language=language or "hi", is_final=is_final)

        lang_code = (language or "hi").lower()
        prompt = LANGUAGE_PROMPTS.get(lang_code, DEFAULT_PROMPT)

        try:
            # Shrutam expects float32 waveform tensor [T]
            preds = self.model.transcribe(
                [audio_16k_mono],
                prompts=[prompt],
                tokenizer=self.tokenizer,
                sampling_rate=16000,
            )
            raw_text = preds[0] if preds and len(preds) > 0 else ""
            cleaned = raw_text.strip()
            return ASRResult(text=cleaned, language=lang_code, is_final=is_final)
        except Exception as e:
            print(f"[ShrutamEngine] Inference error: {e}")
            return ASRResult(text="", language=lang_code, is_final=is_final)
