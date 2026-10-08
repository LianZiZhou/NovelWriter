/** NovelWriter mark: a quill nib over a baseline. */
export function Logo({ size = 18, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <path fill={color} d="M7 26 19.5 4.5c.6-1 2.1-.9 2.5.2l4.4 11.6c.3.8-.1 1.7-.9 2l-5.6 2.2L7 26Zm4.2-3.3 8.1-3.3-1.6-4.2-6.5 7.5Z" />
      <path fill={color} d="M5 28h22v2H5z" />
    </svg>
  );
}
