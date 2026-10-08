import type { ModelRef } from '@novelwriter/core';
import { useStory } from '../../store/story.ts';
import { useUI } from '../../store/ui.ts';
import { t } from '../../i18n.ts';
import { Select } from '../../components/ui.tsx';
import { ModelThumb } from '../../components/ModelThumb.tsx';

/** Model dropdown grouped by provider; lists models of configured providers. */
export function ModelSelect({ value, onChange, className }: { value: ModelRef | null; onChange: (m: ModelRef) => void; className?: string }) {
  const models = useStory((s) => s.models);
  const key = (m: ModelRef) => `${m.provider}\u0000${m.id}`;
  const options = models.map((m) => ({
    value: key(m),
    label: m.name,
    group: m.provider,
    description: `${m.provider} · ${Math.round(m.contextWindow / 1000)}k ${t('context')}${m.reasoning ? ` · ${t('reasoning')}` : ''}`,
    image: <ModelThumb provider={m.provider} id={m.id} />,
  }));
  if (value && !models.some((m) => m.provider === value.provider && m.id === value.id)) {
    options.unshift({ value: key(value), label: value.id, group: value.provider, description: t('Not connected'), image: <ModelThumb provider={value.provider} id={value.id} /> });
  }
  return (
    <div className={`model-select ${className ?? ''}`}>
      <Select
        rich
        value={value ? key(value) : null}
        options={options}
        searchable={options.length > 8}
        ariaLabel={t('AI Model')}
        placeholder={t('Connect an AI provider…')}
        onChange={(v) => {
          const [provider, id] = v.split('\u0000');
          onChange({ provider, id });
        }}
      />
      {models.length <= 1 && (
        <button type="button" className="link-btn" style={{ marginTop: 6 }} onClick={() => useUI.getState().open('settings', { tab: 'providers' })}>
          + {t('Sign in to an AI provider')}
        </button>
      )}
    </div>
  );
}
