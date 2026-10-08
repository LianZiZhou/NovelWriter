import { useEffect, useState } from 'react';
import { X } from '@phosphor-icons/react';
import { speak } from '../tts/tts.ts';
import { pickAvatar } from './avatars.tsx';
import { useStory } from '../../store/story.ts';
import { useSettings } from '../../store/settings.ts';

/** HypeBot: a reading buddy that comments on new generations. */
export function Hypebot() {
  const comment = useStory((s) => s.hypebot);
  const mode = useSettings((s) => s.hypebotMode);
  const avatarSetting = useSettings((s) => s.hypebotAvatar);
  const delay = useSettings((s) => s.hypebotDelay);
  const [visible, setVisible] = useState(false);
  const [shown, setShown] = useState(0);
  // "Comment Streamed Response Delay": reveal the comment a few characters at a time.
  useEffect(() => {
    if (!comment) return;
    if (!delay) return setShown(comment.text.length);
    setShown(0);
    const id = setInterval(() => setShown((n) => (n >= comment.text.length ? (clearInterval(id), n) : n + 2)), delay * 10);
    return () => clearInterval(id);
  }, [comment, delay]);
  useEffect(() => {
    if (!comment) return;
    if (mode !== 'off' && useSettings.getState().ttsSpeakHypebot) speak(comment.text);
  }, [comment, mode]);
  useEffect(() => {
    if (!comment) return;
    setVisible(true);
    if (mode === 'automatic') {
      const id = setTimeout(() => setVisible(false), 15000);
      return () => clearTimeout(id);
    }
  }, [comment, mode]);
  if (mode === 'off' || !comment || !visible) return null;
  const avatar = pickAvatar(avatarSetting, comment.text);
  return (
    <div className="hypebot fade-in" aria-live="polite">
      <div className="bubble">
        <div className="row between">
          <span className="comment-name">HypeBot</span>
          <button type="button" className="icon-btn" onClick={() => setVisible(false)} aria-label="Dismiss">
            <X size={12} />
          </button>
        </div>
        <div>{comment.text.slice(0, shown)}</div>
      </div>
      <div className="avatar" style={{ background: `hsl(${avatar.hue} 30% 22%)` }}>
        {avatar.icon(30)}
      </div>
    </div>
  );
}
