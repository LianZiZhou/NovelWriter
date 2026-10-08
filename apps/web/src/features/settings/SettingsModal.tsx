import { useEffect, useRef, useState, type ReactNode } from 'react';
import { DownloadSimple, GearSix, Robot, UploadSimple, X } from '@phosphor-icons/react';
import { exportStoryFile } from '@novelwriter/core';
import { api } from '../../api.ts';
import { DEFAULT_HOTKEYS, DEFAULT_SETTINGS, useSettings, type Settings } from '../../store/settings.ts';
import { download, useStory } from '../../store/story.ts';
import { useUI } from '../../store/ui.ts';
import { t } from '../../i18n.ts';
import { Modal, SegmentedControl, Select, SliderSetting, ToggleRow } from '../../components/ui.tsx';
import { BUILTIN_THEMES, type Theme, type ThemeColors } from '../../theme/themes.ts';
import { listVoices, speak } from '../tts/tts.ts';
import { ModelSelect } from '../right/ModelSelect.tsx';
import { ProvidersTab } from './ProvidersTab.tsx';
import { formatHotkey, HOTKEY_LABELS } from '../../hotkeys.ts';

type Tab = 'ai' | 'interface' | 'theme' | 'tts' | 'defaults' | 'hotkeys' | 'providers' | 'about';

