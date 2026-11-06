import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Only exercise the disposable local identity instance. Enumerate the actual
// registrations so that newly added administration routes join this check.
export async function reviewAdminBoundaries({
  context,
  origin,
  evidence,
  promote,
}) {
  assert.match(origin, /^http:\/\/localhost:\d+$/);
  const routes = [];
  for (const file of ['main.go', 'management_api.go']) {
    const source = await readFile(
      path.resolve('../DuoYu-ID/server', file),
      'utf8',
    );
    for (const [, method, pattern] of source.matchAll(
      /m\.HandleFunc\("(\w+) (\/api\/admin\/[^"]+)"/g,
    )) {
      routes.push({
        method,
        pattern,
        url: origin + pattern.replace(/\{\w+\}/g, 'boundary-fixture'),
      });
    }
  }
  assert.ok(
    routes.some((r) => r.pattern === '/api/admin/developer-keys/{key}/rotate'),
  );
  assert.ok(
    routes.some((r) => r.pattern === '/api/admin/apps/{id}/users/{user}/role'),
  );
  const checks = [];
  async function probe(
    route,
    principal,
    expected,
    message,
    originHeader = origin,
  ) {
    const { method, pattern, url } = route;
    const headers = { 'X-Duoyu-Request': '1', Origin: originHeader };
    const options = {
      method,
      headers,
      ...(method === 'GET' ? {} : { data: {} }),
    };
    let status, body;
    if (principal === 'anonymous') {
      const response = await fetch(url, {
        method,
        headers,
        body: method === 'GET' ? undefined : '{}',
        redirect: 'error',
        signal: AbortSignal.timeout(5000),
      });
      status = response.status;
      body = await response.json();
    } else {
      const response = await context.request.fetch(url, {
        ...options,
        maxRedirects: 0,
        timeout: 5000,
      });
      try {
        status = response.status();
        body = await response.json();
      } finally {
        await response.dispose();
      }
    }
    checks.push({
      method,
      pattern,
      principal,
      status,
      passed: status === expected && body.msg === message,
    });
  }
  try {
    for (const route of routes) {
      await probe(route, 'anonymous', 401, '请先登录');
      await probe(route, 'ordinary', 403, '需要管理员权限');
    }
    assert.ok(
      checks.every((c) => c.passed),
      'Unexpected anonymous/ordinary admin access; see identity-admin-boundaries.json',
    );
    await promote();
    for (const route of routes.filter((r) => r.method !== 'GET')) {
      await probe(
        route,
        'admin-foreign-origin',
        403,
        '请求来源不受信任',
        'https://untrusted.example.invalid',
      );
    }
    assert.ok(
      checks.every((c) => c.passed),
      'Foreign-origin admin write was not rejected',
    );
  } finally {
    await writeFile(
      path.join(evidence, 'identity-admin-boundaries.json'),
      JSON.stringify({ routes: routes.length, checks }, null, 2),
    );
  }
  console.log(
    `PASS ${routes.length} identity admin routes, ${checks.length} real authorization and origin checks`,
  );
}
