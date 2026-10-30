/** Keep text readable on white and pale opaque icon backgrounds. */
export function iconForeground(
  material: string | undefined,
  color: string | undefined,
) {
  if (material !== 'fill' || !/^#[0-9a-f]{6}$/i.test(color || ''))
    return '#fff';
  const [r, g, b] = [1, 3, 5].map((offset) =>
    parseInt(color!.slice(offset, offset + 2), 16),
  );
  return r! * 0.299 + g! * 0.587 + b! * 0.114 >= 210 ? '#666666' : '#fff';
}
