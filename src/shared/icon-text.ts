/** Mixed text follows the Chinese layout when it contains Han characters. */
export function hasChinese(text: string) {
  return /\p{Script=Han}/u.test(text);
}
export function limitIconText(text: string) {
  return Array.from(text)
    .slice(0, hasChinese(text) ? 6 : 10)
    .join('');
}
