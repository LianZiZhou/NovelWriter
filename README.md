# NovelWriter

An AI writing studio modeled on the NovelAI story editor, built with **React + TipTap** on the
front end and a **Node (Fastify)** back end that talks to models through
[pi-ai](https://www.npmjs.com/package/@earendil-works/pi-ai). Bring your own model access: sign
in with a subscription (OAuth), paste an API key, or point it at a local OpenAI-compatible server.

## Quick start

```bash
npm install
npm run dev        # server on :8787, web UI on http://127.0.0.1:5173
```

For a single-process production build:

```bash
npm start          # builds the web app and serves it from the server on http://127.0.0.1:8787
```

With no account connected you can still try everything with the built-in **Demo (offline)** model.

### Connecting models

Open **Settings → AI Providers** (or the person icon in the left sidebar).

- **Sign in (OAuth)** with Anthropic (Claude Pro/Max), OpenAI Codex (ChatGPT Plus/Pro),
  GitHub Copilot, OpenRouter, xAI and others. The login runs on the server (pi-ai login flows
  are Node-only); the browser shows the login link, device code, or code prompt as needed.
  Callback-based logins redirect to `localhost`, so run the server on the same machine as your
  browser for those, or paste the redirect URL into the prompt.
- **API keys** for OpenAI, Anthropic, Google, DeepSeek, Mistral, Groq, OpenRouter, and every
  other pi-ai provider.
- **Custom OpenAI-compatible endpoints** (Ollama, LM Studio, vLLM, llama.cpp…). Use *Fetch
  models* to list what the server offers. All samplers (Top-K, Min-P, Typical, TFS, Mirostat,
  repetition penalty…) are sent to these endpoints.

Credentials are stored in `data/auth.json` on the server and never sent to the browser.

### Configuration

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8787` | Server port |
| `HOST` | `127.0.0.1` | Bind address |
| `NOVELWRITER_DATA` | `./data` | Stories, presets, settings, credentials |
| `NOVELWRITER_PASSWORD` | – | Require HTTP Basic auth (any username). **Set this before exposing the server beyond localhost.** |

## Features

- **Editor**: text colored by origin (prompt, AI, edited, user), Send (Ctrl+Enter), Retry
  (Alt+R), Undo/Redo over a branching history, retry-option picker, a visual history tree,
  inline generation at the cursor (Ctrl+Shift+Enter), streaming, find, bold/italic/underline/
  strikethrough, speech highlighting, a right-click menu (special characters, add to
  Memory/Author's Note/Lorebook, Writer's Toolbox, tokenize, screenshot, TTS).
- **Story panel**: storyteller / text-adventure mode, model and preset pickers, Memory,
  Author's Note, Lorebook quick search, story stats, trim/flatten/reset, export to
  `.story`, `.scenario`, plain text, clipboard or image.
- **Context**: NovelAI-style context assembly (insertion order, reserved tokens, token budgets,
  insertion position, trim direction and maximum trim type), ATTG line, ephemeral context
  (`{+3~10,-2:text}`), a context viewer with stages and inclusion reasons, editable context
  settings, system prompt and prefill.
- **Lorebook**: entries with plain, `/regex/` and `A & B` keys, search range, Always On,
  hidden entries, cascading activation, key-relative insertion, categories with subcontexts,
  entry headers and defaults, phrase bias per entry/category, advanced conditions
  (AND/OR/NOT, keyword, random, numeric and string comparisons…), an AI lore generator,
  import/export (NovelAI `.lorebook` JSON compatible) and PNG embedding.
- **Generation settings**: presets (built-in and custom, import/export), randomness, output
  length, context size, sampler order and toggles, repetition penalties.
- **Phrase bias, banned phrases, stop sequences, Avoid Overused Words.**
- **Writer's Toolbox**: rewrite, transform, expand, condense and custom instructions.
- **Text Adventure**: Do / Say / Story input with the usual shortcuts (`l`, `i`, `n`, `x door`,
  `!`, `"`…).
- **Scenarios** with `${placeholder[default]:description}` fields.
- **User scripts**: sandboxed hooks to rewrite the context and the AI response.
- **Hypebot**, browser **text-to-speech**, **19 themes** plus a theme editor, custom CSS,
  rebindable hotkeys, a command palette (Ctrl+K), English and Simplified Chinese UI,
  drag-and-drop import, mobile layout.

### Differences from NovelAI

pi-ai talks to chat models, so continuation runs through a chat request. The assembled context is
the user message, with instructions in the system prompt. Samplers that the provider's API doesn't
accept are kept in presets but not sent. Phrase bias and banned phrases become prompt instructions,
and banned phrases are also stripped from the output. Token probabilities are not available through
these APIs. Token counts use the o200k tokenizer as an approximation.

## Development

```bash
npm test            # unit + server tests (vitest)
npm run typecheck
npm run e2e         # browser end-to-end test against `npm run dev` (uses the demo model)
node scripts/capture-reference.mjs   # screenshots of novelai.net for UI comparison (to reference/)
node scripts/capture-app.mjs         # screenshots of this app in the same states
node scripts/visual-compare.mjs      # side-by-side images in reference/compare/
```

Layout: `packages/core` (context builder, lorebook, history, formats; no DOM),
`apps/server` (Fastify + pi-ai), `apps/web` (React UI).
