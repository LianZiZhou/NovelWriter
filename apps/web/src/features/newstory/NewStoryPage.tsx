import { useMemo, useState } from 'react';
import { Play, Sword, TextAlignLeft } from '@phosphor-icons/react';
import { scenarioToStory } from '@novelwriter/core';
import { useStory } from '../../store/story.ts';
import { useUI } from '../../store/ui.ts';
import { t } from '../../i18n.ts';
import { STARTERS } from './scenarios.ts';

const STORY_PREVIEW =
  'You are a seasoned wizard of old. Comfortably seated in your most glorious of thrones, your eyes rest upon the curvature of the perfect object before you. This is your favorite pastime and your true purpose. Within its depths, you watch and ponder what you see in the orb: scenes of natural splendor, but also scenes of war and destruction.';
const ADV_PREVIEW = 'There are Corgis lined up as far as your eyes can see. Small Corgis, large Corgis, fat Corgis.\n> You look around for something to fight with.\nYou have only two options: Walk or Fight. Which will you choose?';

export function NewStoryPage() {
  const store = useStory.getState();
  const [seed, setSeed] = useState(0);
  const picks = useMemo(() => {
    const arr = [...STARTERS];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = (i * 7 + seed * 13) % (i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr.slice(0, 1);
  }, [seed]);

  const start = async (mode: 'storyteller' | 'adventure') => {
    await store.createStory({ mode });
    setTimeout(() => useStory.getState().editor?.focus(), 50);
  };

  return (
    <div className="new-story-page">
      <div className="new-story-inner">
        <h1>{t("Let's start writing!")}</h1>
        <div className="lead">{t('What kind of experience do you want to have?')}</div>
        <div className="mode-cards">
          <button type="button" className="mode-choice" onClick={() => void start('storyteller')}>
            <span className="mode-icon" style={{ color: 'var(--text-headings)' }}>
              <TextAlignLeft size={34} />
            </span>
            <h2>{t('Storyteller')}</h2>
            <p>{t('Write alongside the AI to flesh out your writing and ideas.')}</p>
            <div className="preview" aria-hidden="true">
              <div style={{ fontFamily: 'var(--font-headings)', fontWeight: 700, marginBottom: 6 }}>Celestial Curves</div>
              {STORY_PREVIEW}
            </div>
          </button>
          <button type="button" className="mode-choice adventure" onClick={() => void start('adventure')}>
            <span className="mode-icon">
              <Sword size={34} />
            </span>
            <h2>{t('Text Adventure')}</h2>
            <p>{t('Begin an AI-generated quest using words and actions.')}</p>
            <div className="preview" aria-hidden="true" style={{ whiteSpace: 'pre-line' }}>
              <div style={{ fontFamily: 'var(--font-headings)', fontWeight: 700, marginBottom: 6 }}>Army of what?!</div>
              {ADV_PREVIEW}
            </div>
          </button>
        </div>

        <div className="row between" style={{ marginTop: 56, alignItems: 'flex-end' }}>
          <div>
            <h2 style={{ fontSize: 22 }}>
              <span style={{ color: 'var(--text-headings)' }}>{t("Can't think of any ideas?")}</span> {t('Pick one of ours to get started.')}
            </h2>
            <div style={{ fontSize: 14, marginTop: 8 }}>{t('Choose a scenario below. Placeholders let you personalize it before you start.')}</div>
          </div>
          <button type="button" className="btn" style={{ fontSize: 16, padding: '10px 14px' }} onClick={() => setSeed(seed + 1)}>
            {t('Shuffle')}
          </button>
        </div>
        <div className="scenario-grid">
          {picks.map((s) => (
            <div key={s.title} className="scenario-card">
              <div className="head">
                <div className="row between">
                  <h3>{s.title}</h3>
                  <button
                    type="button"
                    className="title-btn"
                    aria-label={t('Start')}
                    onClick={async () => {
                      const story = scenarioToStory({ ...s, placeholders: s.placeholders ?? [] });
                      await store.addStory(story);
                      if (story.placeholders.length) useUI.getState().open('placeholders');
                    }}
                  >
                    <Play size={16} weight="fill" />
                  </button>
                </div>
                <div className="muted" style={{ fontSize: 15 }}>by {s.author}</div>
                <div className="row" style={{ gap: 8, marginTop: 8 }}>
                  {s.mode === 'adventure' && (
                    <span className="chip" style={{ background: 'var(--text-main)', color: 'var(--bg1)' }}>
                      {t('Text Adventure')}
                    </span>
                  )}
                  {s.tags.map((tag) => (
                    <span key={tag} className="chip" style={{ background: 'transparent', opacity: 0.6 }}>
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
              <div className="body">{s.description}</div>
            </div>
          ))}
          <button
            type="button"
            className="scenario-card"
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 230 }}
            onClick={() => setSeed(seed + 1)}
          >
            <h3 style={{ color: 'var(--text-headings)', fontSize: 18 }}>{t('View All Scenarios')}</h3>
            <div className="muted" style={{ fontSize: 14 }}>{STARTERS.map((s) => s.title).join(' · ')}</div>
          </button>
        </div>
      </div>
    </div>
  );
}
