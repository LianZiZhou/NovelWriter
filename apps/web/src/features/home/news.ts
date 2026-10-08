/** Items for the Dashboard "Latest News" carousel (our own release notes). */
/** Also shown in Settings → Change Log; `id` marks what the user has seen. */
export const NEWS: { id: string; date: string; tag: 'Update' | 'Tip' | 'New'; title: string; body: string; fresh?: boolean }[] = [
  {
    id: 'round3-writing',
    date: '2026-10-08',
    tag: 'New',
    title: 'Everything for writing, in one place',
    body: 'Long stories stay fast. Token probabilities, logit bias and sampler order now reach the models that support them. New: Side Chat, Find & Replace, instruction lines, Infill and Rewrite Style in the Writer\'s Toolbox, a docked Lorebook with equations and keyword locations, nested shelves, NovelAI/KoboldAI/AI Dungeon/SillyTavern imports, speech endpoints for text to speech, and an interactive tutorial.',
    fresh: true,
  },
  {
    id: 'ui-fidelity',
    date: '2026-10-08',
    tag: 'Update',
    title: 'A closer match to the editor you know',
    body: 'Dashboard, account menu, filters, redo list, rich model picker, Story Statistics, Context Viewer, the Text Adventure input and every settings page were rebuilt to follow the original layout, with new Interface options such as the selection toolbar, lorebook key underlines and the minibar.',
  },
  {
    id: 'pi-ai',
    date: '2026-10-01',
    tag: 'Update',
    title: 'Sign in with your own AI subscription',
    body: 'NovelWriter now connects through pi-ai: sign in with Claude Pro/Max, ChatGPT, GitHub Copilot or OpenRouter, paste an API key, or point it at a local OpenAI-compatible server.',
  },
  {
    id: 'user-scripts',
    date: '2026-10-01',
    tag: 'New',
    title: 'User Scripts',
    body: 'Rewrite the context before it is sent and the AI response after it arrives with sandboxed scripts. Find them in the Advanced tab of any story.',
  },
  {
    id: 'lore-keys',
    date: '2026-10-01',
    tag: 'Tip',
    title: 'Lorebook keys that think',
    body: 'Lorebook keys accept /regular expressions/ and "A & B" combinations, and Advanced Conditions can activate entries by story step, random chance or other entries.',
  },
];
