import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { visibleTokenProbs, type TokenProb } from '@novelwriter/core';
import { useStory } from '../../store/story.ts';
import { useSettings } from '../../store/settings.ts';
import { t } from '../../i18n.ts';
import { Modal, ModalHeader } from '../../components/ui.tsx';
import type { TokenRange } from '../editor/pm.ts';

const pct = (lp: number) => `${(Math.exp(lp) * 100).toFixed(2)}%`;
const show = (tok: string) => tok.replace(/\n/g, '⏎').replace(/^ /, '␣') || '∅';

export function probLevel(lp: number): 'low' | 'mid' | 'high' {
  const p = Math.exp(lp);
  return p < 0.2 ? 'low' : p < 0.6 ? 'mid' : 'high';
}

/** The alternatives for one token, most likely first; picking one rewrites the story from there. */
export function Alternatives({ range, onPicked }: { range: TokenRange; onPicked?: () => void }) {
  const generating = useStory((s) => s.generating);
  const p: TokenProb = range.prob;
  const list = [...p.top].sort((a, b) => b[1] - a[1]);
  if (!list.some(([tok]) => tok === p.t)) list.unshift([p.t, p.lp]);
  const shown = list.reduce((a, [, lp]) => a + Math.exp(lp), 0);
  return (
    <div className="tp-alts">
      <table>
        <thead>
          <tr>
            <th>{t('Token')}</th>
            <th>{t('Probability')}</th>
          </tr>
        </thead>
        <tbody>
          {list.map(([tok, lp]) => (
            <tr key={tok} className={tok === p.t ? 'chosen' : ''}>
              <td>
                <button
                  type="button"
                  disabled={generating || tok === p.t}
                  title={tok === p.t ? t('Chosen token') : t('Use this token and continue from it')}
                  onClick={() => {
                    onPicked?.();
                    void useStory.getState().pickAlternative(range.node, range.from, range.to, tok);
                  }}
                >
                  <code>{show(tok)}</code>
                </button>
              </td>
              <td className={`tp-pct ${probLevel(lp)}`}>{pct(lp)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="tp-rest">
        {t('Total % Not Shown')}: {(Math.max(0, 1 - shown) * 100).toFixed(2)}%
      </div>
    </div>
  );
}

/** Popover shown when a token is clicked in the editor. */
export function TokenPopover({ range, rect, onClose }: { range: TokenRange; rect: DOMRect; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('mousedown', h);
    window.addEventListener('keydown', k);
    return () => {
      window.removeEventListener('mousedown', h);
      window.removeEventListener('keydown', k);
    };
  }, [onClose]);
  const left = Math.min(rect.left, window.innerWidth - 300);
  const below = rect.bottom + 6 + 320 < window.innerHeight;
  return createPortal(
    <div ref={ref} className="tp-popover fade-in" style={below ? { left, top: rect.bottom + 6 } : { left, bottom: window.innerHeight - rect.top + 6 }} role="dialog" aria-label={t('Token Probabilities')}>
      <Alternatives range={range} onPicked={onClose} />
    </div>,
    document.body,
  );
}

/** Token Probabilities modal (Ctrl+Alt+T): every token of the latest generation. */
export function TokenProbsModal({ onClose }: { onClose: () => void }) {
  const story = useStory((s) => s.current)!;
  const enabled = useSettings((s) => s.tokenProbabilities);
  const ranges = useMemo(() => {
    const all = visibleTokenProbs(story.history);
    const last = all[all.length - 1]?.node;
    return all.filter((r) => r.node === last);
  }, [story.history]);
  const [sel, setSel] = useState(ranges.length - 1);
  const range = ranges[Math.min(sel, ranges.length - 1)];
  return (
    <Modal onClose={onClose} width={720} label={t('Token Probabilities')} className="tp-modal">
      <ModalHeader
        title={t('Token Probabilities')}
        subtitle={t('The most likely tokens the AI could have chosen at each step of the last generation. Click a token to see its alternatives; picking one rewrites the story from there.')}
        onClose={onClose}
      />
      <div className="modal-body">
        {!ranges.length ? (
          <div className="muted" style={{ padding: '20px 0' }}>
            {enabled ? t('No token probabilities yet. Generate with a model that reports them.') : t('Enable Token Probabilities in Settings → AI Settings first.')}
          </div>
        ) : (
          <>
            <div className="tp-tokens">
              {ranges.map((r, i) => (
                <button type="button" key={`${r.from}-${i}`} className={`tp-chip ${probLevel(r.prob.lp)} ${i === sel ? 'active' : ''}`} onClick={() => setSel(i)} title={pct(r.prob.lp)}>
                  {show(r.prob.t)}
                </button>
              ))}
            </div>
            {range && <Alternatives key={`${range.from}`} range={range} onPicked={onClose} />}
          </>
        )}
      </div>
    </Modal>
  );
}
