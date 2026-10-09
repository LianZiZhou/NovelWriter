import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowCounterClockwise, CaretDown, CaretUp, Check, DownloadSimple, Eyedropper, GearSix, Plus, SpeakerHigh, Stop, X } from '@phosphor-icons/react';
import { exportStoryFile, uid } from '@novelwriter/core';
import { api, type TTSConfig } from '../../api.ts';
import { DEFAULT_HOTKEYS, DEFAULT_SETTINGS, useSettings, type SavedVoice, type Settings } from '../../store/settings.ts';
import { download, useStory } from '../../store/story.ts';
import { useUI } from '../../store/ui.ts';
import { t } from '../../i18n.ts';
import { Modal, SegmentedControl, Select, SliderSetting, ToggleRow } from '../../components/ui.tsx';
import { BUILTIN_THEMES, type Theme, type ThemeColors } from '../../theme/themes.ts';
import { downloadSpeech, listVoices, speak, stopSpeaking } from '../tts/tts.ts';
import { AvatarTile, HYPEBOT_AVATARS } from '../hypebot/avatars.tsx';
import { ModelThumb } from '../../components/ModelThumb.tsx';
import { NEWS } from '../home/news.ts';
import { ModelSelect } from '../right/ModelSelect.tsx';
import { ProvidersTab } from './ProvidersTab.tsx';
import { EmbeddingsTab } from './EmbeddingsTab.tsx';
import { NlpTab } from './NlpTab.tsx';
import { FIXED_HOTKEYS, HOTKEY_LABELS, hotkeyParts } from '../../hotkeys.ts';

type Tab = 'ai' | 'interface' | 'theme' | 'tts' | 'defaults' | 'hotkeys' | 'providers' | 'embeddings' | 'nlp' | 'about';

const TITLES: Record<Tab, string> = {
  ai: 'AI Settings',
  interface: 'Interface',
  theme: 'Theme',
  tts: 'Text To Speech',
  defaults: 'Defaults',
  hotkeys: 'Hotkeys',
  providers: 'AI Providers',
  embeddings: 'Vector Search',
  nlp: 'Text Analysis',
  about: 'Support',
};

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <div className="settings-group-title">{t(title)}</div>
      <div className="settings-grid">{children}</div>
    </>
  );
}

