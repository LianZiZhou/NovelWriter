import { describe, expect, it } from 'vitest';
import {
  chapterHeading,
  chapterRange,
  chineseNumber,
  compactTranscript,
  locateChapters,
  newRun,
  parseTextToolCalls,
  repetitionScore,
  revertFieldChange,
  rollbackPlan,
  runDirector,
  textTranscript,
  toolsFor,
  trustFor,
  validateArgs,
  TOOL_BY_NAME,
  type DirectorHost,
  type DirectorMessage,
  type DirectorRun,
  type DirectorToolCall,
  type ModelReply,
  type ToolOutcome,
  type TrustPolicy,
} from '../src/director/index.ts';
import { buildDirectorSystem, directorKickoff, storyOverview } from '../src/director/prompts.ts';
import { newLoreEntry, newStory } from '../src/defaults.ts';
import { migrateStory } from '../src/defaults.ts';

const call = (name: string, args: Record<string, unknown> = {}, id = `${name}-${Math.random()}`): DirectorToolCall => ({ id, name, args });

/** A host driven by canned model replies; tools append to a string "story". */
function scriptedHost(replies: ModelReply[], o: { policy?: TrustPolicy; pauseAfter?: number; interject?: string[]; approve?: boolean } = {}) {
  const sent: DirectorMessage[][] = [];
  const saved: DirectorRun[] = [];
  const executed: DirectorToolCall[] = [];
  let story = '';
  let turns = 0;
  const interjections = [...(o.interject ?? [])];
  const host: DirectorHost = {
    async callModel(_system, messages) {
      sent.push(messages);
      turns++;
      const r = replies.shift();
      if (!r) throw new Error('no more replies');
      return r;
    },
    system: () => 'system',
    tools: () => toolsFor('loop', o.policy),
    trust: (tool) => trustFor(tool.category, o.policy),
    async execute(c): Promise<ToolOutcome> {
      executed.push(c);
      if (c.name === 'write_passage') {
        const text = ` [${String(c.args.beat)}]`;
        story += text;
        return { content: text, passage: true, chars: text.length, historyNode: `n${executed.length}` };
      }
      if (c.name === 'update_memory') return { content: 'ok', change: { field: 'memory', before: '', after: String(c.args.text) } };
      if (c.name === 'read_story') return { content: story };
      return { content: 'ok' };
    },
    async confirm() {
      return { approved: o.approve ?? true, note: o.approve === false ? 'no thanks' : undefined };
    },
    async ask(question) {
      return `answer to ${question}`;
    },
    save: (r) => void saved.push(r),
    shouldPause: () => o.pauseAfter !== undefined && turns >= o.pauseAfter,
    takeInterjections: () => interjections.splice(0),
    historyNode: () => `h${turns}`,
  };
  return { host, sent, saved, executed, story: () => story };
}

