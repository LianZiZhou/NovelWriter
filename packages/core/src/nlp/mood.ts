/**
 * What a sentence does (asks, exclaims or states), judged from its words: question words and particles,
 * inverted word order, interjections and commands, per language. Embedded questions ("I know who you are",
 * 「我不知道他是谁」) are statements. A model can refine the guess where the words are not decisive (see
 * `pipeline.ts`).
 */
import type { Lang } from './lang.ts';
import type { Mood } from './punctuation.ts';

export type MoodScores = Record<Mood, number>;

export interface MoodGuess {
  mood: Mood;
  /** Probability-like scores for each mood, summing to 1. */
  scores: MoodScores;
  /** How decisive the words were (0–1); low means a model's opinion should count. */
  confidence: number;
  /** What the guess rests on, for debugging and tests. */
  cues: string[];
}

interface Rules {
  /** Patterns that make a question, with their weight. */
  question: [RegExp, number][];
  exclamation: [RegExp, number][];
  /** Verbs of knowing and telling that turn a following question word into an embedded question. */
  embed?: RegExp;
  /** Question words, for the embedded-question check. */
  wh?: RegExp;
}

const ZH_WH = /(谁|誰|什么|甚麼|什麼|啥|哪|怎么|怎样|怎麼|为什么|為什麼|为何|為何|何处|何處|何时|何時|何人|何事|何必|何不|如何|多少|几[个点时天次岁位]?|是否|是不是|有没有|有沒有|能不能|会不会|會不會|要不要|可不可以|对不对|對不對|好不好|行不行|难道|難道|岂|豈)/;
const JA_WH = /(誰|だれ|何|なに|なん|なぜ|何故|どうして|どこ|何処|いつ|どう|どれ|どの|どちら|どっち|いくつ|いくら|幾つ)/;
const KO_WH = /(누구|누가|무엇|뭐|무슨|어디|언제|왜|어떻게|어떤|몇|얼마)/;

