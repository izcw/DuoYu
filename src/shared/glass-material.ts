/** CSS tokens are the single source for both DOM and WebGL glass materials. */
export function readGlassMaterial() {
  const style = getComputedStyle(document.documentElement);
  const number = (name: string) => {
    const value = Number(style.getPropertyValue(name).trim());
    if (!Number.isFinite(value))
      throw new Error(`Invalid glass token: ${name}`);
    return value;
  };
  const stop = (color: string, alpha: string) => {
    const channels = style
      .getPropertyValue(color)
      .trim()
      .split(/\s+/)
      .map(Number);
    if (channels.length !== 3 || channels.some((n) => !Number.isFinite(n)))
      throw new Error(`Invalid glass color: ${color}`);
    return new Float32Array([...channels.map((n) => n / 255), number(alpha)]);
  };
  return {
    start: stop('--glass-tint-start', '--glass-alpha-start'),
    end: stop('--glass-tint-end', '--glass-alpha-end'),
    optics: new Float32Array([
      (number('--glass-angle') * Math.PI) / 180,
      number('--glass-saturation'),
      number('--glass-rim-alpha'),
      number('--glass-top-alpha'),
    ]),
    blur: new Float32Array([
      number('--glass-blur-real'),
      number('--glass-blur-natural'),
      number('--glass-blur-soft'),
    ]),
  };
}
