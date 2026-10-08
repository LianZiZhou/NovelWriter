import { useEffect, useState } from 'react';
import { Robot, X } from '@phosphor-icons/react';
import { useStory } from '../../store/story.ts';
import { useSettings } from '../../store/settings.ts';

/** HypeBot: a reading buddy that comments on new generations. */
export function Hypebot() {
  const comment = useStory((s) => s.hypebot);
  const mode = useSettings((s) => s.hypebotMode);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!comment) return;
    setVisible(true);
    if (mode === 'automatic') {
      const id = setTimeout(() => setVisible(false), 15000);
      return () => clearTimeout(id);
    }
  }, [comment, mode]);
  if (mode === 'off' || !comment || !visible) return null;
  return (
    <div className="hypebot fade-in" aria-live="polite">
      <div className="bubble">
        <div className="row between">
          <span className="comment-name">HypeBot</span>
          <button type="button" className="icon-btn" onClick={() => setVisible(false)} aria-label="Dismiss">
            <X size={12} />
          </button>
        </div>
        <div>{comment.text}</div>
      </div>
      <div className="avatar">
        <Robot size={30} weight="duotone" />
      </div>
    </div>
  );
}
