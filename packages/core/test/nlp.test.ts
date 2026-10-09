import { describe, expect, it } from 'vitest';
import { unitBoundaries } from '../src/context.ts';
import { postProcess } from '../src/prompts.ts';
import { blendMood, detectLanguage, endsSentence, guessMood, punctuate, sentenceEnds, sentences, terminate, words } from '../src/nlp/index.ts';

describe('language', () => {
  it('tells languages apart by script, then by function words', () => {
    expect(detectLanguage('风穿过门缝，带来远方陌生的草木气息。')?.lang).toBe('zh');
    expect(detectLanguage('ドアの向こうから風が吹いてきた。')?.lang).toBe('ja');
    expect(detectLanguage('문이 천천히 열렸다.')?.lang).toBe('ko');
    expect(detectLanguage('Ветер дул с моря.')?.lang).toBe('ru');
    expect(detectLanguage('Der Wind wehte durch die Tür, und sie wusste nicht, wo sie war.')?.lang).toBe('de');
    expect(detectLanguage('Le vent soufflait dans la maison et il ne savait pas où aller.')?.lang).toBe('fr');
    expect(detectLanguage('The wind blew through the door and she did not know where she was.')?.lang).toBe('en');
    expect(detectLanguage('12345 ...')).toBeNull();
  });
});

describe('segmentation', () => {
  it('ends Chinese sentences at once and English ones before a space, not after abbreviations', () => {
    expect(sentences('他说：“走吧！”然后离开了。她没有回头。')).toEqual(['他说：“走吧！”', '然后离开了。', '她没有回头。']);
    expect(sentences('Mr. Smith left. Then he ran! 3.14 is pi.')).toEqual(['Mr. Smith left. ', 'Then he ran! ', '3.14 is pi.']);
    expect(sentenceEnds('One line\nTwo')).toEqual([9]);
    expect(words('the old door').length).toBe(3);
  });
  it('is what context trimming and sentence trimming use', () => {
    // Chinese sentences were not boundaries before: no space follows their full stop.
    expect(unitBoundaries('他来了。她走了。', 'sentence')).toEqual([0, 4, 8]);
    expect(postProcess('', '她推开门。风吹进来，灯', { trimToSentence: true })).toBe('她推开门。');
  });
});

describe('punctuation', () => {
  it('ends text by its meaning, in the marks of its language', () => {
    expect(terminate('你是谁', 'zh', 'question')).toBe('你是谁？');
    expect(terminate('qué pasa', 'es', 'question')).toBe('¿qué pasa?');
    expect(terminate('où suis-je', 'fr', 'question')).toBe('où suis-je ?');
    expect(terminate('Run!', 'en', 'statement')).toBe('Run!');
    expect(endsSentence('「走！」')).toBe(true);
    expect(endsSentence('他说')).toBe(false);
  });
  it('reads questions, exclamations and embedded questions from the words', () => {
    expect(guessMood('你知道他是谁吗', 'zh').mood).toBe('question');
    expect(guessMood('我不知道他是谁', 'zh').mood).toBe('statement');
    expect(guessMood('我们走吧', 'zh').mood).toBe('statement');
    expect(guessMood('你没受伤吧', 'zh').mood).toBe('question');
    expect(guessMood('太美了', 'zh').mood).toBe('exclamation');
    expect(guessMood('I know who you are', 'en').mood).toBe('statement');
    expect(guessMood('is it safe', 'en').mood).toBe('question');
    expect(guessMood('кто ты', 'ru').mood).toBe('question');
    expect(punctuate('你是谁？', '风。')).toMatchObject({ text: '你是谁？', source: 'typed' });
  });
  it('lets a model decide only where the words are not decisive', () => {
    const decisive = guessMood('你是谁', 'zh');
    expect(blendMood(decisive, { statement: 0.9, question: 0.05, exclamation: 0.05 }).mood).toBe('question');
    const open = guessMood('你来过这里', 'zh');
    expect(blendMood(open, { statement: 0.1, question: 0.85, exclamation: 0.05 })).toEqual({ mood: 'question', source: 'model' });
  });
});
