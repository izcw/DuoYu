import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

// A sustained workload on one real extension worker and a populated account.
// Concurrent callers enter the worker's normal request queue.
export async function measureSustainedSync({
  page,
  issuer,
  sub,
  syncPool,
  evidence,
}) {
  const session = await page.context().newCDPSession(page);
  const duration = 10 * 60_000,
    interval = 5_000,
    concurrency = 4;
  const samples = [],
    latencies = [];
  let expected, before, after;
  const resources = async () => {
    await session.send('HeapProfiler.collectGarbage');
    if (global.gc) global.gc();
    const { metrics } = await session.send('Performance.getMetrics');
    const dom = await session.send('Memory.getDOMCounters');
    const node = process.memoryUsage();
    return {
      pageHeapBytes: metrics.find((m) => m.name === 'JSHeapUsedSize')?.value,
      dom,
      nodeHeapBytes: node.heapUsed,
      nodeRssBytes: node.rss,
      poolTotal: syncPool.totalCount,
      poolIdle: syncPool.idleCount,
      poolWaiting: syncPool.waitingCount,
    };
  };
  const runBatch = async (count) =>
    page.evaluate(
      async ({ issuer, sub, count }) =>
        Promise.all(
          Array.from({ length: count }, async () => {
            const start = performance.now();
            const r = await chrome.runtime.sendMessage({
              type: 'duoyu-auth',
              action: 'sync',
              account: { issuer, sub },
              path: '/api/v1/sync/snapshot',
              method: 'GET',
            });
            const rows = r.data?.entities;
            return {
              ms: performance.now() - start,
              status: r.status,
              epoch: r.data?.epoch,
              revision: r.data?.revision,
              entities: rows?.length,
              bookmarks: rows?.filter(
                (e) =>
                  e.table === 'savedTabs' &&
                  !e.deleted &&
                  e.payload.title.startsWith('Restore original '),
              ).length,
            };
          }),
        ),
      { issuer, sub, count },
    );
  const percentile = (values, f) =>
    values.slice().sort((a, b) => a - b)[Math.ceil(values.length * f) - 1];
  let elapsed = 0,
    passed = false;
  try {
    await session.send('Performance.enable');
    [expected] = await runBatch(1);
    assert.ok(
      expected.status === 200 &&
        expected.bookmarks === 2001 &&
        expected.entities >= 2003 &&
        expected.epoch,
    );
    before = await resources();
    const start = performance.now();
    let minute = 0;
    while (performance.now() - start < duration) {
      const began = performance.now(),
        rows = await runBatch(concurrency);
      for (const row of rows) {
        assert.deepEqual(
          [row.status, row.epoch, row.revision, row.entities, row.bookmarks],
          [200, expected.epoch, expected.revision, expected.entities, 2001],
          'Authenticated snapshot changed or failed',
        );
        latencies.push(row.ms);
      }
      const elapsedMs = performance.now() - start;
      samples.push({
        elapsedMs: Math.round(elapsedMs),
        batchMs: Math.round(performance.now() - began),
        p95Ms: Math.round(
          percentile(
            rows.map((r) => r.ms),
            0.95,
          ),
        ),
        poolWaiting: syncPool.waitingCount,
      });
      if (Math.floor(elapsedMs / 60000) > minute) {
        minute = Math.floor(elapsedMs / 60000);
        console.log(
          `Sustained sync ${minute} min: ${latencies.length} verified snapshots`,
        );
      }
      await delay(
        Math.max(
          0,
          Math.min(
            interval - (performance.now() - began),
            duration - elapsedMs,
          ),
        ),
      );
    }
    elapsed = performance.now() - start;
    after = await resources();
    assert.equal(after.poolWaiting, 0);
    assert.equal(after.poolIdle, after.poolTotal);
    passed = true;
  } finally {
    try {
      await writeFile(
        path.join(evidence, 'sustained-sync.json'),
        JSON.stringify(
          {
            passed,
            elapsedMs: Math.round(elapsed),
            requests: latencies.length,
            concurrency,
            entities: expected?.entities,
            bookmarks: expected?.bookmarks,
            p50Ms: percentile(latencies, 0.5),
            p95Ms: percentile(latencies, 0.95),
            maxMs: latencies.length ? Math.max(...latencies) : null,
            before,
            after,
            samples,
            scope:
              'One real local extension worker, authenticated Go/Node/PostgreSQL, steady read-only workload. Node memory includes the test harness.',
          },
          null,
          2,
        ),
      );
    } finally {
      await session.detach();
    }
  }
  console.log(
    `PASS ${latencies.length} authenticated large snapshots over ten minutes, pool drained`,
  );
}
