import pytest
from backend.app.utils.profanity_filter import censor_text, has_profanity

def test_english_profanity_censored():
    raw = "What the fuck is this shit? Get that bitch out."
    censored = censor_text(raw)
    assert "***" in censored
    assert "fuck" not in censored.lower()
    assert "shit" not in censored.lower()
    assert "bitch" not in censored.lower()
    assert censored == "What the *** is this ***? Get that *** out."

def test_indic_profanity_censored():
    raw = "Tu saala harami chutiya hai kya?"
    censored = censor_text(raw)
    assert "***" in censored
    assert "chutiya" not in censored.lower()
    assert "harami" not in censored.lower()
    assert "saala" not in censored.lower()

def test_clean_sentence_unchanged():
    clean = "Today we will prepare a delicious paneer tikka recipe."
    assert censor_text(clean) == clean
    assert has_profanity(clean) is False

def test_has_profanity_detection():
    assert has_profanity("What the fuck") is True
    assert has_profanity("Bhosdike idhar aa") is True
    assert has_profanity("Good morning everyone!") is False

def test_punctuation_preserved():
    raw = "Holy shit! Really? Damn."
    censored = censor_text(raw)
    assert censored == "Holy ***! Really? ***."
