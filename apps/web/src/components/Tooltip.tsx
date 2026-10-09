import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * One app-wide tooltip in place of the browser's native ones, which the desktop app's
 * Electron window doesn't reliably show. It reads an element's `title` (moved to `data-tip`
 * on first hover so the native tooltip stays away) and, for icon-only buttons with no
 * title, falls back to their `aria-label`.
 */
const SELECTOR = '[title], [data-tip], button[aria-label], a[aria-label], [role="button"][aria-label]';
const DELAY = 450;
const GAP = 6;
const MARGIN = 8;

function tipOf(el: HTMLElement): string {
  const title = el.getAttribute('title');
  if (title !== null) {
    el.removeAttribute('title');
    el.dataset.tip = title;
    // The title was the accessible name of an unlabelled icon-only control; keep it one.
    if (!el.hasAttribute('aria-label') && !el.textContent?.trim()) el.setAttribute('aria-label', title);
  }
  if (el.dataset.tip !== undefined) return el.dataset.tip;
  // aria-label only stands in for a tooltip when the control shows no text of its own.
  return el.textContent?.trim() ? '' : (el.getAttribute('aria-label') ?? '');
}

function findTarget(node: EventTarget | null): { el: HTMLElement; text: string } | null {
  let el = node instanceof Element ? node.closest<HTMLElement>(SELECTOR) : null;
  while (el) {
    const text = tipOf(el).trim();
    if (text) return { el, text };
    el = el.parentElement?.closest<HTMLElement>(SELECTOR) ?? null;
  }
  return null;
}

export function Tooltips() {
  const [tip, setTip] = useState<{ el: HTMLElement; text: string } | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let timer = 0;
    let current: HTMLElement | null = null;
    const hide = () => {
      window.clearTimeout(timer);
      current = null;
      setTip(null);
    };
    const over = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      const found = findTarget(e.target);
      if (found?.el === current) return;
      hide();
      if (!found) return;
      current = found.el;
      timer = window.setTimeout(() => {
        // Re-read: the label may have changed while the pointer rested (e.g. Dock/Undock).
        if (current === found.el && found.el.isConnected) setTip({ el: found.el, text: tipOf(found.el) || found.text });
      }, DELAY);
    };
    const out = (e: PointerEvent) => {
      if (current && !(e.relatedTarget instanceof Node && current.contains(e.relatedTarget))) hide();
    };
    document.addEventListener('pointerover', over, true);
    document.addEventListener('pointerout', out, true);
    document.addEventListener('pointerdown', hide, true);
    document.addEventListener('keydown', hide, true);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('blur', hide);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('pointerover', over, true);
      document.removeEventListener('pointerout', out, true);
      document.removeEventListener('pointerdown', hide, true);
      document.removeEventListener('keydown', hide, true);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('blur', hide);
    };
  }, []);

  // Below the element, centred, flipped above when there's no room, kept inside the window.
  useEffect(() => {
    if (!tip || !boxRef.current) return setPos(null);
    const r = tip.el.getBoundingClientRect();
    const b = boxRef.current.getBoundingClientRect();
    const left = Math.min(Math.max(MARGIN, r.left + r.width / 2 - b.width / 2), window.innerWidth - b.width - MARGIN);
    const below = r.bottom + GAP;
    const top = below + b.height + MARGIN > window.innerHeight ? Math.max(MARGIN, r.top - GAP - b.height) : below;
    setPos({ left, top });
  }, [tip]);

  if (!tip) return null;
  return createPortal(
    <div ref={boxRef} className="app-tooltip" role="tooltip" style={pos ? { left: pos.left, top: pos.top } : { left: 0, top: 0, visibility: 'hidden' }}>
      {tip.text}
    </div>,
    document.body,
  );
}