/** Learned token ratios per model, so the context is sized in each model's own tokens. */
function TokenCalibrationSetting() {
  const s = useSettings();
  const entries = Object.entries(s.tokenCalibration).sort((a, b) => b[1].at - a[1].at);
  return (
    <div>
      <ToggleRow
        title={t('Calibrate Token Counts')}
        desc={
          s.calibrateTokens
            ? t("The context is sized in each model's own tokens, learned from the token counts the provider reports (and from a local server's tokenizer), instead of an estimate.")
            : t('The context is sized with the built-in tokenizer, which can be off by 10–40% for some models.')
        }
        on={s.calibrateTokens}
        onChange={(v) => s.set({ calibrateTokens: v })}
      />
      {s.calibrateTokens && entries.length > 0 && (
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {entries.slice(0, 8).map(([key, c]) => (
            <div key={key} className="row between desc" style={{ fontSize: 13 }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{key}</span>
              <span>
                ×{c.ratio.toFixed(2)} · {c.source === 'usage' ? t('{n} requests', { n: c.samples }) : t('tokenizer')}
              </span>
            </div>
          ))}
          <div>
            <button type="button" className="btn small" onClick={() => s.set({ tokenCalibration: {} })}>
              {t('Reset Calibration')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function AITab() {
  const s = useSettings();
  return (
    <>
      <Group title="AI Responses">
        <ToggleRow title={t('Stream AI Responses')} desc={s.streamResponses ? t('AI responses will be streamed, appearing token by token.') : t('Text will only appear when the response has been fully generated.')} on={s.streamResponses} onChange={(v) => s.set({ streamResponses: v })} />
        <ToggleRow title={t('Continue Response to End of Sentence')} desc={s.continueToSentenceEnd ? t('Responses will attempt to continue until the end of a sentence is found.') : t('Responses may end in the middle of a sentence.')} on={s.continueToSentenceEnd} onChange={(v) => s.set({ continueToSentenceEnd: v })} />
        <ToggleRow
          title={t('Bidirectional Inline Generation')}
          desc={s.bidirectionalInline ? t('Inline generation will also consider the text after the cursor, so the new text bridges into it.') : t('Inline generation will only consider the text before the cursor.')}
          on={s.bidirectionalInline}
          onChange={(v) => s.set({ bidirectionalInline: v })}
        />
        <SliderSetting title={t('Streamed Response Delay')} value={s.streamDelay} min={0} max={20} step={1} def={0} onChange={(v) => s.set({ streamDelay: v })} />
      </Group>
      <Group title="Hypebot">
        <div>
          <div className="heading" style={{ marginBottom: 8 }}>{t('Comment Output')}</div>
          <SegmentedControl
            value={s.hypebotMode}
            onChange={(v) => s.set({ hypebotMode: v })}
            options={[
              { value: 'off', label: t('Off') },
              { value: 'automatic', label: t('Automatic') },
              { value: 'permanent', label: t('Permanent') },
            ]}
          />
        </div>
        <div>
          <div className="heading" style={{ marginBottom: 8 }}>{t('Comment Avatar')}</div>
          <Select
            rich
            className="avatar-select"
            value={s.hypebotAvatar}
            onChange={(v) => s.set({ hypebotAvatar: v })}
            ariaLabel={t('Comment Avatar')}
            options={[
              { value: 'auto', label: t('Auto-Select'), image: <span className="avatar-auto">{HYPEBOT_AVATARS.slice(0, 2).map((a) => <AvatarTile key={a.id} avatar={a} size={40} />)}</span> },
              ...HYPEBOT_AVATARS.map((a) => ({ value: a.id, label: t(a.label), image: <AvatarTile avatar={a} size={40} /> })),
            ]}
          />
        </div>
        <SliderSetting title={t('Comment Chance')} value={s.hypebotChance} min={0} max={100} step={1} def={5} onChange={(v) => s.set({ hypebotChance: v })} suffix=" %" defText={t('Default: {v}', { v: '5%' })} />
        <SliderSetting title={t('Comment Streamed Response Delay')} value={s.hypebotDelay} min={0} max={20} step={1} def={0} onChange={(v) => s.set({ hypebotDelay: v })} />
        <div>
          <button type="button" className="btn" onClick={() => useStory.setState({ hypebot: null })}>
            {t('Clear Comments')}
          </button>
          <div className="desc" style={{ marginTop: 6 }}>{t("Click HypeBot's avatar next to a comment to ask for a new one.")}</div>
        </div>
      </Group>
      <Group title="Experimental">
        <ToggleRow
          title={t('Structured Prompts')}
          desc={
            s.promptLayout === 'classic'
              ? t("The context is sent to chat models as one block of text, exactly as NovelAI's own models see it.")
              : t("Chat models get Memory and lorebook entries as background in the system prompt and see the story as their own earlier replies, with your adventure actions as your turns and the Author's Note at the end. Models that allow it continue the story's last lines word for word.")
          }
          on={s.promptLayout !== 'classic'}
          onChange={(v) => s.set({ promptLayout: v ? 'structured' : 'classic' })}
        />
        <ToggleRow title={t('Preamble')} desc={s.preamble ? t('The context will have a small preamble prepended to improve generations on low context. The exact behaviour varies per model.') : t('No preamble will be added to the context.')} on={s.preamble} onChange={(v) => s.set({ preamble: v })} />
        <ToggleRow
          title={t('Show System Prompt Settings')}
          desc={s.showSystemPromptSettings ? t('The System Prompt and Prefill can be edited from the Advanced tab.') : t('The System Prompt button is hidden; the default system prompt is used unless a story sets its own.')}
          on={s.showSystemPromptSettings}
          onChange={(v) => s.set({ showSystemPromptSettings: v })}
        />
        <div>
          <SliderSetting
            title={t('Max Context Size')}
            value={s.maxContextCap}
            min={0}
            max={200000}
            step={1000}
            def={0}
            onChange={(v) => s.set({ maxContextCap: v })}
            defText={t('0 = no cap (the preset and model decide)')}
          />
          <div className="desc" style={{ marginTop: 6 }}>{t('Caps the context sent with every request, for every story, e.g. to keep costs or latency down.')}</div>
        </div>
        <TokenCalibrationSetting />
        <ToggleRow title={t('Default Bias')} desc={s.defaultBias ? t('A default bias will be applied, reducing the likelihood of dinkus (***) and asterism (⁂) to be generated.') : t('No default bias will be applied.')} on={s.defaultBias} onChange={(v) => s.set({ defaultBias: v })} />
        <div>
          <ToggleRow
            title={t('Enable Token Probabilities')}
            desc={
              s.tokenProbabilities
                ? t('Token probabilities will be returned with generation requests, on models that report them (OpenAI, OpenRouter, llama.cpp, vLLM, KoboldCpp, TabbyAPI and the demo model).')
                : t('Token probabilities will not be returned with generation requests.')
            }
            on={s.tokenProbabilities}
            onChange={(v) => s.set({ tokenProbabilities: v })}
          />
          {s.tokenProbabilities && (
            <div style={{ marginTop: 14 }}>
              <SliderSetting small title={t('Alternatives per Token')} value={s.logprobsCount} min={1} max={20} step={1} def={10} onChange={(v) => s.set({ logprobsCount: v })} />
            </div>
          )}
        </div>
      </Group>
    </>
  );
}

function InterfaceTab() {
  const s = useSettings();
  const speech = !s.highlightSpeech ? 'off' : s.highlightSpeechInverted ? 'inverted' : 'highlight';
  return (
    <>
      <div className="settings-group-title">{t('UI Language')}</div>
      <div className="settings-grid">
        <Select
          value={s.language}
          onChange={(v) => s.set({ language: v })}
          ariaLabel={t('UI Language')}
          options={[
            { value: 'en', label: 'English' },
            { value: 'zh', label: '简体中文' },
          ]}
        />
      </div>
      <Group title="Text Settings">
        <SliderSetting title={t('Interface Font Size')} value={Math.round(s.uiScale * 16)} min={12} max={22} step={1} def={16} onChange={(v) => s.set({ uiScale: v / 16 })} suffix=" px" defText={t('Default: {v}', { v: '16px' })} />
        <SliderSetting title={t('Output Font Size')} value={s.editorFontSize} min={12} max={30} step={1} def={18} onChange={(v) => s.set({ editorFontSize: v })} suffix=" px" defText={t('Default: {v}', { v: '18px' })} />
        <SliderSetting title={t('Line Spacing')} value={s.lineSpacing} min={1} max={3} step={0.1} def={1.8} onChange={(v) => s.set({ lineSpacing: v })} suffix=" em" defText={t('Default: {v}', { v: '1.8em' })} />
        <SliderSetting title={t('Paragraph Indent')} value={s.paragraphIndent} min={0} max={100} step={1} def={10} onChange={(v) => s.set({ paragraphIndent: v })} suffix=" px" defText={t('Default: {v}', { v: '10px' })} />
        <SliderSetting title={t('Paragraph Spacing')} value={s.paragraphSpacing} min={0} max={3} step={0.1} def={0.5} onChange={(v) => s.set({ paragraphSpacing: v })} suffix=" em" defText={t('Default: {v}', { v: '0.5em' })} />
        <SliderSetting title={t('Button Scale')} value={s.buttonScale} min={0.6} max={1.6} step={0.1} def={1} onChange={(v) => s.set({ buttonScale: v })} />
        <SliderSetting title={t('Max Line Width')} value={s.maxLineWidth} min={40} max={150} step={5} def={100} onChange={(v) => s.set({ maxLineWidth: v })} suffix=" %" defText={t('Default: {v}', { v: '100% (1200px)' })} />
      </Group>
      <Group title="Interaction Settings">
        <ToggleRow title={t('Gesture Controls')} desc={s.gestureControls ? t('Swiping on touch devices will open and close the sidebars.') : t('Swiping will not open or close the sidebars.')} on={s.gestureControls} onChange={(v) => s.set({ gestureControls: v })} />
        <ToggleRow
          title={t('Swap Context Menu Controls')}
          desc={s.swapContextMenu ? t('Right click will open the standard context menu. Ctrl+right click will open the NovelWriter context menu.') : t('Right click will open the NovelWriter context menu. Ctrl+right click will open the standard context menu.')}
          on={s.swapContextMenu}
          onChange={(v) => s.set({ swapContextMenu: v })}
        />
        <ToggleRow title={t('Editor Spellcheck')} desc={s.editorSpellcheck ? t('Spellcheck is enabled in the editor (on supported browsers).') : t('Spellcheck is disabled in the editor.')} on={s.editorSpellcheck} onChange={(v) => s.set({ editorSpellcheck: v })} />
        <ToggleRow title={t('Context Viewer Colors')} desc={s.contextViewerColors ? t('Text in the context viewer will be color coded based on origin.') : t('Text in the context viewer will not be color coded.')} on={s.contextViewerColors} onChange={(v) => s.set({ contextViewerColors: v })} />
        <ToggleRow title={t('Editor Lorebook Keys')} desc={s.editorLoreKeys ? t('Lorebook keys will be underlined in the editor.') : t('No special styling will be applied to Lorebook keys in the editor.')} on={s.editorLoreKeys} onChange={(v) => s.set({ editorLoreKeys: v })} />
        <ToggleRow title={t('Show Story Title')} desc={s.showStoryTitle ? t('The story title will be shown above the editor.') : t('The story title will be hidden.')} on={s.showStoryTitle} onChange={(v) => s.set({ showStoryTitle: v })} />
        <ToggleRow title={t('Show Input Box')} desc={s.inputBox ? t('Type new input in a box next to the Send button instead of the editor.') : t('Type new input directly in the editor.')} on={s.inputBox} onChange={(v) => s.set({ inputBox: v })} />
        <ToggleRow title={t('Show Editor Toolbar')} desc={s.showEditorToolbar ? t('A toolbar with formatting options will appear when selecting text in the editor.') : t('No toolbar will appear when selecting text.')} on={s.showEditorToolbar} onChange={(v) => s.set({ showEditorToolbar: v })} />
        <ToggleRow title={t('Show Tips')} desc={s.showTips ? t('Tips will be shown below the editor.') : t('Tips will not be shown.')} on={s.showTips} onChange={(v) => s.set({ showTips: v })} />
        <ToggleRow title={t('Keyboard Displaces Content')} desc={s.keyboardDisplaces ? t('The onscreen keyboard of some mobile devices will displace the content of the page.') : t('The onscreen keyboard will cover the content of the page.')} on={s.keyboardDisplaces} onChange={(v) => s.set({ keyboardDisplaces: v })} />
        <div>
          <SliderSetting
            title={t('Paragraph Visibility Range')}
            desc={t('Paragraphs scrolled out of view are not laid out or painted, which keeps long stories fast. The set number of characters around the cursor always stays rendered.')}
            value={s.paragraphVisibilityRange || 20000}
            min={500}
            max={20000}
            step={500}
            def={1000}
            onChange={(v) => s.set({ paragraphVisibilityRange: v >= 20000 ? 0 : v })}
            note={!s.paragraphVisibilityRange ? t('No Unloading') : undefined}
          />
        </div>
        <ToggleRow title={t('Auto Format Text')} desc={s.autoFormat ? t('Generated text will be tidied automatically: doubled spaces, trailing spaces and extra blank lines are removed.') : t('Generated text will be inserted as it is.')} on={s.autoFormat} onChange={(v) => s.set({ autoFormat: v })} />
      </Group>
      <Group title="Experimental">
        <div>
          <div className="heading">{t('Highlight Speech')}</div>
          <div className="desc" style={{ marginBottom: 10 }}>
            {t('Choose if speech (text between quotation marks) in the editor should be highlighted in italic and slightly less opaque. When choosing Inverted, non-speech is shown in italic and slightly less opaque instead.')}
          </div>
          <SegmentedControl
            value={speech}
            onChange={(v) => s.set({ highlightSpeech: v !== 'off', highlightSpeechInverted: v === 'inverted' })}
            options={[
              { value: 'off', label: t('Off') },
              { value: 'highlight', label: t('Highlight') },
              { value: 'inverted', label: t('Inverted') },
            ]}
          />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <ToggleRow title={t('Show Identicon')} desc={s.showIdenticon ? t('A generated avatar will be shown in the account menu.') : t('The NovelWriter mark will be shown in the account menu.')} on={s.showIdenticon} onChange={(v) => s.set({ showIdenticon: v })} />
          <ToggleRow title={t('Show Minibar (Desktop Only)')} desc={s.showMinibar ? t('A slim bar with shortcuts will replace the collapsed story library.') : t('The minibar will not be displayed.')} on={s.showMinibar} onChange={(v) => s.set({ showMinibar: v })} />
        </div>
      </Group>
    </>
  );
}

/** Colour rows: [key, label, preset alternatives (besides the base theme's own value)]. */
const COLOR_ROWS: [keyof ThemeColors, string][] = [
  ['textHeadings', 'Header'],
  ['textMain', 'Paragraph'],
  ['warning', 'Warning/Error'],
  ['bg3', 'Foreground'],
  ['bg2', 'Background'],
  ['bg1', 'Dark Background'],
  ['bg0', 'Input Background'],
];
const INTENSITY_ROWS: [keyof ThemeColors, string, string][] = [
  ['lowIntensityColor', 'Low Intensity Color', '#0466ce'],
  ['midIntensityColor', 'Mid Intensity Color', '#009707'],
  ['highIntensityColor', 'High Intensity Color', '#b83700'],
];
const PREVIEW_ROWS: [keyof ThemeColors, string][] = [
  ['textPrompt', 'This is a prompt.'],
  ['textAI', 'This is AI text.'],
  ['textEdit', 'This is edited text.'],
  ['textUser', 'This is new user text.'],
  ['textHighlight', 'This is highlighted text.'],
];

/** A colour picker that looks like the original's white eyedropper swatch. */
function CustomSwatch({ value, active, onChange, label, small }: { value: string; active: boolean; onChange: (v: string) => void; label: string; small?: boolean }) {
  return (
    <label className={`swatch custom ${small ? 'small' : ''}`} style={active ? { background: value } : undefined} title={t('Custom colour')}>
      <input type="color" aria-label={`${label} ${t('custom colour')}`} value={value.slice(0, 7)} onChange={(e) => onChange(e.target.value)} />
      {active && !small ? <Check size={14} weight="bold" className="swatch-check" /> : <Eyedropper size={14} weight="fill" className="swatch-icon" />}
    </label>
  );
}

function ColorRow({ label, k, draft, base, presets, onChange }: { label: string; k: keyof ThemeColors; draft: ThemeColors; base: ThemeColors; presets: string[]; onChange: (v: string) => void }) {
  const value = (draft[k] as string | undefined) ?? (base[k] as string);
  const options = [...new Set([(base[k] as string | undefined) ?? value, ...presets])];
  const custom = !options.some((o) => o.toLowerCase() === value.toLowerCase());
  return (
    <div className="color-row">
      <div className="color-label">{t(label)}</div>
      <div className="swatches">
        {options.map((o) => (
          <button type="button" key={o} className="swatch" style={{ background: o }} aria-label={`${t(label)} ${o}`} aria-pressed={o.toLowerCase() === value.toLowerCase()} onClick={() => onChange(o)}>
            {o.toLowerCase() === value.toLowerCase() && <Check size={14} weight="bold" className="swatch-check" />}
          </button>
        ))}
        <CustomSwatch value={value} active={custom} onChange={onChange} label={t(label)} />
      </div>
    </div>
  );
}

function ThemeTab() {
  const s = useSettings();
  const current = s.theme();
  const [draft, setDraft] = useState<Theme>(structuredClone(current));
  const [cssOpen, setCssOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => setDraft(structuredClone(s.theme())), [s.themeName]);
  const all = [...BUILTIN_THEMES, ...s.customThemes];
  const base = (BUILTIN_THEMES.find((b) => b.name === draft.name.replace(/ \(Custom\)$/, '')) ?? BUILTIN_THEMES[0]).colors;
  const apply = () => {
    const builtin = BUILTIN_THEMES.find((b) => b.name === draft.name);
    const name = builtin && JSON.stringify(draft) !== JSON.stringify(builtin) ? `${draft.name} (Custom)` : draft.name;
    const theme = { ...draft, name };
    s.set({ customThemes: [...s.customThemes.filter((x) => x.name !== name), ...(BUILTIN_THEMES.some((b) => b.name === name) ? [] : [theme])], themeName: name });
  };
  const c = draft.colors;
  const setColor = (k: keyof ThemeColors, v: string) => setDraft({ ...draft, colors: { ...c, [k]: v } });
  const fontOptions = (cur: string, list: string[]) =>
    [cur, ...list].filter((v, i, a) => a.indexOf(v) === i).map((f) => ({ value: f, label: f.split(',')[0].replace(/"/g, '') }));
  return (
    <>
      <div className="row" style={{ gap: 10, marginBottom: 14 }}>
        <button type="button" className="btn theme-action" onClick={apply}>
          {t('Apply & Save Theme')}
        </button>
        <button type="button" className="btn theme-action" onClick={() => fileRef.current?.click()}>
          {t('Import')}
        </button>
        <button type="button" className="btn theme-action" onClick={() => download(`${draft.name}.naitheme`, JSON.stringify(draft, null, 2))}>
          {t('Export')}
        </button>
        <input
          ref={fileRef}
          type="file"
          hidden
          accept=".naitheme,.json"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) await useStory.getState().importFiles([f]);
          }}
        />
      </div>
      <div className="settings-group-title">{t('Default Themes')}</div>
      <div className="theme-cards" style={{ marginBottom: 20 }}>
        {all.map((th) => (
          <button
            type="button"
            key={th.name}
            className={`theme-card ${th.name === s.themeName ? 'active' : ''}`}
            style={{ background: th.colors.bg2 }}
            onClick={() => s.set({ themeName: th.name })}
            aria-pressed={th.name === s.themeName}
          >
            <div className="band" style={{ background: th.colors.bg0 }} />
            <div className="band" style={{ background: th.colors.bg1 }} />
            <div className="label" style={{ color: th.colors.textHeadings, fontFamily: th.fonts.headings }}>
              <span style={{ width: 14, height: 14, borderRadius: 7, background: th.name === s.themeName ? th.colors.textMain : 'transparent', border: `3px solid ${th.colors.bg0}`, outline: `1px solid ${th.colors.textMain}` }} />
              {th.name}
            </div>
          </button>
        ))}
      </div>
      <div className="settings-group-title">{t('Theme Editor')}</div>
      <div className="theme-editor">
        <div className="theme-preview" style={{ color: c.textMain, background: `linear-gradient(90deg, ${c.bg1} 0 56px, ${c.bg2} 56px 112px, ${c.bg3} 112px 156px, ${c.bg2} 156px)` }}>
          <input className="theme-name" style={{ fontFamily: draft.fonts.headings, color: c.textHeadings }} value={draft.name} aria-label={t('Theme name')} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          <p style={{ fontFamily: draft.fonts.default }}>{t('This is paragraph text. Nice!')}</p>
          <div className="theme-sample" style={{ background: c.bg1, fontFamily: draft.fonts.default }}>
            {PREVIEW_ROWS.map(([k, text]) => (
              <div key={k} className="row between">
                <span style={k === 'textHighlight' ? { background: c.textHighlight } : { color: c[k] as string }}>{t(text)}</span>
                <CustomSwatch small value={c[k] as string} active onChange={(v) => setColor(k, v)} label={t(text)} />
              </div>
            ))}
          </div>
          <div className="theme-font">
            <div>{t('Header Font')}</div>
            <Select value={draft.fonts.headings} onChange={(v) => setDraft({ ...draft, fonts: { ...draft.fonts, headings: v } })} options={fontOptions(draft.fonts.headings, ['"Eczar", serif', '"Source Sans 3", sans-serif', 'Georgia, serif', '"Source Code Pro", monospace', 'system-ui, sans-serif'])} />
            <div>{t('Paragraph Font')}</div>
            <Select value={draft.fonts.default} onChange={(v) => setDraft({ ...draft, fonts: { ...draft.fonts, default: v, field: v } })} options={fontOptions(draft.fonts.default, ['"Source Sans 3", sans-serif', '"Eczar", serif', 'Georgia, serif', '"Source Code Pro", monospace', 'system-ui, sans-serif'])} />
          </div>
          <button type="button" className="theme-css-toggle" aria-expanded={cssOpen} onClick={() => setCssOpen(!cssOpen)}>
            {t('Custom CSS')} {cssOpen ? <CaretUp size={14} weight="fill" /> : <CaretDown size={14} weight="fill" />}
          </button>
        </div>
        <div className="theme-colors">
          {COLOR_ROWS.map(([k, label]) => (
            <ColorRow key={k} k={k} label={label} draft={c} base={base} presets={k === 'textHeadings' ? c.textHeadingsOptions ?? [] : k === 'textMain' ? c.textMainOptions ?? [] : []} onChange={(v) => setColor(k, v)} />
          ))}
          <div style={{ height: 30 }} />
          {INTENSITY_ROWS.map(([k, label, def]) => (
            <ColorRow key={k} k={k} label={label} draft={c} base={{ ...base, [k]: base[k] ?? def }} presets={[]} onChange={(v) => setColor(k, v)} />
          ))}
          <div className="intensity-preview">
            {t('Phrase bias:')}{' '}
            <span style={{ background: c.lowIntensityColor ?? '#0466ce' }}>{'{rain}'} +0.3</span>{' '}
            <span style={{ background: c.midIntensityColor ?? '#009707' }}>{'{storm}'} +1</span>{' '}
            <span style={{ background: c.highIntensityColor ?? '#b83700' }}>{'{thunder}'} −2</span>
          </div>
        </div>
      </div>
      {cssOpen && (
        <>
          <textarea className="textarea" style={{ fontFamily: 'var(--font-code)', minHeight: 140, marginTop: 12 }} value={s.customCss} onChange={(e) => s.set({ customCss: e.target.value })} placeholder="#app { }" spellCheck={false} aria-label={t('Custom CSS')} />
          <div className="desc" style={{ marginTop: 6 }}>{t('Press Alt+Shift+P to reset the theme if something goes wrong.')}</div>
        </>
      )}
    </>
  );
}

function TTSTab() {
  const s = useSettings();
  const [voices, setVoices] = useState(listVoices());
  const [editing, setEditing] = useState<string | null>(null);
  const saved = s.ttsSavedVoices;
  const cur = saved.find((v) => v.id === editing);
  const [draft, setDraft] = useState<SavedVoice | null>(null);
  useEffect(() => {
    const h = () => setVoices(listVoices());
    if ('speechSynthesis' in window) speechSynthesis.addEventListener('voiceschanged', h);
    return () => {
      if ('speechSynthesis' in window) speechSynthesis.removeEventListener('voiceschanged', h);
    };
  }, []);
  useEffect(() => setDraft(cur ? { ...cur } : null), [editing]);
  const voiceOptions = [
    ...saved.map((v) => ({ value: `saved:${v.id}`, label: v.name, group: t('Saved Voices') })),
    ...voices.map((v) => ({ value: v.voiceURI, label: `${v.name} (${v.lang})`, group: t('System Voices') })),
  ];
  const test = (voice?: SavedVoice) => speak(s.ttsTestText || t('This is a test for text to speech.'), voice ?? {});
  const [endpointVoices, setEndpointVoices] = useState<string[]>([]);
  useEffect(() => {
    if (s.ttsSource === 'endpoint') void api.ttsVoices().then(setEndpointVoices).catch(() => setEndpointVoices([]));
  }, [s.ttsSource]);
  const randomize = () => {
    if (!draft || !voices.length) return;
    setDraft({ ...draft, voice: voices[Math.floor(Math.random() * voices.length)].voiceURI, rate: Math.round((0.8 + Math.random() * 0.5) * 100) / 100, pitch: Math.round((0.7 + Math.random() * 0.7) * 100) / 100 });
  };
  const endpoint = s.ttsSource === 'endpoint';
  return (
    <>
      <div className="settings-group-title">{t('Voice Source')}</div>
      <SegmentedControl
        value={s.ttsSource}
        onChange={(v) => s.set({ ttsSource: v })}
        options={[
          { value: 'browser', label: t('Browser Voices') },
          { value: 'endpoint', label: t('Speech Endpoint') },
        ]}
      />
      <div className="desc" style={{ margin: '8px 0 18px' }}>
        {endpoint
          ? t('Speech comes from an OpenAI-compatible /audio/speech endpoint: OpenAI, or a local server such as Kokoro-FastAPI or openedai-speech. The API key is kept on the NovelWriter server.')
          : t("Speech uses the voices installed in your browser and operating system. Nothing leaves your device.")}
      </div>
      {endpoint && <EndpointSettings />}
      <div className="settings-grid">
        <ToggleRow title={t('Speak Inputs')} desc={s.ttsSpeakInputs ? t('Your own inputs will be read aloud when you send them.') : t('Your inputs will not be read.')} on={s.ttsSpeakInputs} onChange={(v) => s.set({ ttsSpeakInputs: v })} />
        <ToggleRow title={t('Speak HypeBot Comments')} desc={s.ttsSpeakHypebot ? t('HypeBot comments will be read aloud.') : t('HypeBot comments will not be read.')} on={s.ttsSpeakHypebot} onChange={(v) => s.set({ ttsSpeakHypebot: v })} />
        <ToggleRow title={t('Speak AI Outputs')} desc={s.ttsSpeakOutputs ? t('New AI generations will be read aloud automatically.') : t('AI generations will not be read automatically.')} on={s.ttsSpeakOutputs} onChange={(v) => s.set({ ttsSpeakOutputs: v })} />
        <div>
          <div className="field-label">{t('HypeBot Voice')}</div>
          <Select
            value={s.ttsHypebotVoice}
            ariaLabel={t('HypeBot Voice')}
            onChange={(v) => s.set({ ttsHypebotVoice: v })}
            options={[{ value: '', label: t('Same as Story Voice') }, ...(endpoint ? endpointVoices.map((v) => ({ value: v, label: v })) : voiceOptions)]}
          />
        </div>
      </div>
      {!endpoint && <div className="settings-group-title">{t('Text To Speech Settings')}</div>}
      <div className="settings-grid" hidden={endpoint}>
        <div>
          <div className="field-label">{t('Story Voice')}</div>
          <div className="row" style={{ gap: 0 }}>
            <Select className="grow" value={s.ttsVoice || null} placeholder={t('System default')} searchable={voiceOptions.length > 8} ariaLabel={t('Story Voice')} onChange={(v) => s.set({ ttsVoice: v })} options={voiceOptions} />
            <button type="button" className="tts-tile cream" aria-label={t('Test voice')} title={t('Test voice')} onClick={() => test()}>
              <SpeakerHigh size={16} weight="fill" />
            </button>
            <button type="button" className="tts-tile cream" aria-label={t('Stop')} title={t('Stop')} onClick={stopSpeaking}>
              <Stop size={16} weight="fill" />
            </button>
          </div>
          <div className="field-label" style={{ marginTop: 30 }}>{t('Text entered here will be used for the test button.')}</div>
          <textarea className="textarea" style={{ height: 84, minHeight: 84 }} value={s.ttsTestText} aria-label={t('Test text')} onChange={(e) => s.set({ ttsTestText: e.target.value })} />
        </div>
        <div>
          <div className="settings-group-title" style={{ marginBottom: 12 }}>{t('Saved Voices')}</div>
          <div className="row" style={{ gap: 0 }}>
            <button
              type="button"
              className="tts-tile"
              aria-label={t('New voice')}
              title={t('New voice')}
              onClick={() => {
                const v: SavedVoice = { id: uid(), name: t('New Voice'), voice: s.ttsVoice, rate: 1, pitch: 1 };
                s.set({ ttsSavedVoices: [...saved, v] });
                setEditing(v.id);
              }}
            >
              <Plus size={16} weight="bold" />
            </button>
            <Select className="grow" value={editing} placeholder={t('Select a voice to edit')} ariaLabel={t('Saved Voices')} onChange={setEditing} options={saved.map((v) => ({ value: v.id, label: v.name }))} />
            <button type="button" className="tts-tile muted-tile" disabled={!draft} aria-label={t('Test voice')} onClick={() => draft && test(draft)}>
              <SpeakerHigh size={16} weight="fill" />
            </button>
          </div>
          <div className="field-label">{t('Name')}</div>
          <input className="input" placeholder={t('Name')} disabled={!draft} value={draft?.name ?? ''} onChange={(e) => draft && setDraft({ ...draft, name: e.target.value })} />
          <div className="field-label">{t('Voice')}</div>
          <div className="row" style={{ gap: 0 }}>
            <button type="button" className="btn tts-random" disabled={!draft} onClick={randomize}>
              {t('Randomize')}
            </button>
            <Select className="grow" value={draft?.voice || null} placeholder={t('System default')} onChange={(v) => draft && setDraft({ ...draft, voice: v })} options={voices.map((v) => ({ value: v.voiceURI, label: `${v.name} (${v.lang})` }))} />
          </div>
          {draft && (
            <div className="settings-grid" style={{ marginTop: 12, marginBottom: 0, gap: 16 }}>
              <SliderSetting small title={t('Speed')} value={draft.rate} min={0.5} max={2} step={0.05} def={1} onChange={(v) => setDraft({ ...draft, rate: v })} />
              <SliderSetting small title={t('Pitch')} value={draft.pitch} min={0} max={2} step={0.05} def={1} onChange={(v) => setDraft({ ...draft, pitch: v })} />
            </div>
          )}
          <div className="row" style={{ justifyContent: 'flex-end', gap: 0, marginTop: 16 }}>
            <button type="button" className="btn dark" disabled={!draft} onClick={() => draft && s.set({ ttsSavedVoices: saved.map((v) => (v.id === draft.id ? draft : v)) })}>
              {t('Save Voice')}
            </button>
            <button
              type="button"
              className="btn dark"
              disabled={!draft}
              onClick={() => {
                if (!draft) return;
                s.set({ ttsSavedVoices: saved.filter((v) => v.id !== draft.id), ttsVoice: s.ttsVoice === `saved:${draft.id}` ? '' : s.ttsVoice });
                setEditing(null);
              }}
            >
              {t('Delete Voice')}
            </button>
          </div>
        </div>
        <SliderSetting title={t('Volume')} value={s.ttsVolume} min={0} max={1} step={0.05} def={1} onChange={(v) => s.set({ ttsVolume: v })} />
        <div>
          <SliderSetting title={t('Speed')} value={s.ttsRate} min={0.5} max={2} step={0.05} def={1} onChange={(v) => s.set({ ttsRate: v })} />
          <div className="desc" style={{ textAlign: 'center', marginTop: 10, fontWeight: 600 }}>{t('Note: saved voices use their own speed.')}</div>
        </div>
      </div>
    </>
  );
}

/** OpenAI-compatible speech endpoint: URL, key, model, voice, streaming, test and download. */
function EndpointSettings() {
  const s = useSettings();
  const [cfg, setCfg] = useState<TTSConfig | null>(null);
  const [voices, setVoices] = useState<string[]>([]);
  const [status, setStatus] = useState('');
  useEffect(() => {
    void api.ttsConfig().then(setCfg).catch(() => setCfg({ baseUrl: 'https://api.openai.com/v1', apiKey: '', model: 'tts-1', voice: 'alloy' }));
  }, []);
  const save = async (next: TTSConfig) => {
    setCfg(next);
    try {
      await api.saveTtsConfig(next);
      setVoices(await api.ttsVoices());
      setStatus('');
    } catch (e) {
      setStatus((e as Error).message);
    }
  };
  useEffect(() => {
    if (cfg) void api.ttsVoices().then(setVoices).catch(() => {});
  }, [cfg?.baseUrl]);
  if (!cfg) return null;
  const sample = s.ttsTestText || t('This is a test for text to speech.');
  return (
    <div className="settings-grid tts-endpoint">
      <label className="number-field">
        <span className="field-label">{t('Endpoint URL')}</span>
        <input className="input" value={cfg.baseUrl} placeholder="https://api.openai.com/v1" onChange={(e) => setCfg({ ...cfg, baseUrl: e.target.value })} onBlur={() => void save(cfg)} />
      </label>
      <label className="number-field">
        <span className="field-label">{t('API Key')}</span>
        <input className="input" type="password" value={cfg.apiKey} placeholder={t('Not needed for most local servers')} onChange={(e) => setCfg({ ...cfg, apiKey: e.target.value })} onBlur={() => void save(cfg)} />
      </label>
      <label className="number-field">
        <span className="field-label">{t('Model')}</span>
        <input className="input" value={cfg.model} placeholder="tts-1" onChange={(e) => setCfg({ ...cfg, model: e.target.value })} onBlur={() => void save(cfg)} />
      </label>
      <div className="number-field">
        <span className="field-label">{t('Story Voice')}</span>
        <div className="row" style={{ gap: 0 }}>
          <Select
            className="grow"
            value={s.ttsEndpointVoice || cfg.voice}
            ariaLabel={t('Story Voice')}
            searchable={voices.length > 8}
            onChange={(v) => s.set({ ttsEndpointVoice: v })}
            options={[...new Set([cfg.voice, ...voices])].filter(Boolean).map((v) => ({ value: v, label: v }))}
          />
          <button type="button" className="tts-tile cream" aria-label={t('Test voice')} title={t('Test voice')} onClick={() => speak(sample)}>
            <SpeakerHigh size={16} weight="fill" />
          </button>
          <button type="button" className="tts-tile cream" aria-label={t('Stop')} title={t('Stop')} onClick={stopSpeaking}>
            <Stop size={16} weight="fill" />
          </button>
          <button
            type="button"
            className="tts-tile"
            aria-label={t('Download Spoken')}
            title={t('Download Spoken')}
            onClick={() => void downloadSpeech(sample, 'tts-test').catch((e) => setStatus((e as Error).message))}
          >
            <DownloadSimple size={16} />
          </button>
        </div>
      </div>
      {status && <div className="warning-text" style={{ gridColumn: '1 / -1' }}>{status}</div>}
      <div style={{ gridColumn: '1 / -1' }}>
        <div className="settings-group-title">{t('Streamed TTS Settings')}</div>
        <ToggleRow
          title={t('Streamed TTS')}
          desc={s.ttsStreamed ? t('Long text is sent a few sentences at a time, so speech starts sooner.') : t('The whole text is synthesized before playback starts.')}
          on={s.ttsStreamed}
          onChange={(v) => s.set({ ttsStreamed: v })}
        />
        <SliderSetting title={t('Speed')} value={s.ttsRate} min={0.5} max={2} step={0.05} def={1} onChange={(v) => s.set({ ttsRate: v })} />
        <SliderSetting title={t('Volume')} value={s.ttsVolume} min={0} max={1} step={0.05} def={1} onChange={(v) => s.set({ ttsVolume: v })} />
      </div>
    </div>
  );
}

function DefaultsTab() {
  const s = useSettings();
  const presets = useStory((x) => x.allPresets)();
  const models = useStory((x) => x.models);
  const info = s.defaultModel && models.find((m) => m.provider === s.defaultModel!.provider && m.id === s.defaultModel!.id);
  return (
    <>
      <div className="heading">{t('Pen Name')}</div>
      <div className="desc-plain" style={{ margin: '8px 0 12px' }}>{t('Shown on screenshots of your stories.')}</div>
      <input className="input" aria-label={t('Pen Name')} value={s.penName} placeholder={t('Anonymous')} onChange={(e) => s.set({ penName: e.target.value })} style={{ marginBottom: 24 }} />
      <div className="heading">{t('Default AI Model')}</div>
      <div className="desc-plain" style={{ margin: '8px 0 12px' }}>{t('New stories will use this model by default.')}</div>
      <div className="model-card">
        <div className="model-card-art">{s.defaultModel ? <ModelThumb provider={s.defaultModel.provider} id={s.defaultModel.id} /> : <ModelThumb provider="none" id="none" />}</div>
        <div className="grow">
          <ModelSelect className="plain" value={s.defaultModel} onChange={(m) => s.set({ defaultModel: m })} />
          <div className="model-card-desc">
            {info ? `${info.provider} · ${Math.round(info.contextWindow / 1000)}k ${t('context')}${info.reasoning ? ` · ${t('reasoning')}` : ''}` : t('When unset, new stories use the model you used last.')}
          </div>
        </div>
      </div>
      <div className="settings-grid" style={{ marginTop: 36 }}>
        <div>
          <div className="heading">{t('Default Preset')}</div>
          <div className="desc-plain" style={{ marginBottom: 8 }}>{t('New Stories will use the selected preset as a default.')}</div>
          <Select value={s.defaultPresetId} ariaLabel={t('Default Preset')} onChange={(v) => s.set({ defaultPresetId: v })} options={presets.map((p) => ({ value: p.id, label: p.name }))} />
        </div>
        <div>
          <div className="heading">{t('Default Story Mode')}</div>
          <div className="desc-plain" style={{ marginBottom: 8 }}>{t('Used by quick-start actions that skip the mode picker.')}</div>
          <SegmentedControl
            value={s.defaultMode}
            onChange={(v) => s.set({ defaultMode: v })}
            options={[
              { value: 'storyteller', label: t('Storyteller') },
              { value: 'adventure', label: t('Text Adventure') },
            ]}
          />
        </div>
      </div>
      <div className="settings-group-title">{t('Lorebook Generation Settings')}</div>
      <div className="desc-plain" style={{ marginBottom: 10 }}>{t('Change the Model and settings preset used by the Lorebook Generator.')}</div>
      <div className="settings-grid">
        <div>
          <div className="heading" style={{ marginBottom: 6 }}>{t('Lorebook Generation Model')}</div>
          <ModelSelect value={s.loreGenModel} placeholder={t('Same as the story')} onChange={(m) => s.set({ loreGenModel: m })} />
          {s.loreGenModel && (
            <button type="button" className="link-btn" style={{ marginTop: 6 }} onClick={() => s.set({ loreGenModel: null })}>
              {t("Use the story's model")}
            </button>
          )}
        </div>
        <div>
          <div className="heading" style={{ marginBottom: 6 }}>{t('Lore Generation Preset')}</div>
          <Select value={s.loreGenPresetId} ariaLabel={t('Lore Generation Preset')} onChange={(v) => s.set({ loreGenPresetId: v })} options={presets.map((p) => ({ value: p.id, label: p.name }))} />
        </div>
      </div>
      <Group title="Account">
        <div>
          <div className="heading" style={{ marginBottom: 8 }}>{t('Download All Stories')}</div>
          <button
            type="button"
            className="btn"
            onClick={async () => {
              const metas = await api.listStories();
              const all = await Promise.all(metas.map((m) => api.getStory(m.id)));
              download('novelwriter-stories.json', JSON.stringify(all.map((x) => JSON.parse(exportStoryFile(x)))));
            }}
          >
            <DownloadSimple size={14} /> {t('Download All Stories')}
          </button>
        </div>
        <div>
          <div className="heading" style={{ marginBottom: 8 }}>{t('Reset Settings')}</div>
          <button
            type="button"
            className="btn danger"
            onClick={async () => {
              if (await useUI.getState().confirm({ title: t('Reset Settings'), danger: true, message: t('Restore all user settings to their defaults?') })) {
                const { language } = s;
                s.set({ ...DEFAULT_SETTINGS, language });
              }
            }}
          >
            {t('Reset')}
          </button>
        </div>
      </Group>
    </>
  );
}

function HotkeyChips({ spec }: { spec: string }) {
  return (
    <span className="hotkey-chips">
      {spec.split('|').map((one, i) => (
        <span key={i} className="hotkey-binding">
          {hotkeyParts(one).map((p, j) => (
            <span key={j}>
              {j > 0 && <span className="plus"> + </span>}
              {p.glyph && <span className="glyph">{p.glyph}</span>}
              {p.label}
            </span>
          ))}
        </span>
      ))}
    </span>
  );
}

function HotkeysTab() {
  const s = useSettings();
  const [recording, setRecording] = useState<string | null>(null);
  useEffect(() => {
    if (!recording) return;
    const h = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;
      if (e.key === 'Escape' && !e.ctrlKey && !e.altKey && !e.metaKey) return setRecording(null);
      const parts = [];
      if (e.ctrlKey || e.metaKey) parts.push('Mod');
      if (e.altKey) parts.push('Alt');
      if (e.shiftKey) parts.push('Shift');
      const key = e.code.startsWith('Key') ? e.code.slice(3).toLowerCase() : e.key.length === 1 ? e.key.toLowerCase() : e.key;
      parts.push(key);
      s.set({ hotkeys: { ...s.hotkeys, [recording]: parts.join('-') } });
      setRecording(null);
    };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, [recording, s]);
  return (
    <div className="hotkey-list">
      {Object.keys(DEFAULT_HOTKEYS).map((k) => {
        const fixed = FIXED_HOTKEYS.has(k);
        const spec = s.hotkeys[k] ?? DEFAULT_HOTKEYS[k];
        return (
          <div key={k} className={`hotkey-row ${recording === k ? 'recording' : ''}`}>
            <span>{t(HOTKEY_LABELS[k] ?? k)}</span>
            <span className="row" style={{ gap: 8 }}>
              {spec !== DEFAULT_HOTKEYS[k] && (
                <button type="button" className="icon-btn" aria-label={t('Reset')} title={t('Reset')} onClick={() => s.set({ hotkeys: { ...s.hotkeys, [k]: DEFAULT_HOTKEYS[k] } })}>
                  <ArrowCounterClockwise size={14} />
                </button>
              )}
              {fixed ? (
                <HotkeyChips spec={spec} />
              ) : (
                <button type="button" className="hotkey-edit" title={t('Click to record a new binding')} onClick={() => setRecording(recording === k ? null : k)}>
                  {recording === k ? t('Press keys…') : <HotkeyChips spec={spec} />}
                </button>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function ChangeLogModal({ onClose }: { onClose: () => void }) {
  const [open, setOpen] = useState<string | null>(NEWS[0]?.id ?? null);
  return (
    <Modal onClose={onClose} width={600} label={t('Change Log')} className="changelog-modal">
      <div className="changelog-head">
        <h3>{t('Change Log')}</h3>
        <span className="row" style={{ gap: 16 }}>
          <span className="desc-plain" style={{ margin: 0 }}>{t('Click an entry for more info.')}</span>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={t('Close')}>
            <X size={22} weight="bold" />
          </button>
        </span>
      </div>
      <div className="modal-body changelog-body">
        {NEWS.map((n, i) => (
          <div key={n.id} className="changelog-entry">
            <button type="button" className="row between changelog-title" aria-expanded={open === n.id} onClick={() => setOpen(open === n.id ? null : n.id)}>
              <span>{t(n.title)}</span>
              <span className="row" style={{ gap: 12 }}>
                {i === 0 && <span className="new-tag">{t('New!')}</span>}
                <span className="changelog-date">{n.date}</span>
              </span>
            </button>
            {open === n.id && <p>{t(n.body)}</p>}
          </div>
        ))}
      </div>
    </Modal>
  );
}

function AboutTab() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 640 }}>
      <p>
        <b>NovelWriter</b> — {t('an open AI writing studio. Models are accessed through pi-ai on your own server, with your own accounts.')}
      </p>
      <p className="desc">{t('Data lives in the data/ folder next to the server: stories, presets, settings and credentials (auth.json).')}</p>
    </div>
  );
}

export function SettingsModal({ onClose, initialTab }: { onClose: () => void; initialTab?: Tab }) {
  const [tab, setTab] = useState<Tab>(initialTab ?? 'ai');
  const [log, setLog] = useState(false);
  const changelogSeen = useSettings((x) => x.changelogSeen);
  const tabs: Tab[] = ['ai', 'interface', 'theme', 'tts', 'defaults', 'hotkeys', 'providers', 'embeddings', 'nlp'];
  return (
    <Modal onClose={onClose} width={1150} className="split-modal" label={t('User Settings')}>
      <div className="side">
        <div className="side-title">
          <GearSix size={20} weight="fill" /> {t('User Settings')}
        </div>
        <div className="nav">
          {tabs.map((k) => (
            <button type="button" key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>
              {t(TITLES[k])}
            </button>
          ))}
          <div className="grow" />
          <button type="button" className={tab === 'about' ? 'active' : ''} onClick={() => setTab('about')}>
            {t('Support')}
          </button>
          <button
            type="button"
            className="row between"
            onClick={() => {
              setLog(true);
              useSettings.getState().set({ changelogSeen: NEWS[0]?.id ?? '' });
            }}
          >
            {t('Change Log')}
            {changelogSeen !== NEWS[0]?.id && <span className="new-tag">{t('New!')}</span>}
          </button>
        </div>
      </div>
      <div className="content">
        <div className="content-head">
          <h3>{t(TITLES[tab])}</h3>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={t('Close')}>
            <X size={24} weight="bold" />
          </button>
        </div>
        <div className="content-body">
          {tab === 'ai' && <AITab />}
          {tab === 'interface' && <InterfaceTab />}
          {tab === 'theme' && <ThemeTab />}
          {tab === 'tts' && <TTSTab />}
          {tab === 'defaults' && <DefaultsTab />}
          {tab === 'hotkeys' && <HotkeysTab />}
          {tab === 'providers' && <ProvidersTab />}
          {tab === 'embeddings' && <EmbeddingsTab />}
          {tab === 'nlp' && <NlpTab />}
          {tab === 'about' && <AboutTab />}
        </div>
      </div>
      {log && <ChangeLogModal onClose={() => setLog(false)} />}
    </Modal>
  );
}

export type { Settings };
