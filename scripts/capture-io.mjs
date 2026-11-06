// Measure the real Dexie capture middleware and IndexedDB in a disposable browser.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { chromium } from '@playwright/test';

const evidence = await mkdtemp(path.resolve('work/capture-io-'));
const module = ts.transpileModule(
  await readFile(process.argv[2] ?? 'src/features/sync/capture.ts', 'utf8'),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  },
).outputText;
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage();
  await page.route('http://127.0.0.1/capture-test', (r) =>
    r.fulfill({
      contentType: 'text/html',
      body: '<title>IndexedDB capture test</title>',
    }),
  );
  await page.goto('http://127.0.0.1/capture-test');
  await page.addScriptTag({
    path: createRequire(import.meta.url).resolve('dexie'),
  });
  const report = await page.evaluate(
    async (url) => {
      const { installSyncCapture } = await import(url);
      const db = new Dexie('capture-' + crypto.randomUUID());
      db.version(1).stores({
        libraryItems: 'id',
        syncOutbox: 'id,createdAt',
        syncMeta: 'id',
      });
      let reads = 0,
        scans = 0,
        requested = 0;
      // Observe native requests without wrapping Dexie promises or changing their timing context.
      for (const method of ['get', 'getAll', 'getAllRecords']) {
        const original = IDBObjectStore.prototype[method];
        if (!original) continue;
        IDBObjectStore.prototype[method] = function (...args) {
          const req = original.apply(this, args);
          if (this.name === 'libraryItems') {
            if (method === 'get') requested++;
            else if (
              !args[0] ||
              (typeof args[0] === 'object' &&
                'query' in args[0] &&
                args[0].query == null)
            )
              scans++;
            req.addEventListener('success', () => {
              reads +=
                method === 'get'
                  ? Number(req.result !== undefined)
                  : req.result.length;
            });
          }
          return req;
        };
      }
      installSyncCapture(db, true);
      const key = (n) => 'item-' + String(n).padStart(5, '0');
      const reset = () => {
        reads = 0;
        scans = 0;
        requested = 0;
      };
      const metrics = (t) => ({
        ms: Math.round((performance.now() - t) * 10) / 10,
        reads,
        scans,
        requested,
      });
      try {
        await db.transaction('rw', db.libraryItems, async () => {
          Dexie.currentTransaction.idbtrans.syncRemote = true;
          await db.libraryItems.bulkAdd(
            Array.from({ length: 3200 }, (_, i) => ({
              id: key(i),
              name: 'base-' + i,
              icon: 'x'.repeat(160),
            })),
          );
        });
        reset();
        let start = performance.now();
        for (let i = 0; i < 20; i++)
          await db.libraryItems.put({ id: key(i), name: 'edit-' + i });
        const point = metrics(start);
        const ops = await db.syncOutbox.orderBy('createdAt').toArray();
        const pointExact =
          ops.length === 20 &&
          ops.every((op, i) => {
            const rows = Object.values(op.rows);
            return (
              rows.length === 1 &&
              rows[0].base.name === 'base-' + i &&
              rows[0].value.name === 'edit-' + i
            );
          });
        reset();
        start = performance.now();
        await db.libraryItems.bulkPut(
          Array.from({ length: 1000 }, (_, i) => ({
            id: key(i),
            name: 'bulk-' + i,
          })),
        );
        const bulk = metrics(start);
        const last = async () =>
          await db.syncOutbox.orderBy('createdAt').last();
        const bulkCount = Object.keys((await last()).rows).length;
        reset();
        start = performance.now();
        await db.libraryItems
          .where(':id')
          .between(key(20), key(30), true, false)
          .delete();
        const range = metrics(start),
          deleted = Object.values((await last()).rows);
        const rangeExact =
          deleted.length === 10 &&
          deleted.every(
            (row) =>
              row.value === null &&
              row.base.id >= key(20) &&
              row.base.id < key(30),
          );
        await db.transaction('rw', db.libraryItems, async () => {
          try {
            await db.libraryItems.bulkAdd([
              { id: key(0), name: 'duplicate' },
              { id: 'new', name: 'created' },
            ]);
          } catch (e) {
            if (e.name !== 'BulkError') throw e;
          }
        });
        const mixed = Object.values((await last()).rows);
        await db.libraryItems.bulkPut([
          { id: 'new', name: 'first' },
          { id: 'new', name: 'last' },
        ]);
        const repeated = Object.values((await last()).rows);
        const repeatedExact =
          repeated.length === 1 &&
          repeated[0].base.name === 'created' &&
          repeated[0].value.name === 'last';
        const count = await db.syncOutbox.count();
        try {
          await db.transaction('rw', db.libraryItems, async () => {
            await db.libraryItems.delete('new');
            throw Error('abort capture');
          });
        } catch (e) {
          if (e.message !== 'abort capture') throw e;
        }
        const rollbackExact =
          (await db.libraryItems.get('new')).name === 'last' &&
          (await db.syncOutbox.count()) === count;
        await db.libraryItems.clear();
        const cleared = Object.values((await last()).rows);
        const clearExact =
          cleared.length === 3191 &&
          cleared.every((row) => row.base !== null && row.value === null);
        const put = IDBObjectStore.prototype.put;
        let injected = false;
        IDBObjectStore.prototype.put = function (value, ...args) {
          if (this.name === 'syncOutbox') {
            injected = true;
            throw new DOMException(
              'Injected outbox write failure',
              'DataCloneError',
            );
          }
          return put.call(this, value, ...args);
        };
        let txAborted = false;
        try {
          await db.transaction('rw', db.libraryItems, async () => {
            await db.libraryItems
              .put({ id: 'fault', name: 'pending' })
              .catch(() => {});
          });
        } catch {
          txAborted = true;
        } finally {
          IDBObjectStore.prototype.put = put;
        }
        const faultRecord = await db.libraryItems.get('fault');
        await db.libraryItems.put({ id: 'fault', name: 'retry' });
        const retried = (await last()).rows['libraryItems:fault'];
        const outboxFailureAtomic =
          injected &&
          txAborted &&
          !faultRecord &&
          retried.base === null &&
          retried.value.name === 'retry';
        return {
          point,
          bulk,
          range,
          pointExact,
          repeatedExact,
          rollbackExact,
          clearExact,
          outboxFailureAtomic,
          txAborted,
          orphanedLocalWrite: !!faultRecord,
          bulkCount,
          rangeExact,
          partialExact:
            mixed.length === 1 &&
            mixed[0].id === 'new' &&
            mixed[0].base === null,
        };
      } finally {
        await db.delete();
      }
    },
    'data:text/javascript;base64,' + Buffer.from(module).toString('base64'),
  );
  await writeFile(
    path.join(evidence, 'results.json'),
    JSON.stringify(report, null, 2),
  );
  console.log('Evidence:', evidence, JSON.stringify(report));
  assert.ok(
    report.outboxFailureAtomic &&
      report.pointExact &&
      report.repeatedExact &&
      report.rollbackExact &&
      report.clearExact &&
      report.bulkCount === 1000 &&
      report.rangeExact &&
      report.partialExact,
  );
  assert.equal(
    report.point.scans,
    0,
    'single-row writes scanned the full library',
  );
  assert.ok(
    report.point.reads <= 40,
    '20 single-item updates should only read their original and resulting rows',
  );
  assert.equal(
    report.range.scans,
    0,
    'bounded delete scanned the full library',
  );
} finally {
  await browser.close();
}