describe('director loop', () => {
  it('runs tools until finish and records the log, plan and budget', async () => {
    const h = scriptedHost([
      { text: 'Let me plan.', toolCalls: [call('update_plan', { steps: [{ text: 'Write the arrival', status: 'active' }] }), call('write_passage', { beat: 'arrive' })] },
      { text: '', toolCalls: [call('write_passage', { beat: 'meet' }), call('update_memory', { text: 'Mira is in town.' })] },
      { text: '', toolCalls: [call('finish', { summary: 'Done.' })] },
    ]);
    const run = await runDirector(newRun('Write chapter one', 'loop'), h.host, new AbortController().signal);
    expect(run.status).toBe('done');
    expect(run.result).toBe('Done.');
    expect(h.story()).toBe(' [arrive] [meet]');
    expect(run.plan).toEqual([{ id: expect.any(String), text: 'Write the arrival', status: 'active' }]);
    expect(run.spent).toEqual({ turns: 3, passages: 2, chars: h.story().length });
    const tools = run.log.filter((e) => e.kind === 'tool').map((e) => e.tool);
    expect(tools).toEqual(['update_plan', 'write_passage', 'write_passage', 'update_memory', 'finish']);
    expect(run.log.find((e) => e.tool === 'update_memory')?.change).toEqual({ field: 'memory', before: '', after: 'Mira is in town.' });
    expect(run.log.find((e) => e.kind === 'thought')?.text).toBe('Let me plan.');
    // Every tool call in the transcript has its result.
    const ids = run.transcript.flatMap((m) => (m.role === 'assistant' ? (m.toolCalls ?? []).map((c) => c.id) : []));
    const results = run.transcript.flatMap((m) => (m.role === 'tool' ? [m.toolCallId] : []));
    expect(results).toEqual(ids);
    expect(run.checkpoints.map((c) => c.historyNode)).toEqual(['h0', 'h1', 'h2']);
  });

  it('asks before confirm-level actions and reports rejections to the model', async () => {
    const h = scriptedHost(
      [
        { text: '', toolCalls: [call('delete_lore_entry', { id: 'x' })] },
        { text: '', toolCalls: [call('finish', { summary: 'ok' })] },
      ],
      { approve: false },
    );
    const run = await runDirector(newRun('g', 'loop'), h.host, new AbortController().signal);
    expect(h.executed).toEqual([]);
    const result = run.transcript.find((m) => m.role === 'tool');
    expect(result).toMatchObject({ isError: true, content: 'The author rejected this action: no thanks' });
    expect(h.saved.some((r) => r.status === 'waiting')).toBe(true);
  });

  it('leaves denied tools out and refuses calls to them', async () => {
    const policy: TrustPolicy = { prose: 'deny' };
    expect(toolsFor('loop', policy).some((t) => t.name === 'write_passage')).toBe(false);
    expect(toolsFor('loop').some((t) => t.name === 'set_phase')).toBe(false);
    expect(toolsFor('book').some((t) => t.name === 'set_phase')).toBe(true);
    const h = scriptedHost([{ text: '', toolCalls: [call('write_passage', { beat: 'x' })] }, { text: '', toolCalls: [call('finish', { summary: 's' })] }], { policy });
    const run = await runDirector(newRun('g', 'loop'), h.host, new AbortController().signal);
    expect(h.executed).toEqual([]);
    expect(run.log.find((e) => e.tool === 'write_passage')?.isError).toBe(true);
  });

  it('pauses between turns, skipping (but answering) calls after the pause', async () => {
    const h = scriptedHost([{ text: '', toolCalls: [call('write_passage', { beat: 'a' }), call('write_passage', { beat: 'b' })] }], { pauseAfter: 1 });
    const run = await runDirector(newRun('g', 'loop'), h.host, new AbortController().signal);
    expect(run.status).toBe('paused');
    expect(h.executed).toEqual([]);
    expect(run.transcript.filter((m) => m.role === 'tool')).toHaveLength(2);
    // Resuming continues from the saved transcript.
    const h2 = scriptedHost([{ text: '', toolCalls: [call('finish', { summary: 'resumed' })] }]);
    const done = await runDirector(run, h2.host, new AbortController().signal);
    expect(done.status).toBe('done');
    expect(h2.sent[0]).toEqual(run.transcript);
  });

  it('passes interjections to the model before its next turn', async () => {
    const h = scriptedHost([{ text: '', toolCalls: [call('finish', { summary: 's' })] }], { interject: ['Make it rain.'] });
    const run = await runDirector(newRun('g', 'loop'), h.host, new AbortController().signal);
    expect(h.sent[0].at(-1)).toEqual({ role: 'user', content: '[Author] Make it rain.' });
    expect(run.log.some((e) => e.kind === 'user' && e.text === 'Make it rain.')).toBe(true);
  });

  it('stops when the budget is used up', async () => {
    const h = scriptedHost([
      { text: '', toolCalls: [call('write_passage', { beat: 'a' })] },
      { text: '', toolCalls: [call('write_passage', { beat: 'b' })] },
      { text: '', toolCalls: [call('write_passage', { beat: 'c' })] },
    ]);
    const run = await runDirector(newRun('g', 'loop', { maxPassages: 2 }), h.host, new AbortController().signal);
    expect(run.status).toBe('done');
    expect(run.result).toMatch(/passage budget/);
    expect(h.executed).toHaveLength(2);
  });

  it('stops after repeated tool errors and on a stream of idle turns', async () => {
    const bad = Array.from({ length: 5 }, () => ({ text: '', toolCalls: [call('no_such_tool')] }));
    const run = await runDirector(newRun('g', 'loop'), scriptedHost(bad).host, new AbortController().signal);
    expect(run.status).toBe('error');
    const idle = await runDirector(newRun('g', 'loop'), scriptedHost([{ text: 'hmm', toolCalls: [] }, { text: 'all done', toolCalls: [] }]).host, new AbortController().signal);
    expect(idle.status).toBe('done');
    expect(idle.result).toBe('all done');
  });

  it('stops on abort', async () => {
    const ctl = new AbortController();
    const h = scriptedHost([{ text: '', toolCalls: [call('write_passage', { beat: 'a' }), call('write_passage', { beat: 'b' })] }]);
    const exec = h.host.execute;
    h.host.execute = async (c, r, s) => {
      const out = await exec(c, r, s);
      ctl.abort();
      return out;
    };
    const run = await runDirector(newRun('g', 'loop'), h.host, ctl.signal);
    expect(run.status).toBe('stopped');
    expect(h.executed).toHaveLength(1);
  });

  it('handles ask_user and book phases', async () => {
    const h = scriptedHost([
      { text: '', toolCalls: [call('ask_user', { question: 'Happy ending?' }), call('set_phase', { phase: 'world' })] },
      { text: '', toolCalls: [call('finish', { summary: 'ok' })] },
    ]);
    h.host.tools = () => toolsFor('book');
    const run = await runDirector(newRun('idea', 'book'), h.host, new AbortController().signal);
    expect(run.phase).toBe('world');
    expect(run.transcript.find((m) => m.role === 'tool')?.content).toBe('The author answered: answer to Happy ending?');
  });
});

