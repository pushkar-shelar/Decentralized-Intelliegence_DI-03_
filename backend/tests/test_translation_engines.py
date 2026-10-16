import os
import pytest
from dotenv import load_dotenv

# Load keys from .env
load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), ".env"))

from backend.app.translation.unified_translator import UnifiedTranslator

@pytest.fixture
def translator():
    return UnifiedTranslator()

@pytest.mark.asyncio
async def test_grok_translation_hindi_to_english(translator):
    """Verify Grok translates Hindi phrase into natural English preserving idioms."""
    text = "दाल में कुछ काला है"
    translated = await translator._translate_with_grok(text, "hi", "en")
    assert translated is not None, "Grok returned None"
    assert len(translated.strip()) > 0, "Grok returned empty translation"
    # Verify semantic match rather than literal (e.g. fishy / suspicious / wrong)
    lower = translated.lower()
    assert any(w in lower for w in ["fishy", "something", "wrong", "suspicious", "black"]), (
        f"Unexpected translation: {translated}"
    )
    print(f"\n[Grok Test] Hindi -> English: '{text}' => '{translated}'")

@pytest.mark.asyncio
async def test_grok_translation_english_to_hindi(translator):
    """Verify Grok translates English sentence into natural Hindi."""
    text = "Today we will prepare paneer tikka."
    translated = await translator._translate_with_grok(text, "en", "hi")
    assert translated is not None, "Grok returned None"
    assert len(translated.strip()) > 0, "Grok returned empty translation"
    print(f"\n[Grok Test] English -> Hindi: '{text}' => '{translated}'")

@pytest.mark.asyncio
async def test_sarvam_translation_hindi_to_english(translator):
    """Verify Sarvam Mayura translates Hindi to English."""
    text = "आज मौसम बहुत अच्छा है"
    translated = await translator._translate_with_sarvam(text, "hi", "en")
    assert translated is not None, "Sarvam returned None"
    assert len(translated.strip()) > 0, "Sarvam returned empty translation"
    lower = translated.lower()
    assert any(w in lower for w in ["weather", "good", "today", "nice", "pleasant"]), (
        f"Unexpected Sarvam translation: {translated}"
    )
    print(f"\n[Sarvam Test] Hindi -> English: '{text}' => '{translated}'")

@pytest.mark.asyncio
async def test_sarvam_translation_english_to_hindi(translator):
    """Verify Sarvam Mayura translates English to Hindi."""
    text = "Where are you going?"
    translated = await translator._translate_with_sarvam(text, "en", "hi")
    assert translated is not None, "Sarvam returned None"
    assert len(translated.strip()) > 0, "Sarvam returned empty translation"
    print(f"\n[Sarvam Test] English -> Hindi: '{text}' => '{translated}'")

@pytest.mark.asyncio
async def test_unified_failover_mechanism(translator):
    """Verify that when Grok is invalid/unavailable, UnifiedTranslator falls back to Sarvam."""
    # Create instance with intentionally invalid Grok key and valid Sarvam key
    failover_translator = UnifiedTranslator(
        grok_api_key="invalid_dummy_key",
        sarvam_api_key=translator.sarvam_api_key,
    )
    text = "आप कैसे हैं?"
    result = await failover_translator.translate(text, "hi", "en")
    assert result is not None and len(result) > 0
    assert result != text, "Failover translation failed to translate"
    print(f"\n[Failover Test] Fallback to Sarvam output: '{text}' => '{result}'")
