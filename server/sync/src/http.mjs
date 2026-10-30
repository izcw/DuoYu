import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { ApiError, applyOperation, hash } from './store.mjs';
export function accountId(issuer, sub) {
  const h = hash(issuer + '\0' + sub)
    .slice(0, 32)
    .split('');
  h[12] = '4';
  h[16] = '8';
  const s = h.join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}
export async function createAuthenticator(config, dependencies = {}) {
  const transport = dependencies.transport ?? fetch;
  const r = await transport(
    config.issuer + '/.well-known/openid-configuration',
    { signal: AbortSignal.timeout(10000), redirect: 'error' },
  );
  if (!r.ok) throw Error('Discovery failed');
  const d = await r.json();
  if (
    d.issuer !== config.issuer ||
    new URL(d.jwks_uri).origin !== config.issuer ||
    new URL(d.userinfo_endpoint).origin !== config.issuer
  )
    throw Error('Issuer mismatch');
  const jwks =
    dependencies.keyResolver ?? createRemoteJWKSet(new URL(d.jwks_uri));
  return async (req) => {
    const token = /^Bearer ([^\s]+)$/.exec(
      req.headers.authorization ?? '',
    )?.[1];
    const identity = req.headers['x-duoyu-identity'];
    if (!token || typeof identity !== 'string')
      throw new ApiError(401, 'login_required');
    let claims;
    try {
      claims = (
        await jwtVerify(identity, jwks, {
          issuer: config.issuer,
          audience: config.clientId,
          algorithms: ['RS256'],
          requiredClaims: ['exp', 'iat', 'sub'],
        })
      ).payload;
    } catch {
      throw new ApiError(401, 'invalid_identity');
    }
    if (
      typeof claims.sub !== 'string' ||
      !claims.sub ||
      claims.iat > Date.now() / 1000 + 5 ||
      (claims.azp && claims.azp !== config.clientId) ||
      (Array.isArray(claims.aud) &&
        claims.aud.length > 1 &&
        claims.azp !== config.clientId)
    )
      throw new ApiError(401, 'invalid_identity');
    let u;
    try {
      u = await transport(d.userinfo_endpoint, {
        headers: { Authorization: 'Bearer ' + token },
        signal: AbortSignal.timeout(10000),
        redirect: 'error',
      });
    } catch {
      throw new ApiError(503, 'identity_unavailable');
    }
    if (!u.ok)
      throw new ApiError(u.status >= 500 ? 503 : 401, 'identity_rejected');
    const info = await u.json();
    if (info.sub !== claims.sub) throw new ApiError(401, 'subject_mismatch');
    return {
      id: accountId(config.issuer, claims.sub),
      issuer: config.issuer,
      sub: claims.sub,
    };
  };
}
export function createSyncServer({ pool, authenticate, origins }) {
  const rates = new Map();
  function limit(key, max = 240) {
    const now = Date.now();
    if (rates.size > 10000)
      for (const [k, v] of rates) if (v.until < now) rates.delete(k);
    const v = rates.get(key);
    if (v && v.until > now) {
      if (++v.count > max) throw new ApiError(429, 'rate_limited');
    } else rates.set(key, { count: 1, until: now + 60000 });
  }
  return createServer(async (req, res) => {
    const send = (status, data) => {
      res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(JSON.stringify(data));
    };
    try {
      const origin = req.headers.origin;
      if (origin && !origins.includes(origin))
        throw new ApiError(403, 'origin_denied');
      if (origin) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
      }
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers':
            'Authorization, Content-Type, X-Duoyu-Identity',
          'Access-Control-Max-Age': '600',
        });
        return res.end();
      }
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/healthz') {
        await pool.query('SELECT 1');
        return send(200, { ok: true, schemaVersion: 1 });
      }
      limit(req.headers['x-real-ip'] || req.socket.remoteAddress, 600);
      const account = await authenticate(req);
      limit(account.id);
      async function body(max) {
        let size = 0;
        const chunks = [];
        for await (const chunk of req) {
          size += chunk.length;
          if (size > max) throw new ApiError(413, 'body_too_large');
          chunks.push(chunk);
        }
        return Buffer.concat(chunks);
      }
      if (req.method === 'POST' && url.pathname === '/v1/sync/operations') {
        if (!req.headers['content-type']?.startsWith('application/json'))
          throw new ApiError(415, 'json_required');
        let op;
        try {
          op = JSON.parse((await body(4 * 1048576)).toString());
        } catch (e) {
          if (e.status) throw e;
          throw new ApiError(400, 'invalid_json');
        }
        return send(200, await applyOperation(pool, account, op));
      }
      if (
        req.method === 'GET' &&
        ['/v1/sync/snapshot', '/v1/sync/changes'].includes(url.pathname)
      ) {
        const db = await pool.connect();
        try {
          await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
          await db.query("SELECT set_config('app.account_id',$1,true)", [
            account.id,
          ]);
          const a = (
            await db.query(
              'SELECT id,head_revision::text FROM sync_accounts WHERE issuer=$1 AND subject=$2',
              [account.issuer, account.sub],
            )
          ).rows[0];
          const revision = a?.head_revision ?? '0';
          if (url.pathname.endsWith('/snapshot')) {
            const entities = a
              ? (
                  await db.query(
                    'SELECT entity_type AS table,entity_id AS id,payload,deleted,revision::text FROM sync_entities WHERE account_id=$1',
                    [a.id],
                  )
                ).rows
              : [];
            await db.query('COMMIT');
            return send(200, { schemaVersion: 1, revision, entities });
          }
          const after = url.searchParams.get('after') ?? '0';
          if (
            !/^(0|[1-9][0-9]*)$/.test(after) ||
            BigInt(after) > BigInt(revision)
          )
            throw new ApiError(410, 'snapshot_required');
          const changes = a
            ? (
                await db.query(
                  'SELECT revision::text,changes FROM sync_changes WHERE account_id=$1 AND revision>$2 AND revision<=$3 ORDER BY revision LIMIT 100',
                  [a.id, after, revision],
                )
              ).rows
            : [];
          await db.query('COMMIT');
          return send(200, {
            schemaVersion: 1,
            revision: changes.at(-1)?.revision ?? after,
            head: revision,
            operations: changes,
          });
        } catch (e) {
          await db.query('ROLLBACK');
          throw e;
        } finally {
          db.release();
        }
      }
      if (url.pathname.startsWith('/v1/assets/')) {
        const sha = url.pathname.slice('/v1/assets/'.length);
        if (!/^[0-9a-f]{64}$/.test(sha))
          throw new ApiError(400, 'invalid_hash');
        if (req.method === 'POST') {
          const type = req.headers['content-type'];
          if (
            !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(
              type,
            )
          )
            throw new ApiError(415, 'unsupported_image');
          const bytes = await body(20 * 1024 * 1024);
          if (hash(bytes) !== sha) throw new ApiError(400, 'hash_mismatch');
          const valid =
            type === 'image/png'
              ? bytes
                  .subarray(0, 8)
                  .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
              : type === 'image/jpeg'
                ? bytes[0] === 255 && bytes[1] === 216
                : type === 'image/gif'
                  ? bytes.subarray(0, 3).toString() === 'GIF'
                  : bytes.subarray(0, 4).toString() === 'RIFF' &&
                    bytes.subarray(8, 12).toString() === 'WEBP';
          if (!valid) throw new ApiError(415, 'invalid_image');
          const db = await pool.connect();
          try {
            await db.query('BEGIN');
            await db.query("SELECT set_config('app.account_id',$1,true)", [
              account.id,
            ]);
            await db.query(
              'INSERT INTO sync_accounts(id,issuer,subject) VALUES($1,$2,$3) ON CONFLICT(issuer,subject) DO NOTHING',
              [account.id, account.issuer, account.sub],
            );
            await db.query(
              'SELECT id FROM sync_accounts WHERE id=$1 FOR UPDATE',
              [account.id],
            );
            const size = (
              await db.query(
                'SELECT COALESCE(sum(octet_length(body)),0)::text AS bytes FROM sync_assets WHERE account_id=$1',
                [account.id],
              )
            ).rows[0].bytes;
            const existingAsset = (
              await db.query(
                'SELECT 1 FROM sync_assets WHERE account_id=$1 AND sha256=$2',
                [account.id, sha],
              )
            ).rowCount;
            if (
              !existingAsset &&
              BigInt(size) + BigInt(bytes.length) > 100n * 1024n * 1024n
            )
              throw new ApiError(413, 'asset_quota');
            await db.query(
              'INSERT INTO sync_assets(account_id,sha256,media_type,body) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',
              [account.id, sha, type, bytes],
            );
            await db.query('COMMIT');
          } catch (e) {
            await db.query('ROLLBACK');
            throw e;
          } finally {
            db.release();
          }
          return send(200, { sha256: sha });
        }
        if (req.method === 'GET') {
          const asset = (
            await scopedQuery(
              pool,
              account.id,
              'SELECT media_type,body FROM sync_assets WHERE account_id=$1 AND sha256=$2',
              [account.id, sha],
            )
          ).rows[0];
          if (!asset) throw new ApiError(404, 'asset_not_found');
          res.writeHead(200, {
            'Content-Type': asset.media_type,
            'Cache-Control': 'private, no-store',
            'X-Content-Type-Options': 'nosniff',
          });
          return res.end(asset.body);
        }
      }
      throw new ApiError(404, 'not_found');
    } catch (e) {
      if (res.headersSent) return res.end();
      if (e.status === 429) res.setHeader('Retry-After', '60');
      send(e.status ?? 500, { error: e.code ?? 'server_error' });
      if (!e.status) console.error('sync request failed', e.code ?? e.name);
    }
  });
}

async function scopedQuery(pool, id, sql, values) {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query("SELECT set_config('app.account_id',$1,true)", [id]);
    const result = await db.query(sql, values);
    await db.query('COMMIT');
    return result;
  } catch (e) {
    await db.query('ROLLBACK');
    throw e;
  } finally {
    db.release();
  }
}