const RULES: Partial<Record<Lang, Rules>> = {
  zh: {
    question: [
      [/[吗嗎麼么][\s啊呀]*$/, 0.95],
      [/(呢|呐)[\s]*$/, 0.55],
      [ZH_WH, 0.8],
      [/(.)不\1/, 0.6],
      [/(.)没\1|(.)沒\2/, 0.5],
      // 「是你吧」「累了吧」 ask for confirmation; 「我们走吧」 suggests.
      [/(是|对|對|了|的|吗|没错|沒錯)吧[\s]*$/, 0.55],
      [/(没|沒|不|别|別).*吧[\s]*$/, 0.55],
      [/^你(确定|確定|真的|也|还|還|竟然|居然)/, 0.45],
    ],
    exclamation: [
      [/^(快|别|別|不要|不许|不準|住手|小心|当心|當心|救命|滚|滾|站住|闭嘴|閉嘴|走开|走開|放开|放開|停下|等等|天哪|天啊|糟了|糟糕|可恶|可惡|哇|啊|哎呀|哎哟|呀)/, 0.7],
      [/(太.{1,8}了|好.{1,6}啊|真.{1,6}啊|多么|多麼|简直|簡直)/, 0.65],
      [/^(救|放下|躲|逃|跑|让开|讓開|趴下|蹲下|闪开|閃開|出去|回来|回來)/, 0.6],
      [/^好[^\s]{1,3}的/, 0.6],
      [/[啊呀哇啦哪]$/, 0.5],
    ],
    embed: /(知道|晓得|曉得|记得|記得|明白|清楚|告诉|告訴|问问|問問|想想|看看|猜猜|不管|无论|無論|不论|不論)/,
    wh: ZH_WH,
  },
  ja: {
    question: [
      [/(か|かな|かしら|の|のか|でしょう|だろう)[\s]*$/, 0.7],
      [/(ですか|ますか|でしょうか)[\s]*$/, 0.95],
      [JA_WH, 0.6],
    ],
    exclamation: [
      [/^(早く|待って|やめて|止めて|助けて|危ない|逃げて|うわ|わあ|ああ|おい|きゃ|くそ|すごい|やった)/, 0.7],
      [/(なんて|なんと|すごい|最高|ぞ|ぜ|よ!|わよ|な!)[\s]*$/, 0.55],
      [/(ろ|なさい|て)[\s]*$/, 0.3],
    ],
    embed: /(知って|知る|わかる|分かる|覚えて|教えて)/,
    wh: JA_WH,
  },
  ko: {
    question: [
      [/(까|니|냐|나요|가요|래요|죠|지요|을까|ㄹ까|는가|던가)[\s]*$/, 0.85],
      [KO_WH, 0.6],
    ],
    exclamation: [
      [/^(빨리|조심|멈춰|도와|살려|그만|와|우와|아이고|세상에|어머)/, 0.7],
      [/(구나|군요|다니|어라|아라|여라|세요!)[\s]*$/, 0.55],
    ],
    embed: /(알아|알고|모르|기억)/,
    wh: KO_WH,
  },
  en: {
    question: [
      [/^(who|whom|whose|what|which|where|when|why|how)\b(?! (a|an|beautiful|lovely|wonderful|strange|terrible|awful|kind|nice|odd)\b)/i, 0.85],
      [/^(is|are|am|was|were|do|does|did|can|could|will|would|shall|should|may|might|must|have|has|had|isn't|aren't|wasn't|weren't|don't|doesn't|didn't|can't|couldn't|won't|wouldn't|shouldn't|haven't|hasn't|hadn't)\b/i, 0.85],
      [/,\s*(right|isn't it|aren't you|don't you|didn't you|won't you|can't you|is it|okay|ok|yes)\s*$/i, 0.7],
      [/^(anyone|anybody|someone|somebody)\b/i, 0.3],
    ],
    exclamation: [
      [/^(what an? |how (beautiful|lovely|wonderful|strange|terrible|awful|kind|nice|odd)\b)/i, 0.75],
      [/^(oh|ah|wow|whoa|hey|ouch|alas|damn|hooray|yay|help|stop|run|look out|watch out|get down|get out|quick|hurry|no|yes|careful|freeze|wait)\b/i, 0.6],
    ],
    embed: /\b(know|wonder|remember|tell me|ask|see|guess|forget|understand|idea|sure|whatever|no matter)\b/i,
    wh: /\b(who|whom|whose|what|which|where|when|why|how|whether|if)\b/i,
  },
  ru: {
    question: [
      [/^(кто|что|где|куда|откуда|когда|почему|зачем|как|какой|какая|какое|какие|сколько|чей|чья|чьё|разве|неужели)\b/iu, 0.85],
      [/\sли\b/iu, 0.8],
      [/,\s*(да|правда|верно|не так ли)\s*$/iu, 0.7],
    ],
    exclamation: [
      [/^(стой|беги|бегите|помогите|осторожно|ура|ой|ах|эй|тихо|быстрее|скорее|нет|да)\b/iu, 0.6],
      [/^(какой|какая|какое|как) (же )?(красив|прекрасн|ужасн|странн|хорош)/iu, 0.7],
    ],
  },
  uk: {
    question: [
      [/^(хто|що|де|куди|звідки|коли|чому|навіщо|як|який|яка|яке|які|скільки|чий|чия|невже|хіба|чи)\b/iu, 0.85],
    ],
    exclamation: [[/^(стій|біжи|допоможіть|обережно|ура|ой|ах|гей|тихо|швидше)\b/iu, 0.6]],
  },
  es: {
    question: [
      [/^¿|^(qué|quién|quiénes|dónde|adónde|cuándo|por qué|cómo|cuál|cuáles|cuánto|cuántos|cuánta|cuántas)\b/iu, 0.85],
      [/,\s*(verdad|no|vale)\s*$/iu, 0.7],
    ],
    exclamation: [[/^¡|^(ay|oh|cuidado|socorro|ayuda|corre|para|basta|vamos|qué (bonit|horribl|maravill))/iu, 0.65]],
    embed: /\b(sé|sabes|sabe|saber|recuerdo|dime|pregunto|no importa)\b/iu,
    wh: /\b(qué|quién|dónde|cuándo|cómo|cuál|cuánto)\b/iu,
  },
  fr: {
    question: [
      [/^(qui|que|quoi|où|quand|pourquoi|comment|quel|quelle|quels|quelles|combien|lequel|laquelle|est-ce que|est-ce qu)\b/iu, 0.85],
      [/^\p{L}+-(je|tu|il|elle|on|nous|vous|ils|elles|t-il|t-elle)\b/iu, 0.8],
      [/,\s*(non|hein|n'est-ce pas)\s*$/iu, 0.7],
    ],
    exclamation: [[/^(oh|ah|hé|attention|au secours|vite|arrête|arrêtez|courez|quel(le)? (beau|belle|horreur))/iu, 0.6]],
    embed: /\b(sais|savoir|sait|rappelle|dis-moi|demande|importe)\b/iu,
    wh: /\b(qui|quoi|où|quand|pourquoi|comment|quel|quelle)\b/iu,
  },
  de: {
    question: [
      [/^(wer|wen|wem|wessen|was|wo|wohin|woher|wann|warum|wieso|weshalb|wie|welche|welcher|welches|wieviel|wie viel)\b/iu, 0.85],
      [/^(ist|sind|bin|bist|war|waren|hast|hat|habt|haben|kannst|kann|können|willst|will|wollen|darf|darfst|soll|sollst|wirst|wird|werden|gibt|weißt|kennst)\b/iu, 0.8],
      [/,\s*(oder|nicht wahr|ja|gell)\s*$/iu, 0.7],
    ],
    exclamation: [[/^(oh|ach|au|hilfe|vorsicht|achtung|lauf|halt|stopp|schnell|los|was für ein)/iu, 0.6]],
    embed: /\b(weiß|wissen|weißt|erinnere|sag mir|frage|egal)\b/iu,
    wh: /\b(wer|was|wo|wann|warum|wie|welche)\b/iu,
  },
  it: {
    question: [
      [/^(chi|che|cosa|che cosa|dove|quando|perché|come|quale|quali|quanto|quanti|quanta|quante)\b/iu, 0.85],
      [/,\s*(vero|no|giusto)\s*$/iu, 0.7],
    ],
    exclamation: [[/^(oh|ah|aiuto|attento|attenzione|corri|basta|fermo|presto|che (bello|bella|orrore))/iu, 0.6]],
  },
  pt: {
    question: [
      [/^(quem|que|o que|onde|aonde|quando|por que|porque|como|qual|quais|quanto|quantos|quanta|quantas)\b/iu, 0.85],
      [/,\s*(né|certo|não é)\s*$/iu, 0.7],
    ],
    exclamation: [[/^(oh|ah|socorro|cuidado|corre|para|basta|rápido|que (lindo|linda|horror))/iu, 0.6]],
  },
  nl: {
    question: [
      [/^(wie|wat|waar|wanneer|waarom|hoe|welke|welk|hoeveel)\b/iu, 0.85],
      [/^(is|zijn|ben|was|waren|heb|heeft|hebben|kan|kun|kunnen|wil|wilt|mag|moet|zal|zult|weet)\b/iu, 0.75],
    ],
    exclamation: [[/^(oh|ach|au|help|pas op|kijk uit|stop|rennen|snel)\b/iu, 0.6]],
  },
  ar: {
    question: [[/^(من|ما|ماذا|أين|متى|لماذا|كيف|كم|أي|هل|أ)/u, 0.85]],
    exclamation: [[/^(يا|آه|واو|احذر|النجدة|اركض|توقف|ما أجمل)/u, 0.6]],
  },
  fa: {
    question: [[/^(کی|چه|چی|کجا|کی|چرا|چطور|چگونه|چند|کدام|آیا)/u, 0.85]],
    exclamation: [[/^(وای|آه|مواظب|کمک|بدو|بایست)/u, 0.6]],
  },
  he: {
    question: [[/^(מי|מה|איפה|לאן|מתי|למה|מדוע|איך|כמה|איזה|האם)/u, 0.85]],
    exclamation: [[/^(הצילו|זהירות|רוץ|עצור|וואו|אוי)/u, 0.6]],
  },
  el: {
    question: [[/^(ποιος|ποια|ποιο|τι|πού|πότε|γιατί|πώς|πόσο|πόσα|μήπως)/iu, 0.85]],
    exclamation: [[/^(ω|αχ|βοήθεια|προσοχή|τρέξε|σταμάτα)/iu, 0.6]],
  },
  hi: {
    question: [[/(क्या|कौन|कहाँ|कब|क्यों|कैसे|कितना|कितने|किसका)/u, 0.8]],
    exclamation: [[/^(अरे|वाह|बचाओ|सावधान|भागो|रुको|हाय)/u, 0.6]],
  },
  th: {
    question: [[/(ไหม|มั้ย|หรือ|หรอ|ใคร|อะไร|ที่ไหน|เมื่อไร|ทำไม|อย่างไร|ยังไง|เท่าไร|กี่)/u, 0.8]],
    exclamation: [[/^(ระวัง|ช่วยด้วย|หยุด|วิ่ง|ว้าว|โอ้)/u, 0.6]],
  },
};

/** `\b` only knows ASCII letters; make it a boundary between any letters and non-letters ("кто ты", "qué pasa"). */
const BOUNDARY = '(?:(?<![\\p{L}\\p{N}])(?=[\\p{L}\\p{N}])|(?<=[\\p{L}\\p{N}])(?![\\p{L}\\p{N}]))';
function unicodeWords(re: RegExp): RegExp {
  if (!re.source.includes('\\b')) return re;
  const flags = re.flags.includes('u') ? re.flags : re.flags + 'u';
  return new RegExp(re.source.replace(/\\b/g, BOUNDARY), flags);
}
for (const r of Object.values(RULES)) {
  r.question = r.question.map(([re, w]) => [unicodeWords(re), w]);
  r.exclamation = r.exclamation.map(([re, w]) => [unicodeWords(re), w]);
  if (r.embed) r.embed = unicodeWords(r.embed);
  if (r.wh) r.wh = unicodeWords(r.wh);
}

const EVEN: MoodScores = { statement: 1 / 3, question: 1 / 3, exclamation: 1 / 3 };

/** Turn evidence strengths into scores: each cue adds weight to its mood on top of a prior for statements. */
function scoresFrom(q: number, e: number): MoodScores {
  // Without any cue a sentence is most likely a statement, but intonation can still make it ask or exclaim.
  const statement = 0.6;
  const question = 0.25 + q * 2.5;
  const exclamation = 0.15 + e * 2;
  const total = statement + question + exclamation;
  return { statement: statement / total, question: question / total, exclamation: exclamation / total };
}

export function bestMood(s: MoodScores): Mood {
  return (Object.keys(s) as Mood[]).reduce((a, b) => (s[b] > s[a] ? b : a));
}

/** The mood of one sentence (without its final mark), from its words. */
export function guessMood(sentence: string, lang: Lang): MoodGuess {
  const text = sentence.trim().replace(/[\p{P}\s]+$/u, '');
  const rules = RULES[lang];
  if (!text) return { mood: 'statement', scores: EVEN, confidence: 0, cues: [] };
  if (!rules) return { mood: 'statement', scores: scoresFrom(0, 0), confidence: 0.2, cues: ['no rules for this language'] };
  const cues: string[] = [];
  let q = 0;
  let e = 0;
  for (const [re, w] of rules.question) {
    const m = re.exec(text);
    if (!m) continue;
    // "I don't know who she is" / 「我不知道他是谁」: the question word answers a verb of knowing or telling.
    if (rules.embed && rules.wh?.test(m[0]) && rules.embed.test(text.slice(0, m.index + m[0].length)) && rules.embed.exec(text)!.index < m.index) {
      cues.push(`embedded ${m[0]}`);
      continue;
    }
    cues.push(`question ${m[0]}`);
    q = Math.max(q, w) + Math.min(q, w) * 0.2;
  }
  for (const [re, w] of rules.exclamation) {
    const m = re.exec(text);
    if (!m) continue;
    cues.push(`exclamation ${m[0]}`);
    e = Math.max(e, w) + Math.min(e, w) * 0.2;
  }
  const scores = scoresFrom(q, e);
  const mood = bestMood(scores);
  const sorted = Object.values(scores).sort((a, b) => b - a);
  // No cue at all is weak evidence for a statement: intonation can make 「你来过这里」 a question.
  const embedded = cues.some((c) => c.startsWith('embedded'));
  const confidence = q || e ? Math.min(1, (sorted[0] - sorted[1]) * 1.2 + 0.3) : embedded ? 0.7 : 0.45;
  return { mood, scores, confidence, cues };
}
