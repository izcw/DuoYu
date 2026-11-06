/** Bound retained bytes even when Content-Length is absent or untrusted. */
export async function readResponseBytes(
  response: Response,
  limit: number,
  prefix = false,
): Promise<Uint8Array> {
  if (!Number.isSafeInteger(limit) || limit <= 0)
    throw new RangeError('Invalid response size limit');
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let complete = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        complete = true;
        break;
      }
      if (!value.byteLength) continue;
      const remaining = limit - size;
      if (value.byteLength > remaining && !prefix)
        throw new Error('响应内容超过大小限制');
      // Copy only the retained portion; do not keep an oversized backing buffer.
      const chunk = value.slice(0, remaining);
      chunks.push(chunk);
      size += chunk.byteLength;
      if (prefix && size === limit) break;
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  } finally {
    if (!complete) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function readMetadataHTML(response: Response) {
  // UTF-8 uses at most four bytes per character; retain the existing text cap.
  const bytes = await readResponseBytes(response, 2_000_000, true);
  return new TextDecoder().decode(bytes).slice(0, 500000);
}
