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

    async def normalize_and_translate(
        self,
        text: str,
        source_lang: str = "hi",
        target_lang: str = "en",
    ) -> Dict[str, str]:
        """
        Takes raw ASR transcription (which may contain acoustic noise, phonetic misspellings,
        or literal transliterations like 'Can Barna' or 'भागध्याना'),
        corrects the intended native spoken words, and translates idiomatically.
        Returns: {"corrected_text": str, "translation": str}
        """
        trimmed = (text or "").strip()
        if not trimmed:
            return {"corrected_text": "", "translation": ""}

        src_clean = (source_lang or "hi").lower().split("-")[0]
        tgt_clean = (target_lang or "en").lower().split("-")[0]

        cache_key = f"{src_clean}->{tgt_clean}:{trimmed}"
        if cache_key in self._cache:
            cached = self._cache[cache_key]
            if isinstance(cached, dict):
                return cached
            return {"corrected_text": trimmed, "translation": str(cached)}

        # 1. Try Primary: Grok LLM with Noise & Misspelling Correction + Idiom Normalization
        if self.grok_api_key and len(self.grok_api_key.strip()) > 5:
            try:
                res = await self._normalize_and_translate_with_grok(trimmed, src_clean, tgt_clean)
                if res and res.get("translation"):
                    self._cache[cache_key] = res
                    return res
            except Exception as e:
                print(f"[UnifiedTranslator] Grok normalization failed, falling back: {e}")

        # 2. Try Fallback: Sarvam Mayura
        if self.sarvam_api_key and len(self.sarvam_api_key.strip()) > 5:
            try:
                trans = await self._translate_with_sarvam(trimmed, src_clean, tgt_clean)
                if trans:
                    result = {"corrected_text": trimmed, "translation": trans}
                    self._cache[cache_key] = result
                    return result
            except Exception as e:
                print(f"[UnifiedTranslator] Sarvam translation failed: {e}")

        # Fallback: return original text
        return {"corrected_text": trimmed, "translation": trimmed}

    async def translate(
        self,
        text: str,
        source_lang: str = "hi",
        target_lang: str = "en",
    ) -> str:
        res = await self.normalize_and_translate(text, source_lang, target_lang)
        return res.get("translation", text)

    async def _translate_with_grok(self, text: str, src: str, tgt: str) -> Optional[str]:
        res = await self._normalize_and_translate_with_grok(text, src, tgt)
        return res.get("translation") if res else None

    async def _normalize_and_translate_with_grok(self, text: str, src: str, tgt: str) -> Optional[Dict[str, str]]:
        target_name = self._normalize_lang_name(tgt)
        source_name = self._normalize_lang_name(src)

        system_prompt = (
            f"You are an expert culturally aware subtitle engine translating from {source_name} to {target_name}.\n"
            f"The input is raw acoustic Speech-To-Text (ASR) transcription from Whisper which often contains acoustic noise, phonetic misspellings, or literal acoustic corruptions (e.g. 'भागध्याना' or 'Bhangdhyana' for 'भाग जाना', 'Can Barna' or 'feed the canal' for 'कान भरना' / gossip, 'पीट दिखाना' for 'पीठ दिखाना', 'आकाश छूना' as 'ah gosh', 'यूट्यूग' for 'यूट्यूब').\n\n"
            f"Your task:\n"
            f"1. FIRST: Correct and recover the intended spoken words and idioms in their proper native script ({source_name}).\n"
            f"2. SECOND: Translate the true idiomatic meaning into natural, colloquial {target_name} without literal translation errors.\n\n"
            f"Respond ONLY with a JSON object in this exact format:\n"
            f"{{\n"
            f'  "corrected_text": "<proper corrected native script>",\n'
            f'  "translation": "<natural idiomatic {target_name} translation>"\n'
            f"}}"
        )

        headers = {
            "Authorization": f"Bearer {self.grok_api_key}",
            "Content-Type": "application/json",
        }

        # Try fast models in order: qwen/qwen3.8-27b, openai/gpt-oss-120b
        for model in ["qwen/qwen3.8-27b", "openai/gpt-oss-120b"]:
            payload = {
                "model": model,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": text},
                ],
                "temperature": 0.1,
                "max_tokens": 180,
                "response_format": {"type": "json_object"},
            }

            async with httpx.AsyncClient(timeout=6.0) as client:
                res = await client.post("https://api.groq.com/openai/v1/chat/completions", json=payload, headers=headers)
                if res.status_code == 200:
                    data = res.json()
                    choices = data.get("choices", [])
                    if choices:
                        raw_content = choices[0].get("message", {}).get("content", "").strip()
                        try:
                            parsed = json.loads(raw_content)
                            if "translation" in parsed:
                                return {
                                    "corrected_text": parsed.get("corrected_text", text).strip(),
                                    "translation": parsed.get("translation", "").strip(),
                                }
                        except Exception:
                            return {"corrected_text": text, "translation": raw_content}
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
