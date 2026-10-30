/** Apply a luminance-preserving duotone directly to image pixels. */
export async function tintImage(
  source: string,
  color: string,
): Promise<string> {
  if (!/^#[0-9a-f]{6}$/i.test(color)) return source;
  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.src = source;
  await image.decode();
  const scale = Math.min(
    1,
    256 / Math.max(image.naturalWidth, image.naturalHeight),
  );
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  const rgb = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
  const neutral = rgb[0] === rgb[1] && rgb[1] === rgb[2];
  for (let i = 0; i < pixels.data.length; i += 4) {
    const l =
      (pixels.data[i]! * 0.2126 +
        pixels.data[i + 1]! * 0.7152 +
        pixels.data[i + 2]! * 0.0722) /
      255;
    for (let c = 0; c < 3; c++) {
      const tone = neutral
        ? color.toLowerCase() === '#ffffff'
          ? 120 + 135 * Math.pow(l, 0.45)
          : color.toLowerCase() === '#000000'
            ? 100 * Math.pow(l, 1.6)
            : 32 + 192 * l
        : l < 0.5
          ? rgb[c]! * Math.pow(l * 2, 0.55)
          : rgb[c]! + (255 - rgb[c]!) * (l * 2 - 1) * 0.3;
      // A small gamma lift brightens midtones while preserving black and white.
      const base = 255 * Math.pow(tone / 255, 0.92);
      // Lift only source highlights, fading smoothly in above 60% luminance.
      const highlight = Math.max(0, (l - 0.6) / 0.4);
      pixels.data[i + c] = Math.round(
        base + (255 - base) * highlight * highlight * 0.08,
      );
    }
  }
  context.putImageData(pixels, 0, 0);
  return canvas.toDataURL('image/png');
}