const TITLES: Record<Tab, string> = {
  ai: 'AI Settings',
  interface: 'Interface',
  theme: 'Theme',
  tts: 'Text To Speech',
  defaults: 'Defaults',
  hotkeys: 'Hotkeys',
  providers: 'AI Providers',
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

function AITab() {
  const s = useSettings();
  return (
    <>
      <Group title="AI Responses">
        <ToggleRow title={t('Stream AI Responses')} desc={t('AI responses will be streamed, appearing token by token.')} on={s.streamResponses} onChange={(v) => s.set({ streamResponses: v })} />
        <ToggleRow title={t('Continue Response to End of Sentence')} desc={t('Responses will attempt to continue until the end of a sentence is found.')} on={s.continueToSentenceEnd} onChange={(v) => s.set({ continueToSentenceEnd: v })} />
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
          <div className="row" style={{ background: 'var(--bg1)', padding: 8 }}>
            <Robot size={28} weight="duotone" /> <span>HypeBot</span>
          </div>
        </div>
        <SliderSetting title={t('Comment Chance')} value={s.hypebotChance} min={0} max={100} step={1} def={5} onChange={(v) => s.set({ hypebotChance: v })} suffix=" %" defText={t('Default: {v}', { v: '5%' })} />
      </Group>
      <Group title="Experimental">
        <ToggleRow title={t('Default Bias')} desc={t('Avoid generating dinkuses (***) and asterisms (⁂) unless the story uses them.')} on={s.defaultBias} onChange={(v) => s.set({ defaultBias: v })} />
        <ToggleRow title={t('Enable Token Probabilities')} desc={t('Token probabilities are not exposed by the connected chat model APIs.')} on={false} onChange={() => {}} disabled />
      </Group>
    </>
  );
}

function InterfaceTab() {
  const s = useSettings();
  return (
    <>
      <Group title="Interface">
        <div>
          <div className="heading" style={{ marginBottom: 8 }}>{t('Language')}</div>
          <Select
            value={s.language}
            onChange={(v) => s.set({ language: v })}
            options={[
              { value: 'en', label: 'English' },
              { value: 'zh', label: '简体中文' },
            ]}
          />
        </div>
        <SliderSetting title={t('Text Size')} value={s.editorFontSize} min={12} max={30} step={1} def={18} onChange={(v) => s.set({ editorFontSize: v })} suffix=" px" />
        <SliderSetting title={t('Line Spacing')} value={s.lineSpacing} min={1} max={3} step={0.05} def={1.8} onChange={(v) => s.set({ lineSpacing: v })} />
        <SliderSetting title={t('Paragraph Spacing')} value={s.paragraphSpacing} min={0} max={40} step={1} def={9} onChange={(v) => s.set({ paragraphSpacing: v })} suffix=" px" />
        <SliderSetting title={t('Editor Width')} value={s.editorWidth} min={500} max={1600} step={10} def={780} onChange={(v) => s.set({ editorWidth: v })} suffix=" px" />
        <SliderSetting title={t('UI Scale')} value={s.uiScale} min={0.8} max={1.4} step={0.05} def={1} onChange={(v) => s.set({ uiScale: v })} />
      </Group>
      <Group title="Editor">
        <ToggleRow title={t('Highlight Speech')} desc={t('Emphasize text inside quotation marks.')} on={s.highlightSpeech} onChange={(v) => s.set({ highlightSpeech: v })} />
        <ToggleRow title={t('Inverted')} desc={t('Emphasize narration instead of speech.')} on={s.highlightSpeechInverted} onChange={(v) => s.set({ highlightSpeechInverted: v })} disabled={!s.highlightSpeech} />
        <ToggleRow title={t('Show Input Box')} desc={t('Type new input in a box next to the Send button instead of the editor.')} on={s.inputBox} onChange={(v) => s.set({ inputBox: v })} />
        <ToggleRow title={t('Show Tips')} on={s.showTips} onChange={(v) => s.set({ showTips: v })} />
        <ToggleRow title={t('Spellcheck')} on={s.editorSpellcheck} onChange={(v) => s.set({ editorSpellcheck: v })} />
      </Group>
    </>
  );
}

const COLOR_FIELDS: [keyof ThemeColors, string][] = [
  ['textHeadings', 'Header'],
  ['textMain', 'Paragraph'],
  ['warning', 'Warning/Error'],
  ['bg3', 'Foreground'],
  ['bg2', 'Background'],
  ['bg1', 'Dark Background'],
  ['bg0', 'Input Background'],
  ['textPrompt', 'Prompt'],
  ['textAI', 'AI Text'],
  ['textEdit', 'Edited Text'],
  ['textUser', 'User Text'],
];

function ThemeTab() {
  const s = useSettings();
  const current = s.theme();
  const [draft, setDraft] = useState<Theme>(structuredClone(current));
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => setDraft(structuredClone(s.theme())), [s.themeName]);
  const all = [...BUILTIN_THEMES, ...s.customThemes];
  const apply = () => {
    const name = BUILTIN_THEMES.some((b) => b.name === draft.name) && JSON.stringify(draft) !== JSON.stringify(BUILTIN_THEMES.find((b) => b.name === draft.name)) ? `${draft.name} (Custom)` : draft.name;
    const theme = { ...draft, name };
    s.set({ customThemes: [...s.customThemes.filter((x) => x.name !== name), ...(BUILTIN_THEMES.some((b) => b.name === name) ? [] : [theme])], themeName: name });
  };
  const c = draft.colors;
  return (
    <>
      <div className="row" style={{ gap: 10, marginBottom: 14 }}>
        <button type="button" className="btn" style={{ padding: '12px 36px' }} onClick={apply}>
          {t('Apply & Save Theme')}
        </button>
        <button type="button" className="btn" style={{ padding: '12px 36px' }} onClick={() => fileRef.current?.click()}>
          <UploadSimple size={14} /> {t('Import')}
        </button>
        <button type="button" className="btn" style={{ padding: '12px 36px' }} onClick={() => download(`${draft.name}.naitheme`, JSON.stringify(draft, null, 2))}>
          <DownloadSimple size={14} /> {t('Export')}
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
      <div className="theme-preview" style={{ background: c.bg2, color: c.textMain }}>
        <div>
          <input className="input" style={{ background: 'transparent', fontFamily: draft.fonts.headings, fontSize: 26, color: c.textHeadings, padding: 0 }} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          <p>{t('This is paragraph text. Nice!')}</p>
          <div style={{ background: c.bg1, padding: 14, lineHeight: 1.75 }}>
            <div style={{ color: c.textPrompt }}>{t('This is a prompt.')}</div>
            <div style={{ color: c.textAI }}>{t('This is AI text.')}</div>
            <div style={{ color: c.textEdit }}>{t('This is edited text.')}</div>
            <div style={{ color: c.textUser }}>{t('This is new user text.')}</div>
            <div>
              <span style={{ background: c.textHighlight }}>{t('This is highlighted text.')}</span>
            </div>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '8px 12px', alignItems: 'center', alignContent: 'start' }}>
          {COLOR_FIELDS.map(([k, label]) => (
            <label key={k} style={{ display: 'contents' }}>
              <span style={{ fontSize: 14 }}>{t(label)}</span>
              <input type="color" className="color-swatch" value={(c[k] as string).slice(0, 7)} onChange={(e) => setDraft({ ...draft, colors: { ...c, [k]: e.target.value } })} />
            </label>
          ))}
          <span style={{ fontSize: 14 }}>{t('Header Font')}</span>
          <Select
            style={{ width: 160 }}
            value={draft.fonts.headings}
            onChange={(v) => setDraft({ ...draft, fonts: { ...draft.fonts, headings: v } })}
            options={['"Eczar"', '"Source Sans Pro"', 'Georgia, serif', '"Source Code Pro"', 'system-ui'].map((f) => ({ value: f, label: f.replace(/"/g, '') }))}
          />
          <span style={{ fontSize: 14 }}>{t('Paragraph Font')}</span>
          <Select
            style={{ width: 160 }}
            value={draft.fonts.default}
            onChange={(v) => setDraft({ ...draft, fonts: { ...draft.fonts, default: v, field: v } })}
            options={[draft.fonts.default, '"Source Sans Pro", sans-serif', '"Eczar", serif', 'Georgia, serif', '"Source Code Pro", monospace', 'system-ui, sans-serif']
              .filter((v, i, a) => a.indexOf(v) === i)
              .map((f) => ({ value: f, label: f.split(',')[0].replace(/"/g, '') }))}
          />
        </div>
      </div>
      <div className="settings-group-title" style={{ marginTop: 20 }}>{t('Custom CSS')}</div>
      <textarea className="textarea" style={{ fontFamily: 'var(--font-code)', minHeight: 140 }} value={s.customCss} onChange={(e) => s.set({ customCss: e.target.value })} placeholder="#app { }" spellCheck={false} />
      <div className="desc" style={{ marginTop: 6 }}>{t('Press Alt+Shift+P to reset the theme if something goes wrong.')}</div>
    </>
  );
}

function TTSTab() {
  const s = useSettings();
  const [voices, setVoices] = useState(listVoices());
  useEffect(() => {
    const h = () => setVoices(listVoices());
    if ('speechSynthesis' in window) speechSynthesis.addEventListener('voiceschanged', h);
    return () => {
      if ('speechSynthesis' in window) speechSynthesis.removeEventListener('voiceschanged', h);
    };
  }, []);
  return (
    <Group title="Text To Speech">
      <div>
        <div className="heading" style={{ marginBottom: 8 }}>{t('Voice')}</div>
        <Select value={s.ttsVoice || null} placeholder={t('System default')} searchable onChange={(v) => s.set({ ttsVoice: v })} options={voices.map((v) => ({ value: v.voiceURI, label: `${v.name} (${v.lang})` }))} />
        <button type="button" className="btn" style={{ marginTop: 10 }} onClick={() => speak(t('The rain had not stopped for three days.'))}>
          {t('Test')}
        </button>
      </div>
      <ToggleRow title={t('Speak AI outputs')} desc={t('Read new AI generations aloud automatically.')} on={s.ttsSpeakOutputs} onChange={(v) => s.set({ ttsSpeakOutputs: v })} />
      <SliderSetting title={t('Rate')} value={s.ttsRate} min={0.5} max={2} step={0.05} def={1} onChange={(v) => s.set({ ttsRate: v })} />
      <SliderSetting title={t('Pitch')} value={s.ttsPitch} min={0} max={2} step={0.05} def={1} onChange={(v) => s.set({ ttsPitch: v })} />
      <SliderSetting title={t('Volume')} value={s.ttsVolume} min={0} max={1} step={0.05} def={1} onChange={(v) => s.set({ ttsVolume: v })} />
    </Group>
  );
}

function DefaultsTab() {
  const s = useSettings();
  const presets = useStory((x) => x.allPresets)();
  return (
    <>
      <Group title="Defaults">
        <div>
          <div className="heading" style={{ marginBottom: 8 }}>{t('Default AI Model')}</div>
          <ModelSelect value={s.defaultModel} onChange={(m) => s.set({ defaultModel: m })} />
        </div>
        <div>
          <div className="heading" style={{ marginBottom: 8 }}>{t('Default Preset')}</div>
          <Select value={s.defaultPresetId} onChange={(v) => s.set({ defaultPresetId: v })} options={presets.map((p) => ({ value: p.id, label: p.name }))} />
        </div>
      </Group>
      <Group title="Account">
        <div>
          <div className="heading" style={{ marginBottom: 8 }}>{t('Download All Stories')}</div>
          <button
            type="button"
            className="btn"
            onClick={async () => {
              const metas = await api.listStories();
              const all = await Promise.all(metas.map((m) => api.getStory(m.id)));
              download('novelwriter-stories.json', JSON.stringify(all.map((s) => JSON.parse(exportStoryFile(s)))));
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

function HotkeysTab() {
  const s = useSettings();
  const [recording, setRecording] = useState<string | null>(null);
  useEffect(() => {
    if (!recording) return;
    const h = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;
      const parts = [];
      if (e.ctrlKey || e.metaKey) parts.push('Mod');
      if (e.shiftKey) parts.push('Shift');
      if (e.altKey) parts.push('Alt');
      parts.push(e.key.length === 1 ? e.key.toLowerCase() : e.key);
      s.set({ hotkeys: { ...s.hotkeys, [recording]: parts.join('-') } });
      setRecording(null);
    };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, [recording, s]);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {Object.keys(DEFAULT_HOTKEYS).map((k) => (
        <div key={k} className="row between" style={{ padding: '8px 10px', background: 'var(--bg1)' }}>
          <span style={{ fontSize: 14 }}>{t(HOTKEY_LABELS[k] ?? k)}</span>
          <span className="row" style={{ gap: 8 }}>
            <button type="button" className="hotkey" onClick={() => setRecording(k)}>
              {recording === k ? t('Press keys…') : formatHotkey(s.hotkeys[k] ?? DEFAULT_HOTKEYS[k])}
            </button>
            {s.hotkeys[k] !== DEFAULT_HOTKEYS[k] && (
              <button type="button" className="icon-btn" aria-label={t('Reset')} onClick={() => s.set({ hotkeys: { ...s.hotkeys, [k]: DEFAULT_HOTKEYS[k] } })}>
                <X size={14} />
              </button>
            )}
          </span>
        </div>
      ))}
      <div className="desc" style={{ marginTop: 10 }}>
        {t('Editor formatting: Ctrl+B bold, Ctrl+I italic, Ctrl+U underline, Ctrl+D strikethrough. Ctrl+F to find.')}
      </div>
    </div>
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
  const tabs: Tab[] = ['ai', 'interface', 'theme', 'tts', 'defaults', 'hotkeys', 'providers'];
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
          {tab === 'about' && <AboutTab />}
        </div>
      </div>
    </Modal>
  );
}

export type { Settings };
