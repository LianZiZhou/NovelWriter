import { useId } from 'react';

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Small seeded PRNG so a given seed always draws the same picture. */
function rng(seed: number) {
  let a = seed || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deterministic abstract artwork for a model (we ship no model art): a hue picked from the provider,
 * flowing contour lines and a glow seeded by the model id. Tinted to sit on the theme background.
 */
export function ModelThumb({ provider, id }: { provider: string; id: string }) {
  const uid = useId().replace(/:/g, '');
  const r = rng(hash(`${provider}/${id}`));
  const hue = hash(provider) % 360;
  const cx = 20 + r() * 60;
  const cy = 10 + r() * 30;
  const lines = Array.from({ length: 7 }, (_, i) => {
    const y = 4 + i * 6 + r() * 4;
    const a = r() * 18 - 9;
    const b = r() * 18 - 9;
    return `M -5 ${y} C 30 ${y + a}, 60 ${y + b}, 105 ${y + a / 2}`;
  });
  return (
    <svg viewBox="0 0 100 46" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <radialGradient id={`g${uid}`} cx={`${cx}%`} cy={`${cy * 2}%`} r="70%">
          <stop offset="0" stopColor={`hsl(${hue} 40% 55%)`} stopOpacity="0.35" />
          <stop offset="1" stopColor={`hsl(${hue} 45% 30%)`} stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="100" height="46" fill={`hsl(${hue} 22% 13%)`} />
      <rect width="100" height="46" fill={`url(#g${uid})`} />
      {lines.map((d, i) => (
        <path key={i} d={d} fill="none" stroke={`hsl(${(hue + i * 9) % 360} 35% 78%)`} strokeOpacity={0.1 + (i % 3) * 0.05} strokeWidth="0.8" />
      ))}
      <circle cx={cx} cy={cy} r={3 + r() * 5} fill={`hsl(${hue} 45% 82%)`} fillOpacity="0.18" />
    </svg>
  );
}
