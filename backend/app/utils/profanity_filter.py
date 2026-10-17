"""
Profanity filter utility for LiveSub subtitles.
Uses `better-profanity` augmented with Indic / regional vulgarities and slang.
Replaces detected offensive words with exactly '***'.
"""

from typing import List, Optional
import better_profanity.better_profanity as bp
from better_profanity import profanity

# Patch replacement function so swear words are consistently replaced by '***'
bp.get_replacement_for_swear_word = lambda censor_char: "***"

# Extended Indic / Hinglish / Regional curse words
INDIC_PROFANITY_WORDLIST: List[str] = [
    # Hindi / Hinglish
    "chutiya", "chutiye", "chutya", "choot", "chootiya",
    "bhosdike", "bhosadike", "bhosadi", "bhosada", "bhosdi",
    "madarchod", "madarchodh", "mc", "maadaarchod",
    "behenchod", "bhenchod", "bc", "behenchodh",
    "gand", "gaand", "gandu", "gaandu", "gandfat",
    "harami", "haraami", "kamine", "kamina",
    "saala", "saale", "sala", "sale",
    "lavde", "laude", "loda", "lauda", "lodu",
    "randi", "raand", "randwa",
    "tatte", "tatta", "mutth", "mutthal",
    "jhaatu", "jhatu", "chinal",
    # Marathi
    "zavanya", "zavli", "zavadya", "aai zhavli", "bhadkav", "bhadwa",
    # Tamil / Telugu / Malayalam
    "thevidiya", "thevadiya", "punda", "pundai", "oombu", "maire", "mayire",
    "lanja", "lanjakodaka", "dengu", "dengey", "puku", "modda", "poola",
]

# Ensure censor words are loaded and augmented
profanity.load_censor_words()
profanity.add_censor_words(INDIC_PROFANITY_WORDLIST)

def censor_text(text: Optional[str]) -> str:
    """
    Scans the given subtitle text and replaces all vulgar/profane words with '***'.
    Preserves surrounding punctuation and returns empty string if text is None/empty.
    """
    if not text:
        return ""
    try:
        return profanity.censor(text)
    except Exception as e:
        # Fail safe: return original text if parsing fails
        return text

def has_profanity(text: Optional[str]) -> bool:
    """Returns True if the text contains any profane word."""
    if not text:
        return False
    try:
        return profanity.contains_profanity(text)
    except Exception:
        return False
