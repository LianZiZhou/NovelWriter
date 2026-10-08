import { Bird, Cat, Ghost, Robot } from '@phosphor-icons/react';
import type { ReactNode } from 'react';

/** HypeBot avatars (our own icons on tinted tiles). "auto" picks one per comment. */
export const HYPEBOT_AVATARS: { id: string; label: string; hue: number; icon: (size: number) => ReactNode }[] = [
  { id: 'robot', label: 'Robot', hue: 250, icon: (n) => <Robot size={n} weight="duotone" /> },
  { id: 'cat', label: 'Cat', hue: 30, icon: (n) => <Cat size={n} weight="duotone" /> },
  { id: 'ghost', label: 'Ghost', hue: 190, icon: (n) => <Ghost size={n} weight="duotone" /> },
  { id: 'owl', label: 'Owl', hue: 110, icon: (n) => <Bird size={n} weight="duotone" /> },
];

export function pickAvatar(setting: string, seed: string) {
  const fixed = HYPEBOT_AVATARS.find((a) => a.id === setting);
  if (fixed) return fixed;
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return HYPEBOT_AVATARS[Math.abs(h) % HYPEBOT_AVATARS.length];
}

export function AvatarTile({ avatar, size = 40 }: { avatar: (typeof HYPEBOT_AVATARS)[number]; size?: number }) {
  return (
    <span className="avatar-tile" style={{ width: size * 2.2, height: size, background: `linear-gradient(90deg, hsl(${avatar.hue} 35% 30%), hsl(${avatar.hue} 30% 16%))` }}>
      {avatar.icon(size * 0.7)}
    </span>
  );
}
