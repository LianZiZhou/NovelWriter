import { useEffect, useState } from 'react';
import { Check, DownloadSimple, Play, Trash } from '@phosphor-icons/react';
import { NLP_MODELS, NLP_TASKS, normalizeNlpConfig, type NlpConfig, type NlpConfigPatch, type NlpTask } from '@novelwriter/core';
import { api, type EmbeddingStatus } from '../../api.ts';
import { t } from '../../i18n.ts';
import { SegmentedControl } from '../../components/ui.tsx';
import { Group, mb, run, TaskRow, toast } from './EmbeddingsTab.tsx';

const TASKS: Record<NlpTask, { title: string; desc: string }> = {
  punctuation: { title: 'Punctuation', desc: 'Tells questions from statements in adventure input you leave unpunctuated. Exclamations are always judged from the words.' },
  segmentation: { title: 'Sentence Segmentation', desc: 'Finds where sentences end, with or without punctuation.' },
  language: { title: 'Language Detection', desc: 'Recognizes the language of adventure input, so its words are read in the right language.' },
  entities: { title: 'Named Entities', desc: 'Finds the names of people, places and organizations in a text.' },
};

export function NlpTab() {
  const [c, setC] = useState<NlpConfig | null>(null);
  const [emb, setEmb] = useState<EmbeddingStatus | null>(null);
  const [installed, setInstalled] = useState<Map<string, number>>(new Map());
  const [task, setTask] = useState<NlpTask>('punctuation');
  const [input, setInput] = useState('');
  const [output, setOutput] = useState('');
  const [testing, setTesting] = useState(false);
  useEffect(() => {
    void api.nlpConfig().then(setC, () => setC(normalizeNlpConfig({})));
  }, []);
  const busy = emb?.tasks.some((x) => x.status === 'running') ?? false;
  useEffect(() => {
    let alive = true;
    const tick = () => {
      void api.embeddingStatus().then((s) => alive && setEmb(s), () => {});
      void api.nlpStatus().then((s) => alive && setInstalled(new Map(s.installed.map((m) => [m.id, m.sizeMB]))), () => {});
    };
    tick();
    const timer = setInterval(tick, busy ? 700 : 4000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [busy]);
  if (!c) return null;
  const save = (p: NlpConfigPatch) => {
    setC(normalizeNlpConfig({ ...c, ...p, models: { ...c.models, ...p.models } }));
    void api.saveNlpConfig(p).catch((e: Error) => toast(e.message));
  };
  const rt = emb?.runtime;
  const downloads = emb?.tasks.filter((x) => (x.key.startsWith('nlp:') || x.key === 'runtime:onnx') && (x.status === 'running' || Date.now() - x.startedAt < 120_000)) ?? [];
  return (
    <>
      <Group title="Text Analysis" desc={t('Local models that read story text. Each one is optional: without a model, built-in rules do the job.')}>
        <div style={{ gridColumn: '1 / -1' }} className="row between">
          <span>
            {t('ONNX Runtime')}:{' '}
            {rt?.installed ? (
              <>
                <Check size={14} /> {rt.version}
              </>
            ) : (
              t('Not installed')
            )}
            <span className="desc" style={{ display: 'block' }}>{t('Shared with Vector Search.')}</span>
          </span>
          {!rt?.installed && (
            <button type="button" className="btn small" onClick={() => void run(api.installRuntime('onnx'))}>
              <DownloadSimple size={14} /> {t('Install')}
            </button>
          )}
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <div className="heading" style={{ marginBottom: 8 }}>{t('Run On')}</div>
          <SegmentedControl
            value={c.device}
            onChange={(v) => save({ device: v })}
            options={[
              { value: 'cpu', label: t('CPU') },
              { value: 'embeddings', label: t('Same as Vector Search') },
            ]}
          />
        </div>
      </Group>

      {downloads.length > 0 && (
        <Group title="Downloads">
          {downloads.map((x) => (
            <TaskRow key={x.id} task={x} />
          ))}
        </Group>
      )}

      {NLP_TASKS.map((k) => {
        const rows = [{ id: '', name: t('Built-in rules'), note: '', meta: '' }, ...NLP_MODELS.filter((m) => m.task === k).map((m) => ({ id: m.id, name: m.name, note: m.note, meta: ` · ${m.languages} · ${mb(m.sizeMB)} · ${m.license}` }))];
        return (
          <Group key={k} title={TASKS[k].title} desc={t(TASKS[k].desc)} wide>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {rows.map((m) => {
                const selected = c.models[k] === m.id;
                const have = !m.id || installed.has(m.id);
                return (
                  <div key={m.id || 'rules'} className="row between" style={{ padding: '8px 10px', background: selected ? 'var(--bg2)' : 'var(--bg0)', gap: 12 }}>
                    <span style={{ minWidth: 0 }}>
                      <span style={{ fontWeight: 600 }}>{m.name}</span>
                      <span className="desc">{m.meta}</span>
                      {m.note && <span className="desc" style={{ display: 'block', fontSize: 12 }}>{t(m.note)}</span>}
                    </span>
                    <span className="row" style={{ gap: 6, flexShrink: 0 }}>
                      {m.id &&
                        (have ? (
                          <button type="button" className="btn small" title={t('Delete')} aria-label={t('Delete')} onClick={() => void run(api.deleteNlpModel(m.id))}>
                            <Trash size={14} />
                          </button>
                        ) : (
                          <button type="button" className="btn small" onClick={() => void run(api.downloadNlpModel(m.id))}>
                            <DownloadSimple size={14} /> {t('Download')}
                          </button>
                        ))}
                      <button type="button" className={`btn small ${selected ? 'primary' : ''}`} onClick={() => save({ models: { [k]: m.id } })}>
                        {selected ? t('In Use') : t('Use')}
                      </button>
                    </span>
                  </div>
                );
              })}
            </div>
          </Group>
        );
      })}

      <Group title="Check" wide>
        <SegmentedControl value={task} onChange={setTask} options={NLP_TASKS.map((k) => ({ value: k, label: t(TASKS[k].title) }))} />
        <textarea className="textarea" style={{ minHeight: 70 }} value={input} placeholder={t('Text to analyze (empty: a sample)')} onChange={(e) => setInput(e.target.value)} />
        <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
          <button
            type="button"
            className="btn"
            disabled={testing}
            onClick={async () => {
              setTesting(true);
              setOutput('');
              try {
                const r = await api.testNlp(task, input);
                setOutput(`${r.ms} ms\n${format(task, r.result)}`);
              } catch (e) {
                setOutput(`✗ ${(e as Error).message}`);
              }
              setTesting(false);
            }}
          >
            <Play size={14} /> {testing ? t('Testing…') : t('Run')}
          </button>
          <pre className={output.startsWith('✗') ? 'warning-text' : 'desc'} style={{ margin: 0, whiteSpace: 'pre-wrap', minWidth: 0, fontFamily: 'inherit' }}>{output}</pre>
        </div>
      </Group>
    </>
  );
}

function format(task: NlpTask, r: unknown): string {
  if (task === 'punctuation') {
    const p = r as { text: string; question: number };
    return `${p.text}\n${t('Question')}: ${Math.round(p.question * 100)}%`;
  }
  if (task === 'segmentation') return (r as string[]).map((s, i) => `${i + 1}. ${s}`).join('\n');
  if (task === 'language') return (r as { label: string; score: number }[]).map((x) => `${x.label} ${Math.round(x.score * 100)}%`).join('\n');
  return (r as { text: string; type: string; count: number }[]).map((e) => `${e.type} ${e.text}${e.count > 1 ? ` ×${e.count}` : ''}`).join('\n') || t('None found');
}