describe('director tools', () => {
  it('validates and coerces arguments', () => {
    const wp = TOOL_BY_NAME.write_passage;
    expect(validateArgs(wp, { beat: 'go', length: '800' })).toEqual({ ok: true, args: { beat: 'go', length: 800 } });
    expect(validateArgs(wp, { length: 10 })).toEqual({ ok: false, error: 'Missing required "beat".' });
    expect(validateArgs(wp, '{"beat":"x","extra":1}')).toEqual({ ok: true, args: { beat: 'x' } });
    expect(validateArgs(wp, { beat: 'x', length: 50 })).toEqual({ ok: true, args: { beat: 'x', length: 200 } });
    const lore = TOOL_BY_NAME.upsert_lore_entry;
    expect(validateArgs(lore, { name: 'Mira', text: 't', keys: 'Mira, Mi' })).toEqual({ ok: true, args: { name: 'Mira', text: 't', keys: ['Mira', 'Mi'] } });
    expect(validateArgs(lore, { name: 'Mira', text: 't', type: 'Dragon' }).ok).toBe(false);
  });

  it('parses text-protocol tool calls', () => {
    const r = parseTextToolCalls('Thinking.\n```tool\n{"name": "write_passage", "arguments": {"beat": "go",}}\n```\n<tool_call>{"name":"finish","args":{"summary":"s"}}</tool_call>');
    expect(r.text).toBe('Thinking.');
    expect(r.toolCalls.map((c) => [c.name, c.args])).toEqual([
      ['write_passage', { beat: 'go' }],
      ['finish', { summary: 's' }],
    ]);
    expect(parseTextToolCalls('```js\nconsole.log(1)\n```').toolCalls).toEqual([]);
    const chat = textTranscript([
      { role: 'user', content: 'goal' },
      { role: 'assistant', content: '', toolCalls: [{ id: '1', name: 'read_story', args: {} }] },
      { role: 'tool', toolCallId: '1', name: 'read_story', content: 'text' },
      { role: 'user', content: '[Author] more' },
    ]);
    expect(chat.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(chat[2].content).toBe('[Result of read_story]\ntext\n\n[Author] more');
  });

  it('compacts long transcripts by whole turns', () => {
    const big = 'x'.repeat(1000);
    const msgs: DirectorMessage[] = [{ role: 'user', content: 'goal' }];
    for (let i = 0; i < 10; i++) {
      msgs.push({ role: 'assistant', content: '', toolCalls: [{ id: `c${i}`, name: 'read_story', args: {} }] });
      msgs.push({ role: 'tool', toolCallId: `c${i}`, name: 'read_story', content: big });
    }
    const out = compactTranscript(msgs, 3500);
    expect(out[0].role).toBe('user');
    expect(out[0].content).toMatch(/dropped/);
    expect(out[1].role).toBe('assistant');
    expect(out.length).toBeLessThan(msgs.length);
    expect(out.at(-1)).toEqual(msgs.at(-1));
    expect(compactTranscript(msgs.slice(0, 3), 3500)).toEqual(msgs.slice(0, 3));
  });
});

describe('director undo and rollback', () => {
  it('reverts field changes and detects conflicts', () => {
    const s = newStory({ memory: 'new' });
    const c = { field: 'memory' as const, before: 'old', after: 'new' };
    expect(revertFieldChange(s, c)).toEqual({ story: expect.objectContaining({ memory: 'old' }) });
    expect(revertFieldChange({ ...s, memory: 'edited' }, c)).toHaveProperty('conflict');
    expect(revertFieldChange({ ...s, memory: 'edited' }, c, true)).toEqual({ story: expect.objectContaining({ memory: 'old' }) });

    const entry = newLoreEntry({ displayName: 'Mira', text: 'v2' });
    const before = { ...entry, text: 'v1' };
    const withEntry = { ...s, lorebook: { ...s.lorebook, entries: [entry] } };
    const back = revertFieldChange(withEntry, { field: 'lore', entryId: entry.id, before, after: entry });
    expect('story' in back && back.story.lorebook.entries[0].text).toBe('v1');
    const created = revertFieldChange(withEntry, { field: 'lore', entryId: entry.id, before: null, after: entry });
    expect('story' in created && created.story.lorebook.entries).toEqual([]);
  });

  it('plans a rollback to a checkpoint', () => {
    const run = newRun('g', 'loop');
    run.checkpoints = [{ id: 'cp', at: 0, logIndex: 1, historyNode: 'h1', label: 'Turn 1' }];
    run.log.push(
      { id: 'a', at: 0, kind: 'tool', text: '', change: { field: 'memory', before: '', after: 'm1' } },
      { id: 'b', at: 0, kind: 'tool', text: '', change: { field: 'memory', before: 'm1', after: 'm2' } },
      { id: 'c', at: 0, kind: 'tool', text: '', change: { field: 'authorsNote', before: '', after: 'n' }, reverted: true },
    );
    expect(rollbackPlan(run, 'cp')).toEqual({ historyNode: 'h1', entries: [{ id: 'b', change: expect.anything() }, { id: 'a', change: expect.anything() }] });
    expect(rollbackPlan(run, 'nope')).toBeNull();
  });

  it('pauses runs that were going when the story was saved', () => {
    const run = { ...newRun('g', 'loop'), status: 'running' as const };
    const s = migrateStory({ ...newStory(), director: { runs: [run, { ...run, id: 'x', status: 'done' }] } });
    expect(s.director?.runs.map((r) => r.status)).toEqual(['paused', 'done']);
  });
});

describe('chapters', () => {
  it('formats headings', () => {
    expect([1, 10, 12, 20, 105, 110].map(chineseNumber)).toEqual(['一', '十', '十二', '二十', '一百零五', '一百一十']);
    expect(chapterHeading(3, '雨夜', true)).toBe('第三章 雨夜');
    expect(chapterHeading(3, 'Rain', false)).toBe('Chapter 3: Rain');
  });

  it('locates chapter headings in the text', () => {
    const outline = {
      premise: '',
      chapters: [
        { id: '1', title: 'Arrival', synopsis: '', beats: [], status: 'drafted' as const },
        { id: '2', title: 'The Letter', synopsis: '', beats: [], status: 'drafting' as const },
        { id: '3', title: 'Flight', synopsis: '', beats: [], status: 'planned' as const },
      ],
    };
    const text = 'Chapter 1: Arrival\nShe came at night.\n\nThe Letter\nIt was sealed. Chapter 10 was mentioned.\n';
    const starts = locateChapters(text, outline);
    expect(starts).toEqual([0, text.indexOf('The Letter'), null]);
    expect(chapterRange(text, outline, 1)).toEqual({ from: 0, to: text.indexOf('The Letter') });
    expect(chapterRange(text, outline, 3)).toBeNull();
    const zh = '第一章 抵达\n她来了。\n第二章 信\n信封着。';
    expect(locateChapters(zh, { premise: '', chapters: outline.chapters.slice(0, 2) })).toEqual([0, zh.indexOf('第二章')]);
  });
});

describe('director prompts', () => {
  it('describes the story, mode and trust', () => {
    const s = newStory({ title: 'Rain', memory: 'Mira, a courier.', doc: [{ text: 'The rain fell.', origin: 'prompt' }] });
    s.lorebook.entries.push(newLoreEntry({ displayName: 'Mira', keys: ['Mira'] }));
    const ov = storyOverview(s);
    expect(ov).toMatch(/Title: Rain/);
    expect(ov).toMatch(/- Mira \[Mira\]/);
    expect(ov).toMatch(/The rain fell\./);
    expect(directorKickoff(s, 'Write on', 'loop')).toMatch(/goal for this session:\n"""\nWrite on/);
    const run = newRun('idea', 'book');
    const sys = buildDirectorSystem(s, run, { trust: { loreDelete: 'confirm', rewrite: 'deny' } });
    expect(sys).toMatch(/Current phase — Premise/);
    expect(sys).toMatch(/approves these actions one by one.*deleting lorebook entries/);
    expect(sys).toMatch(/Not allowed in this run: rewriting/);
  });

  it('scores repetition', () => {
    const a = 'The old man walked down to the harbour and looked at the boats for a long time before he spoke.';
    expect(repetitionScore(a, `Earlier. ${a} Later.`)).toBe(1);
    expect(repetitionScore(a, 'Completely different words fill this unrelated sentence about mountains and snow.')).toBe(0);
    expect(repetitionScore('short', a)).toBe(0);
  });
});
