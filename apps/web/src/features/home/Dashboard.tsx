import { useEffect, useRef, useState } from 'react';
import { CaretRight, Plus, UploadSimple } from '@phosphor-icons/react';
import { scenarioToStory } from '@novelwriter/core';
import { useStory } from '../../store/story.ts';
import { useUI } from '../../store/ui.ts';
import { t } from '../../i18n.ts';
import { timeAgo } from '../../components/ui.tsx';
import { Logo } from '../../components/Logo.tsx';
import { NEWS } from './news.ts';
import { STARTERS } from '../newstory/scenarios.ts';

/** Home page shown when no story is open, laid out like the original dashboard. */
export function Dashboard() {
  const library = useStory((s) => s.library);
  const store = useStory.getState();
  const [news, setNews] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (expanded) return;
    const id = setInterval(() => setNews((n) => (n + 1) % NEWS.length), 9000);
    return () => clearInterval(id);
  }, [expanded]);
  const item = NEWS[news];
  const recent = library.slice(0, 3);

  return (
    <div className="dashboard">
      <section className="dash-hero">
        <svg className="dash-hero-art" viewBox="0 0 400 300" aria-hidden="true">
          <path d="M90 250 C 40 180, 120 90, 200 120 S 340 60, 330 170 S 220 300, 160 230" />
          <path d="M150 60 C 220 20, 290 70, 250 130" />
        </svg>
        <div className="dash-inner">
          <div className="row between dash-top">
            <div className="row dash-title">
              <Logo size={20} /> {t('Dashboard')}
            </div>
            <button type="button" className="dash-signup" onClick={() => useUI.getState().open('settings', { tab: 'providers' })}>
              {t('AI Providers')}
            </button>
          </div>
          <div className="row dash-news-head">
            <span>{t('Latest News')}</span>
            <span className="dash-dots" role="tablist">
              {NEWS.map((_, i) => (
                <button type="button" key={i} aria-label={`News ${i + 1}`} className={i === news ? 'active' : ''} onClick={() => setNews(i)} />
              ))}
            </span>
          </div>
          <div className="dash-news">
            <div className="row" style={{ gap: 10, position: 'relative' }}>
              <span className="dash-tag">{t(item.tag)}</span>
              <h2>{t(item.title)}</h2>
              {item.fresh && <span className="dash-new">{t('New!')}</span>}
            </div>
            <p className={expanded ? '' : 'clamp'}>{t(item.body)}</p>
            <button type="button" className="dash-more" onClick={() => setExpanded(!expanded)}>
              {expanded ? t('Read Less') : t('Read More')} <CaretRight size={14} weight="fill" />
            </button>
          </div>
        </div>
      </section>

      <section className="dash-section">
        <div className="dash-inner">
          <div className="dash-welcome">{t('Welcome back, Author')}</div>
          <div className="row between">
            <h2 className="dash-h">{recent.length ? t('Continue a Story') : t('Start your first Story')}</h2>
            <div className="row" style={{ gap: 18 }}>
              {recent.length > 0 && (
                <button type="button" className="dash-link" onClick={() => store.showNewStory()}>
                  <Plus size={16} weight="bold" /> {t('New Story')}
                </button>
              )}
              <button type="button" className="dash-link" onClick={() => fileRef.current?.click()}>
                <UploadSimple size={16} /> {t('Import File')}
              </button>
            </div>
          </div>
          <input
            ref={fileRef}
            type="file"
            hidden
            multiple
            accept=".story,.scenario,.lorebook,.json,.txt,.png"
            onChange={(e) => {
              if (e.target.files) void store.importFiles(e.target.files);
              e.target.value = '';
            }}
          />
          {recent.length === 0 ? (
            <button type="button" className="dash-new-story" onClick={() => store.showNewStory()}>
              <Plus size={18} weight="bold" />
              <span>{t('New Story')}</span>
            </button>
          ) : (
            <div className="dash-recent">
              {recent.map((m) => (
                <button type="button" key={m.id} className="dash-story" onClick={() => void store.openStory(m.id)}>
                  <span>
                    <span className="dash-story-title">{m.title || t('New Story')}</span>
                    <span className="dash-story-time">
                      {t('Last Edited')}: {timeAgo(m.updatedAt)}
                    </span>
                  </span>
                  <CaretRight size={16} weight="fill" />
                </button>
              ))}
            </div>
          )}

          <h2 className="dash-h" style={{ marginTop: 44 }}>
            {t('Need some inspiration?')}
          </h2>
          <div className="dash-tiles">
            {STARTERS.slice(0, 2).map((s) => (
              <button
                type="button"
                key={s.title}
                className="dash-tile"
                onClick={async () => {
                  const story = scenarioToStory({ ...s, placeholders: s.placeholders ?? [] });
                  await store.addStory(story);
                  if (story.placeholders.length) useUI.getState().open('placeholders');
                }}
              >
                <span className="dash-tile-title">{s.title}</span>
                <span className="dash-tile-desc">{s.description}</span>
              </button>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
