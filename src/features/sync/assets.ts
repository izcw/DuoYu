import { database } from '../../shared/storage/database';
export const ASSET_PREFIX = 'duoyu-asset:';
const active = new Map<string, Promise<Blob>>();
const urls = new Map<string, string>();
let transport:
  | ((
      path: string,
      method?: string,
      body?: unknown,
      binary?: boolean,
      mediaType?: string,
    ) => Promise<any>)
  | undefined;
export function connectAssetTransport(value: typeof transport) {
  transport = value;
}
export async function blobBase64(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let text = '';
  for (let i = 0; i < bytes.length; i += 8192)
    text += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(text);
}
export async function cacheAsset(blob: Blob) {
  if (blob.size > 20 * 1024 * 1024)
    throw Object.assign(Error('图片不能超过20MB'), { status: 413 });
  if (
    !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(blob.type)
  )
    throw Object.assign(Error('图片格式不支持，请使用PNG、JPEG、WebP或GIF'), {
      status: 415,
    });
  const sha = [
    ...new Uint8Array(
      await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()),
    ),
  ]
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('');
  const saved = await database.syncAssets.get(sha);
  await database.syncAssets.put({
    ...saved,
    id: sha,
    blob,
    createdAt: Date.now(),
  });
  return ASSET_PREFIX + sha;
}
export async function getAsset(reference: string): Promise<Blob> {
  const sha = reference.startsWith(ASSET_PREFIX)
    ? reference.slice(ASSET_PREFIX.length)
    : reference;
  if (!/^[0-9a-f]{64}$/.test(sha)) throw Error('图片引用无效');
  const saved = await database.syncAssets.get(sha);
  if (saved) return saved.blob;
  if (active.has(sha)) return active.get(sha)!;
  const job = (async () => {
    if (!transport) throw Error('图片下载服务未就绪');
    const r = await transport('/v1/assets/' + sha, 'GET', undefined, true);
    const blob = new Blob(
      [Uint8Array.from(atob(r.base64), (c) => c.charCodeAt(0))],
      { type: r.mediaType },
    );
    const digest = [
      ...new Uint8Array(
        await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()),
      ),
    ]
      .map((x) => x.toString(16).padStart(2, '0'))
      .join('');
    if (digest !== sha) throw Error('图片校验失败');
    await cacheAsset(blob);
    await database.syncAssets.update(sha, {
      uploadedEpoch: String(
        (await database.syncMeta.get('epoch'))?.value ?? '',
      ),
    });
    return blob;
  })();
  active.set(sha, job);
  try {
    return await job;
  } finally {
    active.delete(sha);
  }
}
export async function assetObjectUrl(reference: string) {
  if (urls.has(reference)) return urls.get(reference)!;
  const blob = await getAsset(reference);
  if (!urls.has(reference)) urls.set(reference, URL.createObjectURL(blob));
  return urls.get(reference)!;
}
export async function uploadAsset(
  reference: string,
  epoch: string,
  force = false,
) {
  const sha = reference.slice(ASSET_PREFIX.length);
  const saved = await database.syncAssets.get(sha);
  if (!saved) return reference;
  if (
    !force &&
    saved.uploadedEpoch === epoch &&
    saved.uploadedAt &&
    Date.now() - saved.uploadedAt < 5 * 60_000
  )
    return reference;
  if (!transport) throw Error('图片上传服务未就绪');
  // Chrome runtime messaging serializes JSON; Base64 is only used for this IPC
  // bridge. The background decodes it and sends binary bytes over HTTPS.
  await transport(
    '/v1/assets/' + sha,
    'POST',
    await blobBase64(saved.blob),
    true,
    saved.blob.type,
  );
  await database.syncAssets.update(sha, {
    uploadedEpoch: epoch,
    uploadedAt: Date.now(),
  });
  return reference;
}
export async function encodeAssets(
  value: any,
  epoch: string,
  upload = true,
): Promise<any> {
  if (value instanceof Blob) {
    const ref = await cacheAsset(value);
    return upload ? uploadAsset(ref, epoch, true) : ref;
  }
  if (typeof value === 'string' && value.startsWith('data:image/')) {
    const ref = await cacheAsset(await (await fetch(value)).blob());
    return upload ? uploadAsset(ref, epoch, true) : ref;
  }
  if (typeof value === 'string' && value.startsWith(ASSET_PREFIX))
    return upload ? uploadAsset(value, epoch) : value;
  if (typeof value === 'string' && value.startsWith('duoyu-icon:')) {
    let p;
    try {
      p = JSON.parse(value.slice(11));
    } catch {
      return value;
    }
    if (upload && p.mode !== 'upload') {
      if (p.image) p.image = '';
    } else if (p.image) p.image = await encodeAssets(p.image, epoch, upload);
    return 'duoyu-icon:' + JSON.stringify(p);
  }
  if (Array.isArray(value))
    return Promise.all(value.map((x) => encodeAssets(x, epoch, upload)));
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value))
      if (v !== undefined)
        result[k] = await encodeAssets(v, epoch, upload && k !== 'base');
    return result;
  }
  return value;
}
export function collectAssets(value: unknown): string[] {
  const refs = new Set<string>();
  function visit(v: unknown) {
    if (typeof v === 'string') {
      if (v.startsWith('duoyu-icon:')) {
        try {
          const icon = JSON.parse(v.slice(11));
          if (icon.mode === 'upload') visit(icon.image);
        } catch {}
        return;
      }
      for (const m of v.matchAll(/duoyu-asset:([0-9a-f]{64})/g))
        refs.add(ASSET_PREFIX + m[1]);
    } else if (Array.isArray(v)) v.forEach(visit);
    else if (v && typeof v === 'object' && !(v instanceof Blob))
      Object.values(v).forEach(visit);
  }
  visit(value);
  return [...refs];
}
/** Retain unsent work/conflicts and a 24h staging lease before freeing caches. */
export async function pruneAssetCache() {
  await database.transaction(
    'rw',
    [
      database.syncAssets,
      database.syncOutbox,
      database.syncConflicts,
      database.syncShadow,
    ],
    async () => {
      if (
        (await database.syncOutbox.count()) ||
        (await database.syncConflicts.toArray()).some((c) => !c.resolvedAt)
      )
        return;
      const refs = new Set(
        collectAssets(
          (await database.syncShadow.toArray()).filter((e) => !e.deleted),
        ),
      );
      for (const asset of await database.syncAssets.toArray()) {
        if (!asset.createdAt) {
          await database.syncAssets.update(asset.id, { createdAt: Date.now() });
          continue;
        }
        const ref = ASSET_PREFIX + asset.id;
        if (!refs.has(ref) && Date.now() - asset.createdAt > 86400000) {
          await database.syncAssets.delete(asset.id);
          const url = urls.get(ref);
          if (url) {
            URL.revokeObjectURL(url);
            urls.delete(ref);
          }
        }
      }
    },
  );
}
