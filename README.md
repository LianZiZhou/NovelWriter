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

## Desktop app

NovelWriter also ships as a desktop app for Windows, macOS and Linux. It runs the same server inside
the app (on `127.0.0.1`, with a random port and a per-launch password, so other programs and web pages
cannot use your stored credentials) and shows the UI in its own window. Login links, device-code pages
and other external links open in your normal browser. The window has its own title bar in the app's theme
(story title, app menu and window buttons on Windows and Linux; the native traffic lights on macOS).

### Download

Get the installer for your system from the
[Releases page](https://github.com/LianZiZhou/NovelWriter/releases):

| System | File |
|---|---|
| Windows (x64) | `NovelWriter-Setup-<version>-x64.exe` (installer, lets you pick the folder) or `NovelWriter-Portable-<version>-x64.exe` (no install) |
| macOS (Apple Silicon / Intel) | `NovelWriter-<version>-arm64.dmg` / `NovelWriter-<version>-x64.dmg` (`.zip` versions too) |
| Linux (x64) | `NovelWriter-<version>-x86_64.AppImage` (`chmod +x`, then run) or `novelwriter_<version>_amd64.deb` (`sudo apt install ./novelwriter_*.deb`) |

The builds are not signed with a paid certificate, so the first launch needs one extra step:

- **macOS** (Gatekeeper says the app "cannot be opened" or "is damaged"): move it to Applications,
  then right-click it and choose **Open**, or allow it under **System Settings → Privacy & Security →
  Open Anyway**. If macOS still refuses, run `xattr -dr com.apple.quarantine /Applications/NovelWriter.app`.
- **Windows** (SmartScreen "Windows protected your PC"): click **More info → Run anyway**.

### Where your data is stored

Stories, presets, settings and credentials (`auth.json`) live in a `data` folder inside the app's
user-data directory (**Help → Open Data Folder** opens it):

| System | Folder |
|---|---|
| Windows | `%APPDATA%\NovelWriter\data` |
| macOS | `~/Library/Application Support/NovelWriter/data` |
| Linux | `~/.config/NovelWriter/data` (or `$XDG_CONFIG_HOME/NovelWriter/data`) |

Set `NOVELWRITER_DATA` to use another folder, for example the `data` folder of a server install.
Uninstalling keeps this folder.

### Building it yourself

```bash
npm install
npm run desktop:dev    # build the web UI, bundle the main process and start Electron
npm run desktop:dist   # installers for the current OS in apps/desktop/release/
```

`desktop:dist` builds what the current OS supports: NSIS installer + portable exe on Windows, dmg + zip
(x64 and arm64) on macOS, AppImage + deb on Linux. The Electron main process and the whole server
(`apps/server`, `packages/core` and their dependencies) are bundled into one file with esbuild
(`apps/desktop/scripts/bundle.mjs`); the web UI is copied into the app's resources. On Linux,
`xvfb-run -a npm run smoke -w @novelwriter/desktop` runs a smoke test against the bundle (pass the path
of a packaged executable to test that instead).

`.github/workflows/desktop.yml` builds on Windows, macOS and Linux. Every push to `main` that touches the
app publishes a GitHub Release tagged with the short commit hash (app version `0.1.<run number>`) with the
installers attached; tagging a commit `v*` publishes a release with that version. Other branches and pull
requests run the same build and keep the installers as workflow artifacts for 3 days. Code signing is optional: add the `MAC_CSC_LINK` /
`MAC_CSC_KEY_PASSWORD` (plus `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` for notarization)
or `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD` secrets to sign; without them the macOS app is ad-hoc signed and
the Windows installer is unsigned.

## Features

- **Editor**: text colored by origin (prompt, AI, edited, user), Send (Ctrl+Enter), Retry
  (Alt+R), Undo/Redo over a branching history, retry-option picker, a visual history tree,
  inline generation at the cursor (Ctrl+Shift+Enter, optionally bidirectional), streaming,
  find & replace (match case, regex), bold/italic/underline/strikethrough, speech highlighting,
  `{ instruction }` lines and `##` comment lines, a selection toolbar (formatting, inline
  generation, TTS, Writer's Toolbox), and a right-click menu (special characters, add to
  Memory/Author's Note/a new or existing lore entry/Side Chat, Generate Lore… by type,
  Writer's Toolbox, tokenize, screenshot, TTS).
- **Director**: an agent that runs the writing session (right sidebar, see below). Give it a goal or a
  one-line book idea; it plans, has the writing model write passage by passage, and keeps Memory, the
  Lorebook, the Author's Note and an outline up to date, with pause, interjections, approvals and undo.
- **Side Chat**: per-story chats with the model about the story (right sidebar), with excerpts
  from the recent story, a selection or a lore entry; nothing is written into the story.
- **New stories** ask for Genre & Tags and a `[ S: n ]` style tag for the ATTG line; title
  generation keeps a Title Generation History.
- **Story panel**: storyteller / text-adventure mode, model and preset pickers, Memory,
  Author's Note, Lorebook quick search, story stats, trim/flatten/reset, export to
  `.story`, NovelAI `.story` ("For NovelAI"), `.scenario`, plain text, clipboard or image.
- **Context**: NovelAI-style context assembly (insertion order, reserved tokens, token budgets,
  insertion position, trim direction and maximum trim type), ATTG line, ephemeral context
  (`{+3~10,-2:text}` relative or `{12~10,-2:text}` absolute steps, also typed straight into the
  story), a context viewer with stages and inclusion reasons, editable context
  settings, system prompt and prefill.
- **Lorebook**: entries with plain, `/regex/` and `A & B` keys (click a key to edit it), search range up to
  50,000 characters, Always On, hidden entries (Reveal Entry), cascading activation, key-relative insertion
  (works whatever the budget order), Order by Key Location, categories (enable/disable, entry headers,
  default entry and placement settings with Update All Entries, subcontexts, bias when all entries are
  inactive, Delete Containing Entries), phrase bias per entry/category, advanced conditions (AND/OR/NOT,
  keyword match in the story, active entries, Memory or Author's Note with a range, equations evaluated
  left to right, random, numeric and string comparisons; up to 30 activation passes), an AI lore generator
  (custom types, other entries as context, saved history), multiselect export/PNG/delete, a welcome page,
  a docked side-panel mode, import/export (NovelAI `.lorebook` JSON compatible, SillyTavern World Info and
  character books, Agnai memory books, AI Dungeon World Info) and PNG embedding.
- **Generation settings**: presets (built-in and custom, import/export), randomness, output
  length, context size, sampler order and toggles, repetition penalties.
- **Phrase bias, banned phrases, stop sequences, Avoid Overused Words.**
- **Writer's Toolbox**: retry, transform, expand, condense, rewrite style, infill at the cursor and
  custom instructions, with strength/length settings and Adjust (run again on the result).
- **Text Adventure**: Do / Say / Story input with the usual shortcuts (`l`, `i`, `n`, `x door`,
  `!`, `"`…).
- **Scenarios** with `${placeholder[default]:description}` fields and `%{1key[default]:Label:Description}`
  definitions; placeholders work in the story, Memory, Author's Note, system prompt, prefill, ephemeral
  context, category headers and lore entries/keys. The import dialog shows where each one is used and
  can fill or keep them. 16 original built-in scenarios with a searchable browser.
- **Library**: shelves with names, descriptions and nested shelves, drag stories onto a shelf (or back out),
  search the whole library or one shelf, favorites, sort by recent/alphabetical/creation date, and
  Download All Stories as a `.zip`.
- **Import** (drop files on the window or use Import File): NovelAI `.story` (fragment-based and the
  current document format with its full undo/redo tree, branches, text origins, bold/italic/underline/
  strikethrough, action/dialogue/instruction paragraphs, settings, Memory/AN, lorebook advanced conditions,
  phrase bias, banned sequences, system prompt/prefill, Side Chats and script storage), `.scenario` (incl. phrase bias,
  banned tokens, ephemeral context, sampler settings), `.lorebook`, `.preset`/`.gensettings`, `.bias`,
  `.badwords`, `.module` (as a style note; trained modules can't run), KoboldAI saves, AI Dungeon
  adventures/scenarios, SillyTavern/Agnai lorebooks, plain text and PNG-embedded lorebooks.
- **User scripts**: story and account scripts in JavaScript or TypeScript with a full API (see below).
- **Screenshot Designer** (title, date, pen name, logo, colours, legend, model, background,
  comment, speech highlighting; PNG, JPG or clipboard).
- **Text to speech**: browser voices or any OpenAI-compatible `/audio/speech` endpoint (OpenAI, Kokoro-FastAPI,
  openedai-speech…; the key stays on the server), streamed sentence by sentence, with saved voices, a HypeBot
  voice, Speak Inputs/Outputs and Download Spoken.
- **Context Viewer** with stages, inclusion and activation reasons, and the final request in message format
  (System/User/Assistant); **Tokenizer** with o200k or the current model's own tokenizer and id decoding;
  **Story Statistics** with data blocks and deleted characters; an **interactive tutorial**.
- **Hypebot** (click its avatar for a new comment), **19 themes** plus a theme editor, custom CSS,
  rebindable hotkeys, a command palette (Ctrl+K), English and Simplified Chinese UI,
  drag-and-drop import, mobile layout.

### Director

The Director tab (film-slate icon in the right sidebar) automates the loop of Send, Retry, editing Memory and adding
lore entries. A tool-calling "director" model plans and steers; every passage is still written by the story's own
model through the normal context (Memory, Author's Note, lorebook, recall, budgets), with the director's direction for
that passage added to the Author's Note.

- **Writing Session**: continue the story toward a goal (a scene, a chapter, a length). **Whole Book**: premise →
  world → cast → outline → chapters → review, from one idea; the outline and chapter progress show in the panel and
  chapter boundaries are plain heading lines in the text.
- Tools: read the story, the context report and the lorebook; write a passage; rewrite or insert text; start a
  chapter; set story info, Memory, the Author's Note, lorebook entries and the outline; update the running summary;
  ask an editor's critique; keep a plan; ask the author; finish.
- **Trust levels** per kind of action (automatic, ask first, never), for all stories or one. Approvals appear as
  cards in the panel with a before/after preview; a rejection (with an optional note) goes back to the director.
- **Undo**: text changes are ordinary history steps; Memory, Author's Note, lorebook, outline and story-info changes
  are recorded with their previous value and undo from the activity list (with a warning if they changed again).
  **Roll back to here** returns everything to a turn boundary; abandoned text stays in the history as a branch.
- **Pause** stops after the current step, **Stop** cuts off the passage being written, and messages typed while it
  runs reach the director before its next move. Edits you make in the meantime are reported to it. Runs are saved
  with the story and resume where they left off; budgets cap turns, passages and characters.
- Models without native tool calling (local text-completion servers) get the tools described in the prompt and
  answer with fenced `tool` blocks. The offline Demo model runs a scripted session, so the feature can be tried
  without an AI provider. Pick the director model in the panel's settings (default: the story's model).

### User scripts

Scripts extend NovelWriter (Advanced → Edit User Scripts). Each enabled script runs in its own sandbox: a hidden
iframe with an opaque origin and a Content-Security-Policy that blocks all network access (fetch, WebSocket,
EventSource, importScripts), which runs the script in a Worker. A script keeps its state between hooks, cannot
touch the page, your providers or the network, and talks to NovelWriter only through `api.v1`:

- **Hooks**: `onScriptsLoaded`, `onGenerationRequested` (can cancel), `onBeforeContextBuild`, `onContextBuilt`
  (change the system prompt and context), `onResponse` (change the AI text), `onGenerationEnd`,
  `onLorebookEntrySelected`, `onTextAdventureInput`, `onHistoryNavigated`.
- **APIs**: document paragraphs and edits, undo/redo, selection, generate / generate with the story context,
  Memory / Author's Note / system prompt / prefill, generation settings, lorebook CRUD, tokenizer, TTS,
  storage (per script, per story, per history step, temporary), timers, random and dice, messaging between
  scripts, toasts, clipboard, file download, HypeBot comments, config values.
- **UI**: right-click menu buttons, a toolbar row above Send, Writer's Toolbox options, right-sidebar and lorebook
  panels, and windows built from parts (row, column, box, Markdown text, button, inputs, checkbox, slider,
  select, collapsible); editor decorations by regex rule or by range (CSS limited to a safe list).
- **Permissions** are declared in a `/*@meta { … } */` JSON block (`documentEdit`, `storyEdit`, `lorebookEdit`,
  `presetEdit`, `editorDecorations`, `clipboardWrite`, `fileDownload`) and asked for on first use. The block also
  declares config fields, shown on the Config tab.
- **Limits**: a hook that stays busy for 5 seconds (outside API calls) restarts the script; 20 generations a
  minute and 3 without user interaction; 1 MB of storage. Add `?noscript=true` to the address to start with every
  script off.
- The editor has Info (with an API reference), Code, Config, Storage, Logs and Diagnostics tabs, import/export
  as `.nwscript`, and five examples: Find & Replace, Bookmarks, Smart Summarizer (TypeScript), Retry Harder and
  Straight Quotes.

### Generation settings

- **Randomness** (temperature): below 1 keeps the text consistent; above 1 makes it more surprising.
- **Output Length**: about how many characters one Send writes (converted to a token limit).
- **Context Size**: the most tokens of story, Memory, Author's Note and lore sent per request.
- **Samplers** (Top-K, Nucleus, Tail-Free, Top-A, Typical, Min-P, Mirostat, Unified): each trims unlikely tokens
  before one is picked, in the order set in *Change Samplers*.
- **Repetition Penalty** (Range, Slope), **Phrase Repetition Penalty** (sent as DRY sampling) and
  **Presence / Frequency** discourage repeating recent tokens or phrases.
- **Logit Bias** (phrase bias) and **Banned Tokens** raise or lower specific tokens.
- **Token Probabilities** (Settings → AI Settings) show the alternatives the model considered for each token.
  Click a token in the editor (*Editor Token Probabilities*) to pick one; the story continues from there.

What reaches the model depends on the server behind it. The Generation tab only shows the settings the
current model takes. For custom endpoints, choose the *Server type* in Settings → AI Providers.

| Server | Samplers sent | Sampler order | Logit bias | Token probabilities |
|---|---|---|---|---|
| llama.cpp | temperature, Top-K, Nucleus, Min-P, Typical, Mirostat, repetition penalty + range, presence/frequency, DRY | yes | yes (server tokenizer) | yes |
| KoboldCpp | all of the above plus Top-A, Tail-Free, Unified (smoothing), slope | yes | yes | yes |
| TabbyAPI | like KoboldCpp, plus min tokens | no | yes | yes |
| vLLM | temperature, Top-K, Nucleus, Min-P, repetition penalty, presence/frequency, min tokens | no | yes | yes |
| OpenRouter | temperature, Top-K, Nucleus, Top-A, Min-P, repetition penalty, presence/frequency | no | no | yes |
| OpenAI | temperature, Nucleus, presence/frequency | no | yes (o200k) | yes |
| Other OpenAI-compatible | temperature, Nucleus, presence/frequency | no | no | no |
| Claude, Gemini, Bedrock and other chat APIs | temperature | no | no | no |

Reasoning models set their own sampling, so nothing above is sent to them: OpenAI's o-series, GPT-5 and Codex
models (including ChatGPT/Codex login and GitHub Copilot), and any model whose thinking can't be turned off
(Gemini aside, which still takes a temperature). If a provider still refuses a setting, NovelWriter drops the
setting it names, retries, and stops sending it to that model.

Where logit bias isn't available, phrase bias and banned phrases become instructions in the system prompt, and
banned phrases are also removed from the output. As on NovelAI's chat models, only the first token of a biased
phrase is biased. Stop sequences beyond what an API accepts are applied to the output.

### Differences from NovelAI

pi-ai talks to chat models, so continuation runs through a chat request. The assembled context is the user
message, with instructions in the system prompt. Token counts use the o200k tokenizer as an approximation.

## Development

```bash
npm test            # unit + server tests (vitest)
npm run typecheck
npm run e2e         # browser end-to-end test against `npm run dev` (uses the demo model)
node scripts/capture-reference.mjs   # screenshots of novelai.net for UI comparison (to reference/)
node scripts/capture-app.mjs         # screenshots of this app in the same states
node scripts/visual-compare.mjs      # side-by-side images in reference/compare/
npx tsx scripts/perf.mjs [baseUrl] [sizes]   # editor timings on generated long stories
```

### Long stories

The editor stays responsive on stories of a million characters:
- **Edits:** each one is computed from ProseMirror's structural diff, so only the paragraphs that changed are
  converted and diffed.
- **Decorations:** they are updated per paragraph.
- **Off-screen paragraphs:** they are not laid out (*Paragraph Visibility Range* in Settings → Interface).
- **Context building:** it only tokenizes the part of the story that can fit.

Measured with `scripts/perf.mjs` in the dev build (headless Chromium), in milliseconds:

| Story | Keystroke p50 / p95 | Context build |
|---|---|---|
| 2,000 chars | 11 / 19 | — |
| 1,000,000 chars, before | 140 / 199 | 980 |
| 1,000,000 chars, now | 19 / 30 | 73 |

The keystroke figures run from the input event to the next frame, so about 11 ms of each is waiting for that
frame.

Layout: `packages/core` (context builder, lorebook, history, formats; no DOM),
`apps/server` (Fastify + pi-ai), `apps/web` (React UI), `apps/desktop` (Electron app).

## License

NovelWriter is licensed under the [GNU Affero General Public License v3.0 or later](LICENSE)
(`AGPL-3.0-or-later`). If you run a modified version as a network service, you must offer its users the
source code of that version.

NovelWriter is an independent project and is not affiliated with, endorsed by or sponsored by NovelAI or
Anlatan. NovelAI is a trademark of its respective owner.
