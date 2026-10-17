/**
 * Multi-script word and punctuation tokenization engine for LiveSub.
 * Accurately segments sentences into interactive words and trailing/leading punctuation
 * across English, Hindi, Marathi, Tamil, Telugu, and other languages.
 */

export interface Token {
  /** The clean word suitable for dictionary lookup (stripped of boundary punctuation). */
  word: string;
  /** Normalized lowercase form for deduplication and indexing. */
  normalizedWord: string;
  /** Leading punctuation attached to this token (e.g., ¿, ", «, () */
  leadingPunct: string;
  /** Trailing punctuation attached to this token (e.g., ,, ., !, ?, ", :) */
  trailingPunct: string;
  /** Whitespace following this token to preserve exact layout and flow. */
  trailingSpace: string;
  /** Original raw text fragment. */
  raw: string;
  /** Whether this token contains a clickable word. */
  isWord: boolean;
}

// Matches boundary punctuation marks in Unicode, Latin, and Indic scripts (Danda ।, Double Danda ॥, commas, quotes, etc.)
const LEADING_PUNCT_REGEX = /^[\s\u2000-\u200F\u2028-\u202F\uFEFF."'«“‘¿¡(\[{<]+/;
const TRAILING_PUNCT_REGEX = /[\s\u2000-\u200F\u2028-\u202F\uFEFF"'»”’.,!?;:।॥)\]}>]+$/;

/**
 * Clean a word for lookup: removes leading/trailing punctuation while preserving
 * internal apostrophes (don't) and hyphens (state-of-the-art).
 */
export function cleanWordForLookup(raw: string): string {
  if (!raw) return '';
  return raw
    .replace(LEADING_PUNCT_REGEX, '')
    .replace(TRAILING_PUNCT_REGEX, '')
    .trim();
}

/**
 * Tokenize a subtitle text line into structured tokens.
 * Guarantees that concatenating token.raw reproduces the exact original string character-for-character.
 */
export function tokenizeSubtitleText(text: string): Token[] {
  if (!text || typeof text !== 'string') return [];

  // Match sequences of non-whitespace characters followed by any trailing whitespace
  const rawSegments = text.match(/\S+\s*/g);
  if (!rawSegments) return [];

  const tokens: Token[] = [];

  for (const segment of rawSegments) {
    // Separate trailing whitespace
    const spaceMatch = segment.match(/\s+$/);
    const trailingSpace = spaceMatch ? spaceMatch[0] : '';
    const nonSpace = trailingSpace ? segment.slice(0, -trailingSpace.length) : segment;

    // Separate leading punctuation
    const leadMatch = nonSpace.match(LEADING_PUNCT_REGEX);
    const leadingPunct = leadMatch ? leadMatch[0] : '';
    const withoutLead = leadingPunct ? nonSpace.slice(leadingPunct.length) : nonSpace;

    // Separate trailing punctuation
    const trailMatch = withoutLead.match(TRAILING_PUNCT_REGEX);
    const trailingPunct = trailMatch ? trailMatch[0] : '';
    const word = trailingPunct ? withoutLead.slice(0, -trailingPunct.length) : withoutLead;

    if (word.length > 0) {
      tokens.push({
        word,
        normalizedWord: word.toLowerCase(),
        leadingPunct,
        trailingPunct,
        trailingSpace,
        raw: segment,
        isWord: true,
      });
    } else {
      // Entire segment was punctuation/symbols
      tokens.push({
        word: '',
        normalizedWord: '',
        leadingPunct: nonSpace,
        trailingPunct: '',
        trailingSpace,
        raw: segment,
        isWord: false,
      });
    }
  }

  return tokens;
}
