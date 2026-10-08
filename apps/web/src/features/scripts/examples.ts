// Example scripts shipped with NovelWriter. They show the API and are useful on their own.

export interface ExampleScript {
  name: string;
  description: string;
  language: 'js' | 'ts';
  code: string;
}

const FIND_REPLACE = `/*@meta
{
  "name": "Find & Replace (script)",
  "description": "A script version of Find & Replace: opens a window, replaces across the story and lists matches.",
  "author": "NovelWriter",
  "version": "1.0",
  "permissions": ["documentEdit"],
  "config": [{ "id": "caseSensitive", "type": "boolean", "label": "Case sensitive", "default": false }]
}
*/
let find = '';
let replace = '';
let modal = null;

const escape = (s) => s.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&');
const pattern = () => new RegExp(escape(find), api.v1.config.get('caseSensitive') ? 'g' : 'gi');

async function count() {
  if (!find) return 0;
  return ((await api.v1.document.text()).match(pattern()) || []).length;
}

async function content() {
  const n = await count();
  return [
    { type: 'textInput', id: 'find', label: 'Find', value: find, onChange: (v) => { find = v; refresh(); } },
    { type: 'textInput', id: 'replace', label: 'Replace with', value: replace, onChange: (v) => { replace = v; } },
    { type: 'text', text: find ? n + ' match(es)' : 'Type something to find.' },
    {
      type: 'row',
      children: [
        {
          type: 'button',
          label: 'Replace All',
          onClick: async () => {
            const text = await api.v1.document.text();
            const re = pattern();
            // Replace from the end so earlier offsets stay valid.
            const hits = [...text.matchAll(re)].reverse();
            for (const m of hits) await api.v1.document.replace(m.index, m.index + m[0].length, replace);
            api.v1.ui.toast('Replaced ' + hits.length + ' match(es).', 'success');
            refresh();
          },
        },
        { type: 'button', label: 'Close', onClick: () => api.v1.ui.modal.close(modal) },
      ],
    },
  ];
}

async function refresh() {
  if (modal) api.v1.ui.modal.update(modal, { content: await content() });
}

api.v1.ui.register({
  type: 'toolbarButton',
  id: 'open',
  label: 'Find & Replace',
  onClick: async () => {
    modal = await api.v1.ui.modal.open({ title: 'Find & Replace', content: await content() });
  },
});
`;

const BOOKMARKS = `/*@meta
{
  "name": "Bookmarks",
  "description": "Bookmark places in the story from the right-click menu, list them in a sidebar panel and mark them in the editor.",
  "author": "NovelWriter",
  "version": "1.0",
  "permissions": ["editorDecorations"]
}
*/
async function bookmarks() {
  return (await api.v1.storyStorage.get('bookmarks', [])) || [];
}

async function render() {
  const list = await bookmarks();
  await api.v1.editor.decorations.setMarkers(
    list.map((b) => ({ from: b.at, to: b.at + b.length, style: { background: 'rgba(245, 243, 194, 0.18)', borderBottom: '1px dashed currentColor' }, title: 'Bookmark: ' + b.label })),
  );
  await api.v1.ui.register({
    type: 'sidebarPanel',
    id: 'panel',
    title: 'Bookmarks',
    content: list.length
      ? list.map((b, i) => ({
          type: 'row',
          children: [
            { type: 'text', text: b.label },
            {
              type: 'button',
              label: 'Remove',
              onClick: async () => {
                const next = (await bookmarks()).filter((_, j) => j !== i);
                await api.v1.storyStorage.set('bookmarks', next);
                render();
              },
            },
          ],
        }))
      : [{ type: 'text', text: 'Right-click a selection and choose **Bookmark selection**.', markdown: true }],
  });
}

api.v1.ui.register({
  type: 'contextMenuButton',
  id: 'add',
  label: 'Bookmark selection',
  onClick: async ({ text, from, to }) => {
    if (!text) return api.v1.ui.toast('Select some text to bookmark.');
    const list = await bookmarks();
    list.push({ at: from, length: to - from, label: text.slice(0, 40) });
    await api.v1.storyStorage.set('bookmarks', list);
    render();
  },
});

api.v1.hooks.register('onScriptsLoaded', render);
`;

