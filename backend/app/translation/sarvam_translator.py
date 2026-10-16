import os
import httpx
from typing import Optional, Dict

class SarvamTranslator:
    """
    Translator client using Sarvam AI's Mayura model (mayura:v1).
    Engineered for colloquial Indian language translation, slang, code-mixed text,
    and cultural idioms (muhavre) with mode='modern-colloquial'.
    """

    LANG_MAP = {
        "en": "en-IN",
        "hi": "hi-IN",
        "mr": "mr-IN",
        "ta": "ta-IN",
        "te": "te-IN",
        "gu": "gu-IN",
        "kn": "kn-IN",
        "ml": "ml-IN",
        "bn": "bn-IN",
        "pa": "pa-IN",
        "or": "od-IN",
    }

    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or os.getenv("SARVAM_API_KEY", "")
        self.endpoint = "https://api.sarvam.ai/translate"
        self._cache: Dict[str, str] = {}

    def is_configured(self) -> bool:
        return bool(self.api_key and len(self.api_key.strip()) > 5)

    def normalize_lang(self, code: str) -> str:
        clean = (code or "en").lower().split("-")[0]
        return self.LANG_MAP.get(clean, f"{clean}-IN")

    async def translate(
        self,
        text: str,
        source_lang: str = "hi",
        target_lang: str = "en",
        mode: str = "modern-colloquial",
    ) -> str:
        """
        Translates text using Sarvam Mayura preserving idioms/muhavre.
        """
        trimmed = (text or "").strip()
        if not trimmed:
            return ""

        src = self.normalize_lang(source_lang)
        tgt = self.normalize_lang(target_lang)

        if src == tgt:
            return trimmed

        cache_key = f"{src}->{tgt}:{trimmed}"
        if cache_key in self._cache:
            return self._cache[cache_key]

        if not self.is_configured():
            # If no API key configured, pass through or return as-is
            return trimmed

        payload = {
            "input": trimmed[:1000], # Sarvam Mayura max input
            "source_language_code": src,
            "target_language_code": tgt,
            "model": "mayura:v1",
            "mode": mode,
            "output_script": "fully-native",
            "numerals_format": "international",
            "enable_preprocessing": True,
        }

        headers = {
            "Content-Type": "application/json",
            "api-subscription-key": self.api_key,
        }

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                res = await client.post(self.endpoint, json=payload, headers=headers)
                if res.status_code == 200:
                    data = res.json()
                    translated = data.get("translated_text", "").strip()
                    if translated:
                        self._cache[cache_key] = translated
                        return translated
                else:
                    print(f"[SarvamTranslator] HTTP {res.status_code}: {res.text}")
        except Exception as e:
            print(f"[SarvamTranslator] Request error: {e}")

        return trimmed
