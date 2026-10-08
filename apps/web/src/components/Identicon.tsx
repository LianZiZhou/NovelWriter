/** 5×5 mirrored identicon in the theme's heading colour, seeded by a string. */
export function Identicon({ seed, size = 40 }: { seed: string; size?: number }) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  const cells: [number, number][] = [];
  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < 3; x++) {
      if ((h >>> (y * 3 + x)) & 1) {
        cells.push([x, y]);
        if (x < 2) cells.push([4 - x, y]);
      }
    }
  }
  return (
    <svg width={size} height={size} viewBox="-1 -1 7 7" aria-hidden="true">
      <rect x="-1" y="-1" width="7" height="7" fill="var(--bg2)" />
      {cells.map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill="var(--text-headings)" />
      ))}
    </svg>
  );
}
