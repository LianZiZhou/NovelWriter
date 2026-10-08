import { useEffect, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { t } from '../../i18n.ts';
import { useSettings } from '../../store/settings.ts';

/** One stop of the interactive tutorial: an element to point at and what to say about it. */
interface Step {
  target: string;
  title: string;
  body: string;
  /** Run before showing the step (e.g. open the sidebar the target lives in). */
  before?: () => void;
}

const STEPS: Step[] = [
  {
    target: '.ProseMirror',
    title: 'The Editor',
    body: 'This is your story. Type here; text you write, text the AI writes and your edits get different colours. Start a line with { to give the AI an instruction.',
  },
  {
    target: '.send-btn',
    title: 'Send',
    body: 'Send (Ctrl+Enter) asks the AI to continue the story. Retry gives you another version, and Undo/Redo walk through every generation.',
  },
  {
    target: '.left-sidebar',
    title: 'Story Library',
    body: 'All your stories, shelves and favorites. Import NovelAI, KoboldAI, AI Dungeon and other files with Import File or by dropping them on the window.',
    before: () => useSettings.getState().set({ leftOpen: true }),
  },
  {
    target: '.right-tabs',
    title: 'Story Options',
    body: "Story holds the AI model, Memory and Author's Note. Advanced holds the context, phrase bias and scripts. The sliders icon has generation settings, and the chat icon opens Side Chat.",
    before: () => useSettings.getState().set({ rightOpen: true, rightTab: 'story' }),
  },
  {
    target: '.field-box textarea[aria-label="memory"]',
    title: 'Memory',
    body: 'Memory is always sent to the AI, near the top of the context. Keep the most important facts about your story here.',
    before: () => useSettings.getState().set({ rightOpen: true, rightTab: 'story' }),
  },
  {
    target: '.lorebook-open',
    title: 'Lorebook',
    body: 'The Lorebook remembers characters, places and things, and only adds an entry to the context when its keys show up in the story.',
  },
  {
    target: '.settings-open, [aria-label="Open Settings"]',
    title: 'Settings',
    body: 'Connect AI providers, choose themes, set up text to speech and hotkeys. You can start this tutorial again from the account menu.',
  },
];

export const useTour = create<{ step: number | null; start: () => void; stop: () => void; go: (n: number) => void }>((set) => ({
  step: null,
  start: () => set({ step: 0 }),
  stop: () => set({ step: null }),
  go: (step) => set({ step }),
}));

function findTarget(sel: string): HTMLElement | null {
  for (const s of sel.split(',')) {
    const el = [...document.querySelectorAll<HTMLElement>(s.trim())].find((x) => x.offsetParent !== null || x.getClientRects().length);
    if (el) return el;
  }
  return null;
}

/** The guided tour: dims the page, outlines one element at a time and explains it. Missing targets are skipped. */
export function Tour() {
  const step = useTour((s) => s.step);
  const { stop, go } = useTour.getState();
  const [rect, setRect] = useState<DOMRect | null>(null);
  const cur = step === null ? null : STEPS[step];

  useEffect(() => {
    if (!cur) return;
    cur.before?.();
  }, [step]);
  useLayoutEffect(() => {
    if (!cur) return;
    let raf = 0;
    let tries = 0;
    const measure = () => {
      const el = findTarget(cur.target);
      if (el) {
        el.scrollIntoView({ block: 'nearest' });
        setRect(el.getBoundingClientRect());
      } else if (tries++ < 20) raf = requestAnimationFrame(measure);
      else setRect(null);
    };
    measure();
    const onResize = () => measure();
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
    };
  }, [step]);
  useEffect(() => {
    if (step === null) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') stop();
      else if (e.key === 'ArrowRight') go(Math.min(STEPS.length - 1, step + 1));
      else if (e.key === 'ArrowLeft') go(Math.max(0, step - 1));
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [step]);

  if (step === null || !cur) return null;
  const last = step === STEPS.length - 1;
  const pad = 6;
  const box = rect ? { left: rect.left - pad, top: rect.top - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 } : null;
  // Place the card beside the target where there is room, else centre it.
  const cardW = 340;
  const cardStyle: React.CSSProperties = box
    ? box.left + box.width + cardW + 24 < window.innerWidth
      ? { left: box.left + box.width + 16, top: Math.max(16, Math.min(box.top, window.innerHeight - 260)) }
      : box.left - cardW - 16 > 0
        ? { left: box.left - cardW - 16, top: Math.max(16, Math.min(box.top, window.innerHeight - 260)) }
        : { left: Math.max(16, (window.innerWidth - cardW) / 2), top: Math.min(window.innerHeight - 260, box.top + box.height + 16) }
    : { left: (window.innerWidth - cardW) / 2, top: window.innerHeight / 3 };
  return createPortal(
    <div className="tour" role="dialog" aria-modal="true" aria-label={t('Interactive Tutorial')}>
      {box ? <div className="tour-hole" style={box} /> : <div className="tour-dim" />}
      <div className="tour-card fade-in" style={{ ...cardStyle, width: cardW }}>
        <div className="tour-count">
          {step + 1} / {STEPS.length}
        </div>
        <h3>{t(cur.title)}</h3>
        <p>{t(cur.body)}</p>
        <div className="row between">
          <button type="button" className="link-btn" onClick={stop}>
            {t('Skip Tutorial')}
          </button>
          <span className="row" style={{ gap: 6 }}>
            <button type="button" className="btn small" disabled={step === 0} onClick={() => go(step - 1)}>
              {t('Back')}
            </button>
            <button type="button" className="btn small primary" autoFocus onClick={() => (last ? stop() : go(step + 1))}>
              {last ? t('Finish') : t('Next')}
            </button>
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
