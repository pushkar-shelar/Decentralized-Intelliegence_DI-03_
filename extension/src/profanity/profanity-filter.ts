/**
 * Client-side Profanity Filter for LiveSub YouTube Subtitle Overlay.
 *
 * Scans subtitle text and replaces detected vulgarities, curses, and offensive slang
 * with exactly '***' before text is rendered on the YouTube video.
 * Supports English, Hinglish, Hindi (Devanagari), Marathi, and South Indian regional slang.
 */

// Comprehensive Latin/English, Hinglish, and Romanized Indic profanities
const LATIN_PROFANITY_LIST: string[] = [
  // English vulgarities
  'fuck', 'fucking', 'fucked', 'fucker', 'fuckers', 'fucks', 'fuckoff', 'motherfucker', 'motherfucking',
  'shit', 'shitty', 'bullshit', 'shite', 'shits',
  'bitch', 'bitches', 'bitching', 'bitchy',
  'ass', 'asshole', 'assholes', 'dumbass', 'jackass', 'badass',
  'bastard', 'bastards',
  'dick', 'dicks', 'dickhead', 'dickheads',
  'pussy', 'pussies',
  'cunt', 'cunts',
  'cock', 'cocks', 'cocksucker',
  'whore', 'whores', 'slut', 'sluts',
  'prick', 'pricks',
  'twat', 'twats',
  'wanker', 'wankers',

  // Hindi & Hinglish vulgarities
  'chutiya', 'chutiye', 'chutya', 'choot', 'chootiya', 'chut',
  'bhosdike', 'bhosadike', 'bhosadi', 'bhosada', 'bhosdi', 'bsdk',
  'madarchod', 'madarchodh', 'mc', 'maadaarchod', 'madarjaat',
  'behenchod', 'bhenchod', 'bc', 'behenchodh', 'bhenchodh',
  'gand', 'gaand', 'gandu', 'gaandu', 'gandfat', 'gaandfat',
  'harami', 'haraami', 'kamine', 'kamina', 'kaminay',
  'saala', 'saale', 'sala', 'sale',
  'lavde', 'laude', 'loda', 'lauda', 'lodu', 'lauda',
  'randi', 'raand', 'randwa', 'randee',
  'tatte', 'tatta', 'mutth', 'mutthal',
  'jhaatu', 'jhatu', 'chinal',

  // Marathi vulgarities
  'zavanya', 'zavli', 'zavadya', 'zhavli', 'zhavanya', 'bhadkav', 'bhadwa', 'bhadve',

  // South Indian (Tamil / Telugu / Malayalam) vulgarities
  'thevidiya', 'thevadiya', 'punda', 'pundai', 'oombu', 'maire', 'mayire',
  'lanja', 'lanjakodaka', 'dengu', 'dengey', 'puku', 'modda', 'poola', 'munda',
];

// Indic Unicode / Native Script profanities (Devanagari, Marathi, etc.)
const INDIC_PROFANITY_LIST: string[] = [
  // Devanagari Hindi / Marathi
  'चूतिया', 'चूतिये', 'चूत', 'चूतियापा',
  'भोसड़ीके', 'भोसड़ीके', 'भोसड़ी', 'भोसड़ी', 'भोसड़ा', 'भोसडा',
  'मादरचोद', 'मादरचोद',
  'बहनचोद', 'बहेनचोद',
  'गांड', 'गांडू', 'गांडफटी',
  'हरामी', 'कमीने', 'कमीना', 'कमीनी',
  'साले', 'साला',
  'लौड़े', 'लौंडे', 'लवडे', 'लौड़ा', 'लोड़ा',
  'रांड', 'रंडी', 'रंडवा',
  'टट्टे', 'टट्टा', 'झाटू', 'मुट्ठल',
  'झव्या', 'झवला', 'भाडखाऊ', 'भाडव्या',
];

/**
 * Escapes regex special characters in a keyword string.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Pre-compiled regex pattern for Latin / Hinglish words with boundary assertion.
 * Matches whole words only so it never breaks words like 'assistant', 'classic', or 'masala'.
 */
const latinPattern = new RegExp(
  `\\b(?:${LATIN_PROFANITY_LIST.map(escapeRegex).join('|')})\\b`,
  'gi',
);

/**
 * Pre-compiled regex pattern for native Indic script words.
 * Uses unicode punctuation / space boundaries so Devanagari words match cleanly.
 */
const indicPattern = new RegExp(
  `(?:^|[\\s।,.;:!?"'()\\[\\]{}\\-])(${INDIC_PROFANITY_LIST.map(escapeRegex).join('|')})(?=$|[\\s।,.;:!?"'()\\[\\]{}\\-])`,
  'gu',
);

/**
 * Censors profane words with '***'.
 *
 * @param text The raw subtitle text string.
 * @returns The filtered text with profanities replaced by '***'.
 */
export function censorText(text: string | null | undefined): string {
  if (!text) return '';

  // 1. Filter Latin / Hinglish profanities
  let censored = text.replace(latinPattern, '***');

  // 2. Filter native Indic (Devanagari) profanities
  censored = censored.replace(indicPattern, (match, word) => {
    return match.replace(word, '***');
  });

  return censored;
}

/**
 * Checks whether the text contains any profane words.
 */
export function hasProfanity(text: string | null | undefined): boolean {
  if (!text) return false;
  latinPattern.lastIndex = 0;
  indicPattern.lastIndex = 0;
  return latinPattern.test(text) || indicPattern.test(text);
}
