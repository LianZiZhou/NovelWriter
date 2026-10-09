/**
 * Sentences of known mood, without their final marks, that a model's opinion is measured against: a new sentence
 * takes the mood of the examples it sits closest to in the embedding space. Mostly Chinese and English (the app's
 * main languages), with a few in other languages so multilingual models have anchors there too.
 */
import type { Mood } from './punctuation.ts';

export const MOOD_EXEMPLARS: Record<Mood, string[]> = {
  question: [
    '你是谁', '这是哪里', '我该去往何处', '为何要这样做', '你还记得我吗', '我们最后赢了吗', '那为什么还要让我回来',
    '你来过这里', '真的是你', '你不怕吗', '他会来吗', '这次能不能等一等', '灯还亮着吗', '还有多少人',
    '你要去哪儿', '谁在门外', '这样做值得吗', '你也听见了', '我醒了吗', '你说的是真的', '明天还会下雨',
    'who are you', 'where am I', 'why did you come back', 'is anyone there', 'did you hear that', 'what happened here',
    'can you help me', 'are you sure', 'you came back', 'how long have you been waiting', 'which way is north',
    'do you remember me', 'will they come', 'you heard it too', 'is this real',
    'あなたは誰', 'ここはどこ', 'どうしてここに', '覚えていますか', '本当にあなたなの',
    '누구세요', '여기가 어디예요', '괜찮아요', '¿quién eres', 'qui es-tu', 'wer bist du', 'кто ты', 'где я',
  ],
  exclamation: [
    '快跑', '小心', '救命', '住手', '别过来', '太美了', '天哪', '糟了', '我们赢了', '终于到了', '不要',
    '滚出去', '快看', '多么壮观的景色', '放开她', '站住', '可恶', '好冷啊', '真是太好了', '等等我',
    'run', 'look out', 'help', 'stop', 'get down', 'what a beautiful view', 'we did it', 'finally', 'no',
    "don't touch me", 'watch out', 'hurry', 'how wonderful', 'let her go', 'get out of here', 'wait for me',
    '危ない', '助けて', 'やめて', 'すごい', '逃げて', '조심해', '살려줘', 'cuidado', 'au secours', 'hilfe', 'беги',
  ],
  statement: [
    '我推开门', '天快亮了', '我不知道他是谁', '这是你的', '我们走吧', '他点了点头', '灯还亮着', '我叫林远',
    '告诉我你是谁', '我记得这条路', '外面在下雨', '我会等你', '把灯给我', '她转身离开了', '我来过这里很多次',
    '风从门外吹进来', '我们明天出发', '我想知道那边的风会把它吹成什么样',
    'I open the door', 'it is getting late', 'I know who you are', 'this is yours', "let's go", 'he nodded',
    'my name is Lin', 'tell me who you are', 'I remember this road', 'it is raining outside', 'I will wait for you',
    'give me the lamp', 'she turned and left', 'we leave tomorrow', 'I wonder where she went',
    'ドアを開ける', '雨が降っている', '私は待っている', '문을 연다', 'abro la puerta', "j'ouvre la porte", 'ich öffne die Tür', 'я открываю дверь',
  ],
};
