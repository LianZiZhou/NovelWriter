/** Items for the Dashboard "Latest News" carousel (our own release notes). */
export const NEWS: { tag: 'Update' | 'Tip' | 'New'; title: string; body: string; fresh?: boolean }[] = [
  {
    tag: 'Update',
    title: 'Sign in with your own AI subscription',
    body: 'NovelWriter now connects through pi-ai: sign in with Claude Pro/Max, ChatGPT, GitHub Copilot or OpenRouter, paste an API key, or point it at a local OpenAI-compatible server.',
    fresh: true,
  },
  {
    tag: 'New',
    title: 'User Scripts',
    body: 'Rewrite the context before it is sent and the AI response after it arrives with sandboxed scripts. Find them in the Advanced tab of any story.',
  },
  {
    tag: 'Tip',
    title: 'Lorebook keys that think',
    body: 'Lorebook keys accept /regular expressions/ and "A & B" combinations, and Advanced Conditions can activate entries by story step, random chance or other entries.',
  },
];
