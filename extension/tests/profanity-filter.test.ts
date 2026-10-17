import { describe, expect, it } from 'vitest';
import { censorText, hasProfanity } from '../src/profanity/profanity-filter';

describe('Profanity Filter for YouTube Subtitle Overlay', () => {
  it('correctly censors common English profanities with ***', () => {
    expect(censorText('What the fuck is going on?')).toBe('What the *** is going on?');
    expect(censorText('This is complete bullshit.')).toBe('This is complete ***.');
    expect(censorText('Stop being such a bitch!')).toBe('Stop being such a ***!');
    expect(censorText('He is an asshole.')).toBe('He is an ***.');
  });

  it('correctly censors Hinglish / Hindi transliterated profanities', () => {
    expect(censorText('Arey chutiya mat ban')).toBe('Arey *** mat ban');
    expect(censorText('Saale bhosdike chup reh')).toBe('*** *** chup reh');
    expect(censorText('Bhenchod kya bol raha hai')).toBe('*** kya bol raha hai');
    expect(censorText('Madarchod bhag yahan se')).toBe('*** bhag yahan se');
    expect(censorText('Bada harami nikla')).toBe('Bada *** nikla');
    expect(censorText('Gandu mat ban')).toBe('*** mat ban');
  });

  it('correctly censors Devanagari Hindi profanities', () => {
    expect(censorText('अरे चूतिया मत बन')).toBe('अरे *** मत बन');
    expect(censorText('साले भोसड़ीके यहाँ से भाग')).toBe('*** *** यहाँ से भाग');
    expect(censorText('मादरचोद क्या हुआ')).toBe('*** क्या हुआ');
    expect(censorText('गांडू इंसान')).toBe('*** इंसान');
    expect(censorText('तू तो हरामी है')).toBe('तू तो *** है');
  });

  it('does NOT censor normal words that contain profanity substrings', () => {
    // 'ass' inside 'assistant', 'classic', 'pass', 'grass'
    expect(censorText('The virtual assistant is helpful.')).toBe('The virtual assistant is helpful.');
    expect(censorText('This is a classic movie.')).toBe('This is a classic movie.');
    expect(censorText('Please pass the salt.')).toBe('Please pass the salt.');

    // 'sala' inside 'masala'
    expect(censorText('Add garam masala to the dish.')).toBe('Add garam masala to the dish.');
  });

  it('handles null, undefined, or empty string gracefully', () => {
    expect(censorText('')).toBe('');
    expect(censorText(null)).toBe('');
    expect(censorText(undefined)).toBe('');
  });

  it('detects profanity accurately using hasProfanity', () => {
    expect(hasProfanity('Hello my dear friend')).toBe(false);
    expect(hasProfanity('What the fuck')).toBe(true);
    expect(hasProfanity('अरे भोसड़ीके')).toBe(true);
    expect(hasProfanity('Garam masala')).toBe(false);
  });
});
