export const collectionColors = {
  blue: ['蓝色', '#1a73e8'],
  purple: ['紫色', '#a142f4'],
  pink: ['粉色', '#d01884'],
  red: ['红色', '#d93025'],
  orange: ['橙色', '#fa903e'],
  yellow: ['黄色', '#f9ab00'],
  green: ['绿色', '#188038'],
  cyan: ['青色', '#007c83'],
  grey: ['灰色', '#85898f'],
} as const;
export type CollectionColor = keyof typeof collectionColors;
export function collectionColor(value: unknown): CollectionColor {
  return typeof value === 'string' && Object.hasOwn(collectionColors, value)
    ? (value as CollectionColor)
    : 'grey';
}