const SUMMARIZER = `/*@meta
{
  "name": "Smart Summarizer",
  "description": "Summarizes the story so far into Memory, or a selection through the Writer's Toolbox.",
  "author": "NovelWriter",
  "version": "1.0",
  "permissions": ["storyEdit"],
  "config": [{ "id": "sentences", "type": "number", "label": "Summary length (sentences)", "default": 4, "min": 1, "max": 12 }]
}
*/
const ask = (text: string): Promise<{ text: string }> =>
  api.v1.generate({
    system: 'You summarize fiction. Reply with only the summary.',
    prompt: 'Summarize in ' + api.v1.config.get('sentences') + ' sentences, keeping names and facts:\\n\\n' + text,
    maxTokens: 400,
  });

api.v1.ui.register({
  type: 'toolbarButton',
  id: 'memory',
  label: 'Summarize into Memory',
  onClick: async () => {
    const text: string = await api.v1.document.text();
    if (!text.trim()) return api.v1.ui.toast('The story is empty.');
    const { text: summary } = await ask(text.slice(-12000));
    const story = await api.v1.story.get();
    const marker = '[ Summary ]';
    const memory = story.memory.split(marker)[0].trimEnd();
    await api.v1.story.set({ memory: (memory ? memory + '\\n' : '') + marker + '\\n' + summary.trim() });
    api.v1.ui.toast('Summary added to Memory.', 'success');
  },
});

api.v1.ui.register({
  type: 'toolboxOption',
  id: 'summarize',
  label: 'Summarize',
  description: 'Summarize the selection.',
  onRun: async ({ text }: { text: string }) => (await ask(text)).text.trim(),
});
`;

const RETRY_HARDER = `/*@meta
{
  "name": "Retry Harder",
  "description": "Retry with more randomness: each press raises the temperature a little for one generation.",
  "author": "NovelWriter",
  "version": "1.0",
  "permissions": ["presetEdit", "documentEdit"]
}
*/
let boost = 0;
let original = null;

api.v1.ui.register({
  type: 'toolbarButton',
  id: 'retry',
  label: 'Retry Harder',
  onClick: async () => {
    const params = await api.v1.params.get();
    if (original === null) original = params.temperature;
    boost = Math.min(boost + 0.15, 0.9);
    await api.v1.params.set({ temperature: original + boost });
    api.v1.ui.toast('Temperature ' + (original + boost).toFixed(2));
    await api.v1.document.undo();
    await api.v1.editor.generate();
  },
});

// Put the temperature back after the boosted generation.
api.v1.hooks.register('onGenerationEnd', async () => {
  if (original !== null) {
    await api.v1.params.set({ temperature: original });
    original = null;
    boost = 0;
  }
});
`;

const QUOTES = `// Straighten curly quotes in AI output, and log the context size.
api.v1.hooks.register('onResponse', ({ text }) => ({ text: text.replace(/[“”]/g, '"').replace(/[‘’]/g, "'") }));
api.v1.hooks.register('onContextBuilt', ({ context }) => {
  api.v1.log('context length', context.length);
});
`;

export const EXAMPLES: ExampleScript[] = [
  { name: 'Find & Replace (script)', description: 'Window with find/replace fields and a toolbar button.', language: 'js', code: FIND_REPLACE },
  { name: 'Bookmarks', description: 'Context menu button, sidebar panel, editor markers, story storage.', language: 'js', code: BOOKMARKS },
  { name: 'Smart Summarizer', description: 'Generation, Memory editing, a Writer’s Toolbox option (TypeScript).', language: 'ts', code: SUMMARIZER },
  { name: 'Retry Harder', description: 'Generation settings, undo and generate from a toolbar button.', language: 'js', code: RETRY_HARDER },
  { name: 'Straight Quotes', description: 'The smallest possible script: two hooks.', language: 'js', code: QUOTES },
];

export const NEW_SCRIPT = `/*@meta
{
  "name": "New Script",
  "description": "",
  "permissions": [],
  "config": []
}
*/
// Hooks: onScriptsLoaded, onGenerationRequested, onBeforeContextBuild, onContextBuilt({ system, context }),
// onResponse({ text }), onGenerationEnd({ text }), onLorebookEntrySelected({ entryId }),
// onTextAdventureInput({ text, mode }), onHistoryNavigated({ action, nodeId }).
// Return an object with the fields you want to change. See the API reference in the Info tab.

api.v1.hooks.register('onResponse', ({ text }) => {
  return { text };
});
`;
