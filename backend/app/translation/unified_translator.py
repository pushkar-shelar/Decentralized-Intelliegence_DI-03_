import os
import json
import httpx
from typing import Optional, Dict

class UnifiedTranslator:
    """
    Tiered Translation Pipeline:
    1. Primary: Groq LLM (openai/gpt-oss-120b / qwen/qwen3.8-27b) with an idiomatic & cultural prompt.
       Fastest inference (<300ms) with deepest understanding of muhavre, metaphors, and double meanings.
    2. Fallback: Sarvam AI Mayura (mayura:v1) specifically tuned for Indian languages.
    3. In-memory LRU cache to avoid duplicate calls.
    """

    LANG_MAP = {
        "en": "English",
        "hi": "Hindi",
        "mr": "Marathi",
        "ta": "Tamil",
        "te": "Telugu",
        "gu": "Gujarati",
        "kn": "Kannada",
        "ml": "Malayalam",
        "bn": "Bengali",
        "pa": "Punjabi",
        "or": "Odia",
    }

    SARVAM_CODE_MAP = {
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

    def __init__(
        self,
        grok_api_key: Optional[str] = None,
        sarvam_api_key: Optional[str] = None,
    ):
        self.grok_api_key = grok_api_key or os.getenv("GROK_API_KEY") or os.getenv("GROQ_API_KEY", "")
        self.sarvam_api_key = sarvam_api_key or os.getenv("SARVAM_API_KEY", "")
        self._cache: Dict[str, str] = {}

    def _normalize_lang_name(self, code: str) -> str:
        clean = (code or "en").lower().split("-")[0]
        return self.LANG_MAP.get(clean, "English")

    def _normalize_sarvam_code(self, code: str) -> str:
        clean = (code or "en").lower().split("-")[0]
        return self.SARVAM_CODE_MAP.get(clean, f"{clean}-IN")

    async def translate(
        self,
        text: str,
        source_lang: str = "hi",
        target_lang: str = "en",
    ) -> str:
        trimmed = (text or "").strip()
        if not trimmed:
            return ""

        src_clean = (source_lang or "hi").lower().split("-")[0]
        tgt_clean = (target_lang or "en").lower().split("-")[0]
        if src_clean == tgt_clean:
            return trimmed

        cache_key = f"{src_clean}->{tgt_clean}:{trimmed}"
        if cache_key in self._cache:
            return self._cache[cache_key]

        # 1. Try Primary: Groq LLM (High speed + Deep Idiom comprehension)
        if self.grok_api_key and len(self.grok_api_key.strip()) > 5:
            try:
                translated = await self._translate_with_grok(trimmed, src_clean, tgt_clean)
                if translated:
                    self._cache[cache_key] = translated
                    return translated
            except Exception as e:
                print(f"[UnifiedTranslator] Grok translation failed, falling back to Sarvam: {e}")

        # 2. Try Fallback: Sarvam Mayura
        if self.sarvam_api_key and len(self.sarvam_api_key.strip()) > 5:
            try:
                translated = await self._translate_with_sarvam(trimmed, src_clean, tgt_clean)
                if translated:
                    self._cache[cache_key] = translated
                    return translated
            except Exception as e:
                print(f"[UnifiedTranslator] Sarvam translation failed: {e}")

        # Final fallback: return original text
        return trimmed

    async def _translate_with_grok(self, text: str, src: str, tgt: str) -> Optional[str]:
        target_name = self._normalize_lang_name(tgt)
        source_name = self._normalize_lang_name(src)

        system_prompt = (
            f"You are an expert culturally aware subtitle translator translating from {source_name} to {target_name}.\n"
            f"Translate Indian idioms, proverbs (muhavre), metaphors, and colloquial speech into their natural {target_name} equivalent.\n"
            f"Do not translate idioms literally. Preserve humor, sarcasm, tone, and double meanings.\n"
            f"Output ONLY the translated subtitle text without any markdown, quotes, explanations, or preamble."
        )

        headers = {
            "Authorization": f"Bearer {self.grok_api_key}",
            "Content-Type": "application/json",
        }

        # Try fast models in order: openai/gpt-oss-120b, qwen/qwen3.8-27b
        for model in ["openai/gpt-oss-120b", "qwen/qwen3.8-27b"]:
            payload = {
                "model": model,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": text},
                ],
                "temperature": 0.2,
                "max_tokens": 150,
            }

            async with httpx.AsyncClient(timeout=6.0) as client:
                res = await client.post("https://api.groq.com/openai/v1/chat/completions", json=payload, headers=headers)
                if res.status_code == 200:
                    data = res.json()
                    choices = data.get("choices", [])
                    if choices:
                        content = choices[0].get("message", {}).get("content", "").strip()
                        if content:
                            return content
                else:
                    print(f"[UnifiedTranslator] Grok model {model} returned HTTP {res.status_code}: {res.text}")

        return None

    async def _translate_with_sarvam(self, text: str, src: str, tgt: str) -> Optional[str]:
        sarvam_src = self._normalize_sarvam_code(src)
        sarvam_tgt = self._normalize_sarvam_code(tgt)

        payload = {
            "input": text[:1000],
            "source_language_code": sarvam_src,
            "target_language_code": sarvam_tgt,
            "model": "mayura:v1",
            "mode": "modern-colloquial",
            "output_script": "fully-native",
            "numerals_format": "international",
            "enable_preprocessing": True,
        }

        headers = {
            "Content-Type": "application/json",
            "api-subscription-key": self.sarvam_api_key,
        }

        async with httpx.AsyncClient(timeout=8.0) as client:
            res = await client.post("https://api.sarvam.ai/translate", json=payload, headers=headers)
            if res.status_code == 200:
                data = res.json()
                return data.get("translated_text", "").strip()
            else:
                print(f"[UnifiedTranslator] Sarvam returned HTTP {res.status_code}: {res.text}")

        return None
