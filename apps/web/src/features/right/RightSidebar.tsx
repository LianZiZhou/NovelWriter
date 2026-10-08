import { CaretRight, SlidersHorizontal } from '@phosphor-icons/react';
import { useSettings } from '../../store/settings.ts';
import { t } from '../../i18n.ts';
import { Tabs } from '../../components/ui.tsx';
import { StoryTab } from './StoryTab.tsx';
import { AdvancedTab } from './AdvancedTab.tsx';
import { GenerationTab } from './GenerationTab.tsx';

export function RightSidebar({ onCollapse, mobileOpen }: { onCollapse: () => void; mobileOpen: boolean }) {
  const tab = useSettings((s) => s.rightTab);
  const set = useSettings((s) => s.set);
  return (
    <aside className={`right-sidebar ${mobileOpen ? 'mobile-open' : ''}`} aria-label={t('Story Options')}>
      <div className="right-tabs">
        <button type="button" className="icon-btn collapse" onClick={onCollapse} aria-label={t('Close right sidebar')} title={t('Close right sidebar')}>
          <CaretRight size={18} weight="fill" />
        </button>
        <Tabs
          className="grow"
          value={tab}
          onChange={(v) => set({ rightTab: v })}
          tabs={[
            { value: 'story', label: t('Story') },
            { value: 'advanced', label: t('Advanced') },
            { value: 'generation', label: <SlidersHorizontal size={22} />, ariaLabel: t('Generation Settings') },
          ]}
        />
      </div>
      <div className="right-body">
        {tab === 'story' && <StoryTab />}
        {tab === 'advanced' && <AdvancedTab />}
        {tab === 'generation' && <GenerationTab />}
      </div>
    </aside>
  );
}
