import { describe, it, expect } from 'vitest';
import { tokenizeSubtitleText, cleanWordForLookup } from '../src/learning/word-tokenizer';

describe('word-tokenizer', () => {
  it('tokenizes English sentences with punctuation while preserving words', () => {
    const text = 'Hello, world! This is LiveSub.';
    const tokens = tokenizeSubtitleText(text);

    expect(tokens.length).toBe(5);
    expect(tokens[0]!.word).toBe('Hello');
    expect(tokens[0]!.trailingPunct).toBe(',');
    expect(tokens[0]!.trailingSpace).toBe(' ');

    expect(tokens[1]!.word).toBe('world');
    expect(tokens[1]!.trailingPunct).toBe('!');

    expect(tokens[4]!.word).toBe('LiveSub');
    expect(tokens[4]!.trailingPunct).toBe('.');
  });

  it('preserves contractions and hyphenated words', () => {
    const text = "Don't break state-of-the-art solutions.";
    const tokens = tokenizeSubtitleText(text);

    expect(tokens[0]!.word).toBe("Don't");
    expect(tokens[1]!.word).toBe('break');
    expect(tokens[2]!.word).toBe('state-of-the-art');
  });

  it('accurately tokenizes Hindi and Devanagari script with Danda punctuation', () => {
    const text = 'नमस्ते दोस्तों! LiveSub में आपका स्वागत है।';
    const tokens = tokenizeSubtitleText(text);

    expect(tokens[0]!.word).toBe('नमस्ते');
    expect(tokens[1]!.word).toBe('दोस्तों');
    expect(tokens[1]!.trailingPunct).toBe('!');
    expect(tokens[2]!.word).toBe('LiveSub');
    expect(tokens[6]!.word).toBe('है');
    expect(tokens[6]!.trailingPunct).toBe('।');
  });

  it('accurately tokenizes Tamil and Telugu scripts', () => {
    const tamilText = 'வணக்கம், உலகம்!';
    const tamilTokens = tokenizeSubtitleText(tamilText);
    expect(tamilTokens[0]!.word).toBe('வணக்கம்');
    expect(tamilTokens[0]!.trailingPunct).toBe(',');
    expect(tamilTokens[1]!.word).toBe('உலகம்');
    expect(tamilTokens[1]!.trailingPunct).toBe('!');

    const teluguText = 'నమస్కారం, ప్రపంచం!';
    const teluguTokens = tokenizeSubtitleText(teluguText);
    expect(teluguTokens[0]!.word).toBe('నమస్కారం');
    expect(teluguTokens[0]!.trailingPunct).toBe(',');
    expect(teluguTokens[1]!.word).toBe('ప్రపంచం');
  });

  it('preserves leading quotes and brackets', () => {
    const text = 'He said, "(Hello) [world]"';
    const tokens = tokenizeSubtitleText(text);

    expect(tokens[2]!.leadingPunct).toBe('"(');
    expect(tokens[2]!.word).toBe('Hello');
    expect(tokens[2]!.trailingPunct).toBe(')');

    expect(tokens[3]!.leadingPunct).toBe('[');
    expect(tokens[3]!.word).toBe('world');
    expect(tokens[3]!.trailingPunct).toBe(']"');
  });

  it('cleanWordForLookup strips boundary punctuation cleanly', () => {
    expect(cleanWordForLookup('...beautiful!?,')).toBe('beautiful');
    expect(cleanWordForLookup('«नमस्ते»')).toBe('नमस्ते');
    expect(cleanWordForLookup('"don\'t"')).toBe("don't");
    expect(cleanWordForLookup('')).toBe('');
  });

  it('reconstructs the exact raw string when concatenating token.raw', () => {
    const text = '  LiveSub: subtitle learning mode (v1.0)!   ';
    const tokens = tokenizeSubtitleText(text);
    const reconstructed = tokens.map((t) => t.raw).join('');
    expect(reconstructed.trim()).toBe(text.trim());
  });
});
