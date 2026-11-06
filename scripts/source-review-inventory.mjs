// Inventory is a work queue, not evidence that a file has been reviewed.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
const out = path.resolve('work/review-2026-11-04');
await mkdir(out, { recursive: true });
const roots = ['DuoYu-Extensions', 'DuoYu-Backend', 'DuoYu-ID'];
const reviewed = new Map([
  [
    'DuoYu-ID/scripts/restore-check.ps1',
    {
      reviewedSha256:
        '974d382d11a73ea00bc10d59ae2916d1c5e7fe66ae72e0ad3f468eb38864c4d8',
      scope:
        'Complete script: fresh database guard, manifest/file integrity, paths, links, transaction and cleanup',
      finding:
        'P2 incomplete manifests could bypass integrity checks; fixed before any database call',
      evidence: [
        'restore-manifest-before-confirmed.log',
        'restore-manifest-final-host.log',
        '../restore-drill-gEn3ii/results.json',
      ],
    },
  ],
  [
    'DuoYu-ID/scripts/backup.ps1',
    {
      reviewedSha256:
        '135e2f5aa5cc623e0a16c80628c2451411458b35a797ec1b6690f6f0d35f5556',
      scope:
        'Complete script: exclusive target directory, pg_dump, data copy, manifest and temporary dump cleanup',
      finding:
        'No change this batch; application writes must be stopped for database/files consistency, as documented',
      evidence: [
        '../restore-drill-gEn3ii/id-backup.log',
        '../restore-drill-gEn3ii/results.json',
      ],
    },
  ],
  [
    'DuoYu-Backend/server/sync/src/snapshot-backup.mjs',
    {
      reviewedSha256:
        'a0ed34edd65c2c5ff11fadb235aa5b58c2339b329ee727aa00f099521fd9b0cf',
      scope:
        'Complete module: chunk authentication, file/object validation, immutable manifests, pruning and reconstruction',
      finding:
        'No new confirmed defect this batch; callers must serialize creation/pruning and coordinate file collection',
      evidence: ['../restore-drill-gEn3ii/results.json'],
    },
  ],
  [
    'DuoYu-Backend/server/sync/src/backup.mjs',
    {
      reviewedSha256:
        '7dfb71e17b08b1421920d5716a084474b40f2d3b3a7fad98f3f6d977de8b5d46',
      scope:
        'Complete orchestration: database dump, encrypted snapshot, collection lock and cleanup',
      finding:
        'Production-only entrypoint reviewed; not executed in this synthetic restore drill',
      evidence: ['../restore-drill-gEn3ii/results.json'],
    },
  ],
  [
    'DuoYu-Backend/server/sync/src/backup-lock.mjs',
    {
      reviewedSha256:
        '19a62da413b3a0b13314ebd26b821fd83f365dc19612c6d8efee07d54dd254a0',
      scope:
        'Complete helper: PostgreSQL session advisory lock and child stdin/exit lifetime',
      finding:
        'Production-only runuser/psql paths; lock protocol reviewed, not exercised by this drill',
      evidence: [],
    },
  ],
  [
    'DuoYu-Backend/server/sync/test/snapshot-backup.test.mjs',
    {
      reviewedSha256:
        '3ce8dc65c59494556cb89ab35207b7d6e9de4e9efb4112725f9d9f3ece6ca33b',
      scope:
        'Complete test: seven retained points, deduplication, corruption and path rejection assertions',
      finding:
        'Existing test restores synthetic dump bytes; new drill additionally performs real pg_restore',
      evidence: [
        '../linux-release-HEB1Bm/results.json',
        '../restore-drill-gEn3ii/results.json',
      ],
    },
  ],
]);
for (const [file, reviewedSha256, scope, finding] of [
  [
    'DuoYu-Backend/server/backend/auth.go',
    '77a04c06b0022baa98c0d7bdbcb554e13c417818d3b285a21dd4729f4180b893',
    'Complete module: OIDC callback, encrypted sessions, CSRF, serialized refresh, UserInfo and logout',
    'Fixed CSRF after remote rotation, lost rotated credentials on UserInfo failure, and false successful logout on DELETE failure',
  ],
  [
    'DuoYu-Backend/server/backend/main.go',
    'dc1787933ecf69dbfdd3f88596d3e036d6bf38f7ce564c12c3f072cd744579a8',
    'Complete module: identity pairing, account recording, disabled account gate, HTTP routing, proxy and lifecycle',
    'No change this batch; existing integration and Linux entrypoint checks retained',
  ],
  [
    'DuoYu-Backend/server/sync/src/http.mjs',
    '8c48e11c0effd0fa5a9be1d3e20a276fb3fb1cc32a229ea9787be5b39461fb39',
    'Complete module: OIDC pairing, online UserInfo, origins, limits, snapshots, changes, backup restore and legacy asset endpoints',
    'No change this batch; preserve legacy asset behavior; current production files use Go gateway',
  ],
  [
    'DuoYu-Extensions/src/features/auth/protocol.ts',
    '5806e52b4452356a0938cd24f7e72f3b914979aa73027f139b3f8679bdf31a21',
    'Complete module: discovery endpoints, PKCE, callback, token exchange, signed claims, profile and revocation',
    'No change this batch; auth-protocol and actual four-service login/refresh/logout tests apply',
  ],
  [
    'DuoYu-Extensions/src/features/auth/config.ts',
    '533f111b4b971df323d23211f8ac359e5726bfad81a29faf41ad91886bd66d86',
    'Complete module: public OIDC configuration, account/session types',
    'Worktree change observed after previous review: scope deduplicates and includes offline_access; re-reviewed and real omitted-scope login/refresh/restart/logout passed in auth-isolated-9X0Ru9; no client secret',
  ],
  [
    'DuoYu-Extensions/src/features/auth/login-window.ts',
    '91795e48e580cac9094ff5490d5cc2101c15dbdfca54a7c51938e3fa4d08bb95',
    'Complete module: authorization popup bounds, created-window filter, URL check and listener cleanup',
    'No change; actual popup and cross-tab auth integration applies',
  ],
  [
    'DuoYu-ID/admin/src/views/duoyu/project-roles/index.vue',
    'ff855ca7ede92ae00be0ca07ff4922c860daf4690b2e3bc284c2969f8354a199',
    'Complete component: roles/member modes, route generations, mutation feedback, dirty guards and responsive heading',
    'Fixed member email heading overflow at 390px, confirmed in YHAFqL screenshot; added deterministic long mailbox check',
  ],
])
  reviewed.set(file, {
    reviewedSha256,
    scope,
    finding,
    evidence: [
      'AUTH-DELIVERY.md',
      'admin-auth-order-before.log',
      'admin-userinfo-rotation-before.log',
      'admin-auth-final-linux.log',
      'auth-wrap-final-integration.log',
      'admin-auth-extension-protocol.log',
    ],
  });
for (const [file, reviewedSha256, scope, finding] of [
  [
    'DuoYu-Backend/server/sync/src/store.mjs',
    '2ee737705bd33702948e5108c90ba56bcd6005d24f9b57febad3dbc1d88a3037',
    'Complete module: operation/schema checks, merge, graph quota, serialized commits, backup restore, assets and receipts',
    'Fixed whole-account restore incorrectly sharing the 2,000 client batch limit; existing tombstone and 8 MiB quotas preserved',
  ],
  [
    'DuoYu-Backend/server/backend/assets.go',
    '3e09ee684852957025a02db7bdbcc0442d0e943ecd37df53d1c0190e0ee7acbb',
    'Complete module: multipart input, per-account quota lock, atomic file installation, serving and legacy migration',
    'No change this batch; real upload and account isolation integration retained',
  ],
  [
    'DuoYu-Backend/server/backend/asset_lifecycle.go',
    '9dc183d9ee1242b14565d7fdf3917de5d3e7ade055d063730722a0b57a8b1967',
    'Complete module: reference-aware cleanup, delete paths, backup coordination and orphan scanning',
    'No change this batch; lifecycle regression covered in Linux backend suite; no production cleanup executed',
  ],
  [
    'DuoYu-Backend/server/backend/asset_lifecycle_test.go',
    '5034e9e05f5ba69bb91226d0c22a581549fa726cc2e6a05cdf17c0fca1196994',
    'Complete tests: asset references, cleanup coordination, files and account boundaries',
    'Existing tests retained and executed in Linux backend suite',
  ],

  [
    'DuoYu-Extensions/src/features/auth/AccountBackups.vue',
    '042344020d1f2fa5bc725e6c7b52d60616af9f9e1856e42be9f8d0cdce94d62a',
    'Complete component: backup list, confirmation, busy state, restore error and success feedback',
    'No component changes; real UI recovered 2,001 bookmarks and matched server plus IndexedDB',
  ],
  [
    'DuoYu-Backend/server/sync/test/large-restore.test.mjs',
    'c93608ef5dfad39c527b8511c67dbebbf13d04cacccfc8b4ccc4a5e13cf1aaac',
    'Complete new test: actual HTTP/PG, 2,001 and 10,000 entities, rollback, isolation, revision and idempotency',
    'Tests pass in Windows and Linux dedicated databases; fixture auth is injected for API tests, real OIDC separately covered',
  ],
]) {
  reviewed.set(file, {
    reviewedSha256,
    scope,
    finding,
    evidence: [
      'LARGE-RESTORE-DELIVERY.md',
      'large-restore-before.log',
      'large-restore-maximum.log',
      '../auth-isolated-ek8YHG/large-restore.json',
      '../linux-release-N92tEu/results.json',
    ],
  });
}
for (const [file, reviewedSha256, scope, finding] of [
  [
    'DuoYu-Extensions/wxt.config.ts',
    '5eeae098a66ce2b097c3afcf007ad250c7064952e78e8b6786de3425fd10ab68',
    'Complete build config: issuer/client scope validation, permissions and optional public identity key',
    'Added canonical RSA SPKI public-key validation and manifest key; persistent unpacked distribution public key; actual ZIP on both browsers and both directories has its registered ID',
  ],
  [
    'DuoYu-Extensions/scripts/extension-identity-ui.mjs',
    '47d2d535ff70eb575b91b17e2080bc860b65c372b0bffdc18ad10b12cf4bb848',
    'Complete test: invalid keys, production build with disposable public key, actual browser IDs and redirect URIs',
    'Actual extracted ZIP and copied directory matched the new production project registration on Chrome and Edge',
  ],
  [
    'DuoYu-Extensions/scripts/fixtures/large-account-restore.mjs',
    'e21cf4593e9d4a8de1c7f0d712ef778ac2d35bf14bc960e4d26c3270df68c009',
    'Complete fixture: actual worker requests, 2,001 bookmarks, real restore confirmation and IndexedDB/server comparisons',
    'Passed with existing unpacked identity and with a temporary fixed public identity key',
  ],
]) {
  reviewed.set(file, {
    reviewedSha256,
    scope,
    finding,
    evidence: [
      'LARGE-RESTORE-DELIVERY.md',
      '../extension-identity-yW92B7/results.json',
      '../auth-isolated-G3T6v4/results.json',
      'DISTRIBUTION-DELIVERY.md',
      '../extension-identity-4kmHuW/results.json',
    ],
  });
}
reviewed.set('DuoYu-Extensions/extension-identity.json', {
  reviewedSha256:
    'ebf130a5be694ee5f76ae8ff3a5739a7acbda14e63e3b8114d9d553ff62baed6',
  scope:
    'Persistent unpacked release public identity, checked against final archive and browsers',
  finding: 'Passed with the fixed distribution identity',
  evidence: [
    'DISTRIBUTION-DELIVERY.md',
    '../auth-isolated-8bYbxr/distribution-migration.json',
    '../extension-identity-4kmHuW/results.json',
  ],
});
reviewed.set('DuoYu-Extensions/scripts/fixtures/distribution-migration.mjs', {
  reviewedSha256:
    '8d57063a0562704cc31d49963eb4173d98229304c8a5fe80b80437d9c896a35f',
  scope:
    'Real legacy UI export and new account UI import, cloud persistence and duplicate rejection',
  finding: 'Passed with the fixed distribution identity',
  evidence: [
    'DISTRIBUTION-DELIVERY.md',
    '../auth-isolated-8bYbxr/distribution-migration.json',
    '../extension-identity-4kmHuW/results.json',
  ],
});
for (const [file, reviewedSha256, scope, finding] of [
  [
    'DuoYu-Backend/server/backend/admin.go',
    'e0a88e3ac3f97ede17dfe5271859b1b9222e6413f78ba8668593eca8e728f5f4',
    'Administrative routes, catalog write versioning, quota checks and queue error mapping',
    'Fixed configuration validation/write races; queue storage failures now reach the 500 handler',
  ],
  [
    'DuoYu-Backend/server/backend/templates.go',
    '1066eac706958fa7cc694a6cda309102f8211b276ca5a750664358aac809c904',
    'Template capture, publication, selection, account initialization, asset quotas and copy/idempotency',
    'Default selection, mutation, quota and fresh-account use coordinated under transaction locks',
  ],
  [
    'DuoYu-Backend/server/backend/jobs.go',
    'eeb47de243441d6d75fd21cc8a8698438173241551d8ad6e3f1d66decb786cc7',
    'Admission, audit, single worker, interrupted jobs, terminal updates and shutdown',
    'Concurrent same-kind admissions serialize; job and audit commit together; independent kinds remain independent',
  ],
  [
    'DuoYu-Backend/server/backend/template_concurrency_test.go',
    '7c8efa681ca94f7b6b9ddabef3545b65e996ab3dab7fd02e5ef44ba2bce005e3',
    'Database barriers and two administrative requests: archive/delete/recapture/quota against default selection',
    'All four invalid states reproduced before fix; final Windows and Linux regression passed',
  ],
  [
    'DuoYu-Backend/server/backend/jobs_concurrency_test.go',
    'd7af698e89683df204c4723c8b9babec72c5b5a82c3e3911f29889bbfd0275c0',
    'Same-kind concurrent requests, independent kind, running/finished retry, failed insert and recovery',
    'Duplicate 202/202 and incorrect 409 on failure reproduced, fixed and retested in PostgreSQL',
  ],
  [
    'DuoYu-Backend/server/backend/catalog.go',
    '53201f6beadade1a9132f1d1b4aa46a469f6341374c8ba23bbbc42eb89467b4f',
    'Catalog image upload, hashing, validation, preview access and serving',
    'Read with versioned catalog mutation routes; real published/draft wallpaper regression retained',
  ],
]) {
  reviewed.set(file, {
    reviewedSha256,
    scope,
    finding,
    evidence: [
      'TEMPLATE-QUEUE-DELIVERY.md',
      'template-concurrency-before.log',
      'queue-before.log',
      '../linux-release-9sPrcI/backend-linux-tests.log',
      '../auth-isolated-p6gQv6/results.json',
    ],
  });
}
for (const [file, reviewedSha256, scope, finding] of [
  [
    'DuoYu-Extensions/src/features/sync/import-json.ts',
    'bfe4e9dc8e9c5ffdcb0fb28d9fb7ad2843df892d1108c45b497f65ea60e4b97e',
    'Portable JSON parsing, reference mapping, packing, account binding, atomic media/data/receipt and limits',
    'Fixed stale imports, incomplete media rollback and spurious overflow pages; server persisted 1202 items on 11 pages',
  ],
  [
    'DuoYu-Extensions/src/features/desktop/desktop-backup.ts',
    'd9c1df608b9057aa9ebc5d6dad2a6d9d9173967ad2b16c3ed353931c8fdf8836',
    'Snapshot of portable tables, asset encoding, scoped settings, guest/account download and markers',
    'Fixed guest settings in account downloads and stale account exports',
  ],
  [
    'DuoYu-Extensions/src/features/sync/JsonImportDialog.vue',
    '1a0afe649765c350a788580218a362652746ca0c42719b75211d73e18b8e3ec3',
    'File selection/preview, async request invalidation, account capture before file read, submit and error feedback',
    'Real browser rejected stale plans, rolled back injected abort and retried; keyboard flow passed',
  ],
  [
    'DuoYu-Extensions/src/features/sync/assets.ts',
    'e2e39e0b076272399ea71339f27e8ae55db28ca94b1d46f62487014710712352',
    'Blob validation, digest, cache writes, SHA integrity, transport, reference collection and cleanup',
    'Portable import prepares hashes before transaction and stores prepared images with rows/outbox/receipt',
  ],
  [
    'DuoYu-Extensions/src/features/sync/model.ts',
    '8f87e04338e1c12e37ad3fc0a98b762fb1020742406a5e06de32830cb99965d9',
    'Entity normalization, conflict overlays, collection projection and rowChanges quota accounting',
    'Existing server integration preserved offline retries and duplicate import rejection; imported folder/page graph verified',
  ],
  [
    'DuoYu-Extensions/src/features/sync/response.ts',
    '253a4982fac0895f54d852591348d5c5b43daf41b985948a6519dc0d47c999d6',
    'Transport response errors, incomplete payload and legacy worker detection',
    'Cloud integration exercised offline/recovery and legacy worker behavior',
  ],
  [
    'DuoYu-Extensions/src/shared/response-body.ts',
    '9dbe1110549b597d068a2700963e940d9b0ecb809c8b018d3d518e803eb38c81',
    'Bounded streaming, prefix reads, cancellation/release and metadata text cap',
    'Existing website-icon regression covers overflow, prefix, empty stream and read failure',
  ],
  [
    'DuoYu-Extensions/src/shared/components/base/BaseDialog.vue',
    'd080a381f2b7cbd0bac1045bf9197845604f6ce3dbb132bea74ea7a53633a5ae',
    'Dialog roles, focus trap and restoration, Escape/stack handling and layout',
    'Real nested settings/import dialogs tested with keyboard in Edge and Chrome at 1440 and 390',
  ],
  [
    'DuoYu-Extensions/src/shared/components/base/DialogLayout.vue',
    '563ab53ddcf3a7df307a5f69915739a9dfea89d7026f56664e5ee949374bf409',
    'Navigation labels, pressed state, content slots, overflow and mobile width',
    'Keyboard navigation in real settings/import dialog and narrow viewport checks passed',
  ],
  [
    'DuoYu-Extensions/src/shared/components/base/BaseSelect.vue',
    '3afa954591ec52ac86d4e50cb5423c60c8fe72fcdff7ba1031f0b214f0626592',
    'Combobox/listbox semantics, option choice, keyboard handling and outside-listener cleanup',
    'Actual general settings selection exported the account glass preference',
  ],
  [
    'DuoYu-Extensions/src/shared/collection-colors.ts',
    'c04e00fe8731142128f1aef8d40d243db9e5f07db770db5849d9eca282f3c954',
    'Collection color normalization and fallback for unknown input',
    'Existing import and workspace behavior preserved',
  ],
  [
    'DuoYu-Extensions/src/features/library/grid-config.ts',
    '07d2e626a25f0ab78f070c3708e25f10ce46e2f3d5516d187d713c9c766d5b68',
    'Grid dimensions and size bounds shared by library and portable import',
    'Import packing uses existing 16-column/8-row dimensions',
  ],
  [
    'DuoYu-Extensions/scripts/fixtures/import-boundaries.mjs',
    '86469e57d1683659621cdb025766a7891e3ecac547e0a05d7d30751f2bbecff4',
    'Account marker switch before/during write, real aborted IDB transaction, retry and PG verification',
    'Three fault cases passed with no leftover items, receipts, assets or outbox entries',
  ],
  [
    'DuoYu-Extensions/scripts/fixtures/export-boundaries.mjs',
    '1c43cab688b7eeb1310ee87a59fa23095e64931b553028e79b93a35d309b23e9',
    'Guest and account export, preference scope, pre-export and mid-read switches',
    'Real downloads and denied stale exports verified',
  ],
  [
    'DuoYu-Extensions/scripts/fixtures/import-layout.mjs',
    '0b41fcaeab081372e1b473fdc27e8e9e24485419bb490acf1982de6d5a33dd67',
    'Real file picker, capacity and metadata, 1202 synced items, occupancy and parent relationships',
    'Before: valid import rejected; after: 11 pages and >2000-change boundary preserved',
  ],
  [
    'DuoYu-Extensions/scripts/fixtures/sustained-sync.mjs',
    '1c3581042ae965060d4e5f007c1458cab3ebd5ab5dc7553e52d4c48dbfd3b277',
    'Timed large-account read scenario, content assertions, latency, CDP and pool sampling',
    'Ten-minute pre-layout-change read workload completed; reported measurements apply to the local fixture',
  ],
]) {
  reviewed.set(file, {
    reviewedSha256,
    scope,
    finding,
    evidence: [
      'PORTABLE-DELIVERY.md',
      '../auth-isolated-zhLJIl/results.json',
      '../review-regression-1793856531327/results.json',
      '../browser-compatibility-3xwBtw/results.json',
    ],
  });
}
for (const [file, reviewedSha256, scope, finding] of [
  [
    'DuoYu-Extensions/src/features/sync/capture.ts',
    '88f042fe9bd3e6893fcd6c8ea459f7b8025dbf17a6156fea3f0bab2a67831457',
    'Primary-key capture, bounded range deletes, partial failures, transaction failure and completion events',
    'Observed real IndexedDB rows and verified atomic abort and retry',
  ],
  [
    'DuoYu-Extensions/scripts/capture-io.mjs',
    'faf4fec813a0ba4095cd7ab1fbfe528f95c6e188404bdf67c3065ab16f7c7a45',
    'Native IndexedDB read counters and actual Dexie mutation and rollback assertions',
    'Measured original and fixed implementations on the same synthetic dataset',
  ],
  [
    'DuoYu-Extensions/scripts/fixtures/device-write-load.mjs',
    'f1b5a46ff226dd96d191951c84c831cc1f21c63965a3073b67aae2197dcf4069',
    'Two authenticated profiles, overlapping writes, offline editing and database/UI reconciliation',
    '20 rounds, 40 edits and one disconnected peer',
  ],
  [
    'DuoYu-Extensions/scripts/module-inventory.mjs',
    '29749584932773da7e184bbd87319c622d7c1a1a26ae9d3647819b062c1e5500',
    'Static import, resolved assets, registered template candidates, dynamic edges and Go package listing',
    'Reproduced one missing asset in a live Vue component build',
  ],
  [
    'DuoYu-ID/admin/src/components/core/banners/art-card-banner/index.vue',
    'c99a25dcaac5f455f6201dfdc5809fbb62ce3df4bc201b4fff6e241854bd8e78',
    'All template, props, events and default asset',
    'Confirmed build failed on missing image; tested actual component in Edge after fix',
  ],
  [
    'DuoYu-ID/admin/tests/card-banner.mjs',
    'fdcfa351218203b118f0c3baacb49842ff091d3f25399adbd2717319a013d81e',
    'Standalone component production build, keyboard actions, image decoding, temporary directory cleanup',
    'Real default/custom images, two events and no form submission',
  ],
]) {
  reviewed.set(file, {
    reviewedSha256,
    scope,
    finding,
    evidence: ['OUTBOX-DELIVERY.md'],
  });
}
for (const [file, reviewedSha256, scope, finding] of [
  [
    'DuoYu-ID/server/admin.go',
    'a08fd149c7b90efb030e32ab32f1c9cb69585a2cc304f1b3d06b63bb5a5a7355',
    'saveApp decoding, validation, create and update; management precondition and missing policy field',
    'Legacy PUT clearing policy reproduced with real UI and database; now preserves it within the same UPDATE',
  ],
  [
    'DuoYu-ID/server/migrations/023_persistent_login.sql',
    'a0d3c69982cd7e6b85d441c9b48304949c7679bad4c09816c86eb62e447fccab',
    'Complete migration; defaults, eligible platform/refresh flags, transaction rollback',
    'SQL executed on 9 isolated PostgreSQL cases; exact production counts queried read-only',
  ],
  [
    'DuoYu-ID/server/migrations.go',
    'a45213cc57cc64aaab02cbc46a9444ab01c345679ba3e91fd2a007d530863bb9',
    'Migration ordering, checksum, advisory lock, rollback/commit path',
    'Fresh isolated schema migrations and read-only production migration-version check',
  ],
  [
    'DuoYu-ID/server/refresh.go',
    'ebc636711a0bd48cef1803198a596ca8deb4640b44acfae007042ee818ae043a',
    'New family deadline, existing family rotation, revoke-on-replay and transaction',
    'Linux grant matrix binds new grants to policy, rotates and rejects after logout',
  ],
  [
    'DuoYu-ID/server/client_matrix_test.go',
    '34dad7f90e0317da1d9b5df974953c492847c67873742106e7da9f9043c1f154',
    'Refresh rotation/replay/scope and logout case; finite vs previously issued persistent family',
    'Extended actual HTTP and PostgreSQL integration case; final Linux suite passed',
  ],
  [
    'DuoYu-ID/admin/src/views/duoyu/editor/index.vue',
    '9467501defc044b72a637b6795ff12030abd79aba9390650347694ac204ad039',
    'Project policy initialization, field persistence, legacy request compatibility and keyboard label',
    'Real browser verified reload, legacy update preservation and explicit disable',
  ],
  [
    'DuoYu-Extensions/scripts/fixtures/id-projects.mjs',
    'b11ddb777ddfe6d74542d3bc5db2a30594f27f706648c1ea8ab8b1e207af1904',
    'Real project create, edit, switch, legacy PUT, explicit disable, grants, lists and management navigation',
    'Final combined real-browser suite passed',
  ],
  [
    'DuoYu-ID/docs/extension-integration.md',
    '1cf3d136d92482b8bc43e2ea01dbe442e439f80caba1a18fff6c06cd46d5007e',
    'Persistent login section checked against schema, project options and refresh-family issuance',
    'Updated migration/defaults, expiry boundaries and revocation behavior',
  ],
]) {
  reviewed.set(file, {
    reviewedSha256,
    scope,
    finding,
    evidence: ['PERSISTENCE-DELIVERY.md'],
  });
}
for (const [file, reviewedSha256, scope, finding] of [
  [
    'DuoYu-Backend/server/backend/website_icon.go',
    '3ad63bbc6534d1ebd315bccb8c139b76848d1af7f7de67715025fb11f937611f',
    'Full static SVG subset, byte limits, raster signature and ICO compatibility',
    'Approved static shapes accepted; active, malformed and oversized SVG rejected',
  ],
  [
    'DuoYu-Backend/server/backend/website_metadata.go',
    '38842a40ae81038bb8cfcb87656ba7abf0c9787907e7c94613c2fbed1db0f171',
    'Real fetch limits, SSRF checks and rebinding protection, icon discovery, MIME detection, caching/fallback',
    'Live public regression fixed for SVG-only favicon; production source availability separately measured',
  ],
  [
    'DuoYu-Backend/server/backend/website_metadata_test.go',
    'ed30557ae3c4da52e15521edd399d8fde6e01c34156be5e78703f968d0793f38',
    'Validation, fallback, credentials, static SVG, malformed data and actual media type',
    'Focused Go and Linux suite passed',
  ],
  [
    'DuoYu-Backend/server/backend/website_metadata_live_test.go',
    '7f86b2bcf50df72dafc370d6c622f73d95f9cb943bcdbb329a707bc8c5330369',
    'Explicit network probe reaches three real remote domains using the Go resolver',
    'Three-domain before/after run in Linux with public CA; three final decoded icons via packaged extension',
  ],
  [
    'DuoYu-Extensions/src/features/library/remote-metadata.ts',
    'e118affcc3f30dfea01bc393758f90b8abce3d4fc1cd72d8e12669a16d776cd7',
    'HTTPS endpoint, response fields and limits, pending request sharing and cleanup',
    'Production endpoint behavior compared with actual extension worker fallback',
  ],
  [
    'DuoYu-Extensions/src/features/library/auto-icon.ts',
    'ea4f71f186f49bb2068f6e6934d1bb4b19aecb76969152e575bbd8ee8abba9cc',
    'Message lookup, bounded cache, lazy retry and invalid response fallback',
    'Packaged newtab to worker to decoded image checked for three target sites',
  ],
]) {
  reviewed.set(file, {
    reviewedSha256,
    scope,
    finding,
    evidence: ['METADATA-DELIVERY.md'],
  });
}
for (const [file, reviewedSha256, scope, finding] of [
  [
    'DuoYu-Extensions/src/shared/storage/account.ts',
    'd93865093eb1dab859ea6d3aeab6fc260d32a768beed352cc5c73b4b55f1c4e4',
    'Full localStorage namespace binding, stale reads/writes/remove and event dispatch',
    'Stale settings rejected for three transitions; live guest/account formats and values verified',
  ],
  [
    'DuoYu-Extensions/src/shared/storage/database.ts',
    '0e5054789ad233cec0f490adc97124e5432090bc085a68917f3650ed02d47a61',
    'Per-page Dexie name, capture binding, version declarations and export/import account checks',
    'Database and preferences now capture the same immutable owner; actual IDB value checked',
  ],
  [
    'DuoYu-Extensions/src/features/sync/client.ts',
    'bd93d30180d9c94a7c37a471c221e1612fb6aa843bf492f0872c597094573e9b',
    'Account choice and startup sequencing; storage/status events, RPC account checks, preferences read/write and projection',
    'Two stale authentication completions and three wrong-owner settings races reproduced and fixed',
  ],
  [
    'DuoYu-Extensions/src/features/desktop/SettingsDialog.vue',
    'a10fa014e8b7bfcb8131b9104af8067fc191182120690218ce4e67c3ed28cf3d',
    'Layout and glass handlers, persistence, failure feedback, named settings/import flow',
    'Tested real menu choices, explicit stale-account error and normal settings persistence',
  ],
  [
    'DuoYu-Extensions/src/features/wallpaper/wallpaper-preview.ts',
    '072e1a21e7f626b6e6eba32effa347255e9fd388b4d9a1319d19bc6567bef4f1',
    'Preview caching, scoped reads/updates, canvas limits and quota cleanup',
    'Shared scoped storage now blocks stale writers; thumbnail materials covered by existing wallpaper suite',
  ],
  [
    'DuoYu-Extensions/src/entrypoints/background.ts',
    'f3db90e64e642750aea501f396ce8178e7129342a30e29c64d307f02dbc369c5',
    'Worker sender check, authentication queue, checkpoint rotation, issuer/subject checks and allowed sync paths',
    'Edge/Chrome popup messages ignored and guest sync 401; authenticated fixture scopes and logout checked',
  ],
  [
    'DuoYu-Extensions/scripts/preference-account-ui.mjs',
    '381dd9ff4160277108eadd65135f70f4f51df0fd35be7172ce0e90694cb7f624',
    'Real MV3 UI and IndexedDB for stale owner/guest settings and normal operation',
    'Five cases passed in final unpacked archive',
  ],
  [
    'DuoYu-Extensions/scripts/startup-account-isolation-ui.mjs',
    'd481b9601cea5b91c9290676fc499e30323490a17bb253cba4d7ef4891ab81a1',
    'Startup stall, real session events and controlled native digest/status completion order',
    'Original release failed both supersession cases; final passed both, startup logout and cross-tab reload',
  ],
  [
    'DuoYu-Extensions/scripts/browser-compatibility-ui.mjs',
    '701e8d36c03b3c0797c8c3ddeff4ad1ef5f119e606d85bb93b3d7522dad7a370',
    'Chrome and Edge install, keyboard modal flows, mobile viewport and privileged message dispatch',
    'Real popup denied privileged messages, guest newtab status/sync behaved as expected',
  ],
  [
    'DuoYu-Extensions/scripts/fixtures/id-admin-boundaries.mjs',
    '8efa41609ca991c8b47eae5c05962faa89c4ddc27974c62e408c4a3e8e7266ff',
    'Literal admin-route discovery across registration files, actual HTTP role and origin checks; loopback-only fixture',
    '46 method/path entries, 115 denied requests including all 23 foreign-origin writes',
  ],
  [
    'DuoYu-Extensions/scripts/fixtures/id-pages.mjs',
    '0180a1d72b32b3ce7797a843f361aa781dd2d4df68f6be6eadefdd753d0a6027',
    'Anonymous/ordinary role checks before fixture promotion, 20-page two-viewport checks and representative writes',
    'Auth matrix and ID page/CRUD tests completed with schema cleanup',
  ],
  [
    'DuoYu-ID/server/management_access.go',
    'f7ca402e7f02a01fab0a848f06f352d6232e4d7cb08f39aa9d70c59703dd45dd',
    'Complete legacy management role fallback and read/update methods',
    'Normal role denied and anonymous unauthorized on the two registered access routes',
  ],
  [
    'DuoYu-ID/server/main.go',
    '332c01aa4a671d696ab33e18c84ae5a1a48bee01db8a901b8cfc3ac909bbfcec',
    'Admin route registration, origin and request-header middleware, role checks and API-only server startup',
    'Real 46-route permissions matrix and old/new binary isolated migration/rollback',
  ],
]) {
  reviewed.set(file, {
    reviewedSha256,
    scope,
    finding,
    evidence: ['SESSION-DELIVERY.md'],
  });
}
// Frozen file hashes for the identity credential and migration review.
for (const [file, reviewedSha256] of [
  ['server/schema.sql', 'fa960f78867e6c583a19639652beeabb127a41e33a40512a7b58cf6e04dc8ee7'],
  ['server/migrations.go', 'a45213cc57cc64aaab02cbc46a9444ab01c345679ba3e91fd2a007d530863bb9'],
  ['server/admin.go', 'f5b0b5c5a0624d65c42ab6a5dcd7ae5aeaddce7461256d0078209ffbc3f6f604'],
  ['server/developer_keys.go', '98b0eae2d4ecf69f5ee1a1fdeb2f17fcec2a86010295b7ac0bc37dd18bd904aa'],
  ['server/management_access.go', 'f7ca402e7f02a01fab0a848f06f352d6232e4d7cb08f39aa9d70c59703dd45dd'],
  ['server/management_api.go', '43f344926ba53abf75e3c4bf6d72b971144ef56509831cfb193ca4f244b67bff'],
  ['server/management_keys.go', '332b7ab4c60a43a9c00127fd481375236bc884f6bc32b39b327fde1df9b6a984'],
  ['server/management_api_test.go', '0cdad16a0f86f38520d8f7d185c9d49c18e94648d1668f80f5535c43d15a24ec'],
  ['server/legal_label_test.go', '776320c687486cd80de7db12e053370b149ee54672299fba5bf5e4d3cf3bcbfb'],
  ['server/templates/login.html', '0a130214dcae6e6af9bee4be67b3933656dc2f987d1393b49af4b34328ffda5b'],
  ['server/templates/scan.html', '20fd4c355ea605224734e687a7391f1baf22f273eac38454a2743569914ebc93'],
  ['server/migrations/002_mail_queue.sql', '19ba7abc26bc90ae7a2e91d55286b0ed38a6059179e135c0450474b33ea6b8cc'],
  ['server/migrations/003_session_binding.sql', 'e99bb92fb0372958115f430b4cacc8f74a13b49c8c681f0c9261fdf6b3428303'],
  ['server/migrations/004_refresh_tokens.sql', '8b749fca5d146a114e6fa020142cf5704c1495fa4fc25365d7b0245e4619fe12'],
  ['server/migrations/005_logout_events.sql', '4034b0cd58aea8cbff95757678f5837e85f4e63a9864153ec1540fcb401ccaab'],
  ['server/migrations/006_policy_revocation.sql', 'a5f4b092ea54b131480cb9402565851d6d4f8a83e97af08a721ebc91339fe6fa'],
  ['server/migrations/007_operations.sql', '5453d68694f41af78b0d0a0469ca482d36c0a6fbfb7d1470b71eaba7215f74a6'],
  ['server/migrations/008_monitoring.sql', '4c7fdef42e9672cf9dee5625970f8ff00b3f99c7b2d7b67f44d62eacf03a2f9c'],
  ['server/migrations/009_account_policy.sql', '0ffa03922a64b73ab6a57da17231dca0dce382f618fbddcaafa9a5f735c99817'],
  ['server/migrations/010_passkey_device.sql', 'ed6535199e8278028937b6fcf0e971571fe57bc4eea025eb751e4d4fe73c92fd'],
  ['server/migrations/011_qr_enrollment.sql', '73561b401e06e7f0ed85a3b8ad5ca5ec0a05c840e6ffa6121f96e841d2aa6b89'],
  ['server/migrations/012_single_super_admin.sql', '81b8878af0b1e32bb93381fbe3e43a6edee0d0c89aac9e4ebf6813db88519c94'],
  ['server/migrations/013_project_logo.sql', 'a9348628751e72ebd94bbcda288ac52cb1cbb6beb40393991c2f87b00e0d33b9'],
  ['server/migrations/014_project_blacklist.sql', '066950bc8af7f9b6be2217f228b0ef9ac45c4956fc2c4b167cc8a5c509fd29ac'],
  ['server/migrations/015_extension_origins.sql', 'db8ac3c69183d3abd946f46a05c4e0cd6270a8ed26f2ca3cea8a6d6cd115ab93'],
  ['server/migrations/016_login_methods.sql', 'a172354ebd13923daca98c8bb5a86986bd2eb93da612de9ebbeb4760cd3f7733'],
  ['server/migrations/017_totp.sql', '1a07fe343f49913ace3330b58e4723072e41e5f76b522c1c74a007ca873e7a0d'],
  ['server/migrations/018_project_roles.sql', '17646de372fac599f84bbcc99a081542209c7576aafdc486764ba136367c61df'],
  ['server/migrations/019_avatar_paths.sql', '55ac309f31d1fe39ef1a5b8a3e9dd87c33e7b77537aa13f6c6d6f1d7d6c9f186'],
  ['server/migrations/020_management_api.sql', 'a3d541bf3cb3e43e51c238baf7d65264b732f98d9dc0a6d7699e3f189f0411be'],
  ['server/migrations/021_developer_keys.sql', '909464e0984f7e634f971311af8ee6c5c22f43cdbba85d1f01d5800402fd5b93'],
  ['server/migrations/022_legal_acceptance.sql', 'dc1f15e41ad1aa9ae04b650d511ce035d7a81e3e2340c7684c6c13e6bf64539d'],
  ['server/migrations/023_persistent_login.sql', 'a0d3c69982cd7e6b85d441c9b48304949c7679bad4c09816c86eb62e447fccab'],
]) {
  const migration = file.endsWith('.sql');
  reviewed.set('DuoYu-ID/' + file, {
    reviewedSha256,
    scope: migration
      ? 'Historical SQL: schema, constraints, backfills and triggers; clean PostgreSQL migration and existing 020 to 021 credential fixtures'
      : 'Focused identity review: credential access, migration execution or consent-label path; see per-group evidence in IDENTITY-ACCESS.md',
    finding: migration
      ? 'Kept released SQL immutable. Existing-data coverage is scoped to the scenarios cited, not every historical combination.'
      : 'See the credential compatibility, revocation and label findings in IDENTITY-ACCESS.md',
    evidence: ['IDENTITY-ACCESS.md', '../identity-access-122671b634/after.log'],
  });
}
for (const [file, reviewedSha256, scope] of [
  ["admin.go", "d48862bd94ddb684be7d6bd994905eaa0c4f28efc99326f031d88a3df0657d9f", "Full-list grant replacement, validation, normalized duplicates, batch lookup and atomic per-project serialization"],
  ["blacklist.go", "91ddfb0c2ffbbcd249e7e07ac7a2c46efb091a1b083660014d20742f63cf8183", "Email or account-number blocked membership, enrollment identity binding, explicit list replacement, missing project and database failures"],
  ["project_roles.go", "9a846a1dad03ff56b076ff4bcb2c4997a99ce1a29c135371d57cfe270dd623ce", "Role definitions, default transfer, removal and member assignment, online scoped claims versus central authority"],
  ["login_methods.go", "af0421731679bc789441d318cda236963b07d6f905999cb41dba5e9c741a8341", "Map AMR to allowed methods; legacy credentials and project flow ownership checks"],
  ["oidc.go", "e3302954c6ee2843e90f1f40547f446349cba6d8f1eec0a0859a141bf4503927", "Project access predicate, transaction-locked token issuance, online role claims and UserInfo"],
  ["refresh.go", "af4c7ec3db666631402dcfcee451099e413fa654e1283c6284b2d59bae3c0e29", "Refresh request lookup, live issuance policy, family locking, rotation, reuse and session binding"],
  ["management_spec.go", "b6d53e80385b5f3ae3059a493d6bf9dba0320b5cfc6f7702381d6c5b0e361da5", "Required list fields in HTTP contract and current unified developer credential description"],
  ["blacklist_test.go", "be3255533688bfce5e307f7800dc78f930024ddef4cd1b51a331e3ccdc847ed3", "Real HTTP blacklist, account binding, registration, removal, invalid edit and cross-project coverage"],
  ["project_roles_test.go", "e08f0f8f379c385002e62fb13b94a30521e8135ac38fb7897fac2dd19b81d3db", "Project role CRUD, current claims, default replacement and center-admin denial assertions"],
  ["project_policy_test.go", "d6816a365efee82309c84997aacc86f386924f50860390999e9f4b2631d29599", "Actual list-replacement and token issuance races synchronized using PostgreSQL lock dependencies"],
  ["client_matrix_test.go", "c7289706d631052622ec41575b576c6247963cf2b1a8ec818b5b1ef4c99f8dbb", "Role update on the same access token, restricted grants and blacklist token revocation cases"],
  ["server_test.go", "1e03c94206fb6423dea6dfd12c5ff1738b8dea9a74392e356a58dcc37bf33589", "Disposable database schema, registration of the policy regression suite and integration boundaries"],
]) {
  const key = 'DuoYu-ID/server/' + file;
  reviewed.set(key, {
    reviewedSha256,
    scope,
    finding: 'See PROJECT-POLICY.md for verified defects, fixes, and remaining scope.',
    evidence: [...new Set([...(reviewed.get(key)?.evidence || []), 'PROJECT-POLICY.md'])],
  });
}
reviewed.set('DuoYu-Extensions/scripts/fixtures/linux-process-smoke.mjs', {
  reviewedSha256: 'f86ee2cb2e242e5d99b2f4801f9b5a282936d644d34d34b308be5bd75f3f257d',
  scope: 'Process startup, readiness deadline, isolated HTTPS discovery, health load and shutdown evidence',
  finding: 'Preserve the last connection error or HTTP status and process output when readiness times out',
  evidence: ['PROJECT-POLICY.md'],
});
for (const [file, reviewedSha256, scope] of [
  ["server/oidc.go", "df382f03df8ff6c2821c688bacb029d282340064917c461b61d1bed3194a3c34", "Authorization request registration, completion, code consumption, in-transaction validation of project and pending authorization"],
  ["server/login_methods.go", "7a04c01d7991d1852fbe5946a0d9ce2391be2e002122df892f46dc199485701b", "AMR normalization shared by online checks and newly recorded authorization metadata"],
  ["server/refresh.go", "46dc91245861f7411f4c151daf34e84a4992c8ffcaeaa9e85a20a4a927cf78da", "Check consumed authorization for first issue; subsequent refresh rotation uses its existing family"],
  ["server/logout_events.go", "1fe6f48a07c8a3cd2cb036940285ec3bc923e75a37516d41eab1e53eab92eb1d", "Full callback transport, stable signed event identity, claim lease, fenced failure updates, terminal success and manual retry"],
  ["server/client_matrix_test.go", "87ccdb438a3baf5f74dcf27c9fee3c1032332b7e2e381f88c6089fc79e518898", "HTTP code exchange after policy transitions, native dynamic callback compatibility, all retry delays, overlapping responses and admin recovery"],
  ["server/project_policy_test.go", "8b25ea353666353aa057abda59b05239c2dde8eac851392668a47f3d1257c0a1", "Updated concurrency fixture includes a persisted authorization record before racing token issuance against blocking"],
  ["server/mail_queue_test.go", "caf9f9bb2f21c7747bd044eb2e7a0300d5858749bb2ea2917a4d4d89b0599727", "Real migration count, repeat/mismatch tests scoped to 024 upgrade"],
  ["server/migrations.go", "4e8d327eaf31939909bea452970e0d2017ec57c59328cb5dcce3a36a41d158ee", "Embedded immutable migration registration through version 024"],
  ["server/migrations/024_authorization_policy.sql", "c4ffba394451a85b67c7c5688eaca9dccf791d8afec728180941f3399086f26b", "Future project tightening cancels affected authorization rows; upgrade creates function and trigger without a historical backfill"],
  ["server/maintenance.go", "542174d06b76f69a4ced6a11c93588c7ad9239808e23d010478b66075798da75", "Cleanup of expired pending authorizations and retention of queued/failed versus delivered logout jobs"],
  ["examples/client/main.go", "a79644ddf69eb1b3080b2d21c440cdbfd62c3b083f4110d602b3db2f4b6fd8fe", "Backchannel receiver verifies signature, audience and event fields, deduplicates retry JTI and removes matching local sessions"],
]) {
  const key = 'DuoYu-ID/' + file;
  reviewed.set(key, {
    reviewedSha256, scope,
    finding: 'See CODE-LOGOUT.md for the verified defects, regression coverage and production boundary.',
    evidence: [...new Set([...(reviewed.get(key)?.evidence || []), 'CODE-LOGOUT.md'])],
  });
}
for (const [file, reviewedSha256, scope] of [
  ["src/entrypoints/newtab/App.vue", "01bd79efcab11fd807e6121645b272890391effefb1d43b34484bed655911edc", "Home, library and workspace transitions, shared cyclic page order, keyboard versus Dock entry and hints"],
  ["src/features/desktop/useDesktopPages.ts", "6c33109586cdd3026139cb94c0166658bcf9e9921f3bece1be44bb3ae9c57a41", "Wheel arbitration and navigation keys, repeat, composition, modifiers, editable targets, menus, drag guards and lifecycle"],
  ["src/features/desktop/HomeNavigationHint.vue", "4b615057cbf8f58dad84c7e9e1ec30ca4bd7218f1f61c70ab2fb4306c60de9f5", "Two original vector illustrations, responsive positioning, contrast and ResizeObserver cleanup"],
  ["src/features/workspace/WorkspaceOverlay.vue", "2ca5850f4a8ee7f7ba353d27502d89f3ec1666d745ecba6ba5018dc221a68b04", "Keyboard entry focus, workspace return, modal focus loop and input priority"],
  ["src/shared/components/composite/RadialWheel.vue", "ca241913a53722f1c572c8c29ca54468b4b04f641cdef8ecdd59bdd146acca7b", "Focused menu choice Escape consumption and arrow navigation"],
  ["src/features/shortcuts/WallpaperWheel.vue", "9cf36654dc50c81874899ca0d299d082eb76ace44750cf0853ab575ee71d4a99", "Wallpaper wheel Escape, nested dialog and gesture cancellation versus page navigation"],
  ["src/features/library/page-drag.ts", "bcb838463ade719e6f38ee985e30e4bc25eb4a9ee19dd0e7922c683b8a2129ff", "Keyboard cancellation and connection/disposal of page drag handlers"],
  ["src/shared/useGridSelection.ts", "50cd38ae6d391fda165c8d9bbaae3712b19c5533be6c36537fcbd1a908a360f0", "Escape while a marquee or selection is active, capture ordering and clearing"],
  ["src/shared/useWidgetGrid.ts", "61baa4ccff2e646c28958d2db37e6b3248e90d9644c6754c3121776dffc1afc9", "Active drag/resize cancellation versus idle global Escape and grid teardown"],
  ["src/features/search/SearchBox.vue", "4424dc2b7b5dc4f7d345c028c99e90420aab4dc2d1f41a669df40f12787c53f5", "Search-form focus, input composition, suggestion keys and conflict with page shortcuts"],
  ["src/features/search/EngineSelector.vue", "21112c461f3e50393b0ec181b31ac05935a6c2309cc6a2797b5a8695a808a028", "Focus ownership, wheel open/close and keyboard routing at the search field"],
  ["src/features/shortcuts/actions.ts", "3f3b85482451f799bf9f3a06d14305aa4a00ed243ad94c72fe6dafcb9edda957", "Built-in shortcut IDs, reserved entries, translate destination and workspace route"],
  ["scripts/home-navigation-ui.mjs", "21ebf340cabf102ddebef2f56e448171b1e38ad5dae7b80e6bc44bf2104e1e64", "Real focused input, wheel and key navigation, menu Escape, compact layout and exact ZIP checks"],
  ["scripts/desktop-boundaries.mjs", "b3e305292db482da13e78144f39aeab5dc294db76ea1256d957b359a3c7cac7a", "Grid/wallpaper menus and long-press handling after workspace Escape now returns home"],
  ["scripts/wallpaper-cache.mjs", "99f569f24ffdd91f0859d4a108ee21a528e1ebcff8339bace2a87b203c57b17f", "Offline fallback, theme boundaries, paused local time and cold-start cache"],
  ["public/wallpaper-startup.js", "9280ef3145a8772815dc4f9e6a6de579160ff82b8d8b2a8d6bf37aace28d8664", "Before-paint fallback, system preference versus local 07:00/19:00 transitions"],
  ["scripts/review-regression.mjs", "2d7e58bbd3a64cedb2def67b204c163d3f137b7df1dd6e36f0ee30e1e4821246", "65 registered regression scripts, result capture and bounded subprocess execution"],
]) {
  const key = 'DuoYu-Extensions/' + file;
  reviewed.set(key, {
    reviewedSha256, scope,
    finding: 'See HOME-NAVIGATION.md for keyboard/focus boundaries, visual evidence and test results.',
    evidence: [...new Set([...(reviewed.get(key)?.evidence || []), 'HOME-NAVIGATION.md'])],
  });
}
for (const [file, reviewedSha256, scope] of [
  [
    "DuoYu-ID/server/auth.go",
    "b0b76599e21a2d2c4bf11731a46f6ea42d24a29162510354a15bd1e364a0e67e",
    "验证码生成、注册、登录、改密、换邮箱与会话撤销。复现并修复数据库失败耗尽有效证明与陈旧归属签发会话。"
  ],
  [
    "DuoYu-ID/server/main.go",
    "ff2ee91afdc2f2472c2f16abac9a41a06fb13f33a6bb006464b98c4240abb5d3",
    "会话签发事务。账号状态、邮箱归属和密码版本与写入会话串行。"
  ],
  [
    "DuoYu-ID/server/security.go",
    "c4617e536c701d6815018e0bec995364b452e42e23610b5527f867d98c2568cc",
    "密码生成、哈希编码与比较，随机值和邮件规范化。"
  ],
  [
    "DuoYu-ID/server/password_policy.go",
    "e982c9ab2f257e65c99eba41fa23a5d5d50d79f85e5f846949b1b8da08d4a5eb",
    "密码校验、锁定窗口与账户锁，结合账号签发归属回归。"
  ],
  [
    "DuoYu-ID/server/network.go",
    "5a1210fb20a0cbbe1760d892f7499801b64f4cc9f08a5088f9ecaaf381074239",
    "本机地址枚举与启动信息。"
  ],
  [
    "DuoYu-ID/server/proxy.go",
    "5ee2b4541a0cc937d0fa3ec2018106161c2ad90f2cb32b0061611c5068bac63b",
    "代理 CIDR、转发客户端 IP 信任边界与请求上下文。"
  ],
  [
    "DuoYu-ID/server/passkey_details.go",
    "5cc67dcac4c89a17fe74d00152409a0fdb36277849abae0113182f11af864279",
    "注册浏览器环境、验证器类别和传输方式的呈现。实体设备未验收。"
  ],
  [
    "DuoYu-ID/server/auth_assets.go",
    "6013e66b05ef6ae2f391aa86d8f12d97fa1eb16a7e01d6caaffe45c6df7ea4a3",
    "登录静态资源文件版本及读取失败时的回退。"
  ],
  [
    "DuoYu-ID/server/account_change_test.go",
    "07b9f7331aaf37389da4d6d9a8450a704336de2bb7cb3abf9e6bffb93e75f4c4",
    "故障注入、验证码单次使用与归属变化并发测试。"
  ],
  [
    "DuoYu-ID/server/project_policy_test.go",
    "3e5e3c640ff67df8d687a2d530183241a8849c8dc620f6418b9cee3ef7529550",
    "数据库锁等待辅助与授权策略并发回归。"
  ],
  [
    "DuoYu-ID/server/server_test.go",
    "7421c37b79bce269531da624764b6f68fcf16f83942e23e9b76688886ff95dc9",
    "集成测试新子场景的接入及现有用例回归。"
  ],
  [
    "DuoYu-ID/cmd/rotate-key/main.go",
    "b931bf2e47c7d5d5675c3d52a06e5c4622286e2902ef2ede0a1ffc7fb777f62e",
    "轮换前独占占位、旧公钥归档、异常清理与替换。"
  ],
  [
    "DuoYu-ID/cmd/rotate-key/main_test.go",
    "c9b5cbd49b63a797c7efe9cb5bf86f07b3c277da16889f9f9ce22d936918122f",
    "保留旧验签公钥、占位碰撞及失败释放。"
  ],
  [
    "DuoYu-ID/scripts/backup-scheduled.ps1",
    "e9f9b28a2645e4d154023e0acf9d995c16b35d88f6a06027438da825f54a275c",
    "计划任务的路径与恢复点命名。"
  ],
  [
    "DuoYu-ID/scripts/install-backup-task.ps1",
    "9041f362a02df5d28dd901b8664c5f2a63b21bdc8a02c58bb9d232597404c5b5",
    "维护任务执行身份、参数及已有任务保护，仅静态核对。"
  ],
  [
    "DuoYu-ID/scripts/restore-manifest-test.ps1",
    "58a02db100fbf5ef306bf5ff12ac21b9f228af688221c389f61bef97c63c725d",
    "清单遗漏、重复、路径别名、哈希和目录链接的负例。"
  ],
  [
    "DuoYu-ID/server/mail.go",
    "0c04e51864b00a952cbb5aebff0a4451d120a2c7ba71ef1b6ee2f17ff6eb2db1",
    "邮件组装、传输超时、TLS、DATA 与 QUIT 结果边界。"
  ],
  [
    "DuoYu-ID/server/mail_queue.go",
    "93246a4dc372c6193ec0f47f92c65f3eaade40d864b85af1f05a03a60661b4b9",
    "队列加密、权限重查、并发领取和中断／重试状态。"
  ],
  [
    "DuoYu-ID/server/templates/email.html",
    "6cc7324a370d69128f95ea87cb66c930454d1d4219100f256ca41a1d35457cac",
    "验证码邮件模板、期限、转义路径；真实收件箱单列。"
  ],
  [
    "DuoYu-Extensions/src/entrypoints/newtab/App.vue",
    "2ca00d9ce9c92e6036518d1cb74c7cc410634c99cc5441077e29bf1e88a40c0f",
    "首页与工作区切换、键盘和 Dock 入口。"
  ],
  [
    "DuoYu-Extensions/src/features/desktop/HomeNavigationHint.vue",
    "f6929278e3c96e7058a315b0a364c0a8d2be06340252c56ae4dcb86afd39e63e",
    "两行透明提示、响应式位置、Dock 避让。"
  ],
  [
    "DuoYu-Extensions/src/features/desktop/NavigationKeys.vue",
    "5d0fceec74ba326000200a79bb186278785bb60a967933da7c7ce0f9db861bc0",
    "方向对应的字形亮度，所有键框样式相同。"
  ],
  [
    "DuoYu-Extensions/src/features/workspace/WorkspaceBoard.vue",
    "a67847154ae134ff20ed3b54a0adfa09949c0455d36515f6f8d9dff3b976607f",
    "标记和有序空间循环，编辑、菜单、加载与拖拽边界。"
  ],
  [
    "DuoYu-Extensions/src/features/workspace/WorkspaceOverlay.vue",
    "45d993ed4171c775cef5c2ae91ca1fd88b37550b6baf3de75770f873a5dbe219",
    "键盘焦点、输入法、弹层、搜索和返回首页。"
  ],
  [
    "DuoYu-Extensions/src/features/workspace/useWorkspace.ts",
    "927fdddcab63389d8e2b0d8085a061cfcfe460bcbcff8290dee81d8f0ed4b4f1",
    "默认空间、空值、异步初始选择及删除后的空间回退。"
  ],
  [
    "DuoYu-Extensions/src/features/workspace/spaces.ts",
    "718fcc341e2d9f42472654db8eff4f8eb78602c061d18aea101f8adab9acb03a",
    "实际空间排序、默认空间建立与持久化。"
  ],
  [
    "DuoYu-Extensions/scripts/home-navigation-ui.mjs",
    "e03cf82816fdb64a767f94e253a2b26f75bce9f3413a1c7eef09ba898ec30faf",
    "真实 ZIP 的逐键切换、标记、编辑隔离和截图验收。"
  ],
  [
    "DuoYu-Extensions/scripts/workspace-collections.mjs",
    "792fa57c358a6a20eaad9a9dc6139ec1d61a5f57e1a8665abd4eeee30004e5a9",
    "持久化、跨页更新和重新进入第一个空间的回归。"
  ],
  [
    "DuoYu-Extensions/scripts/workspace-interactions-ui.mjs",
    "483964d65b73969212bd07fa796fdcedb79589b663bb452814726e5976b19eb1",
    "Dock 面板焦点、搜索与快捷键。"
  ],
  [
    "DuoYu-Extensions/scripts/workspace-crud-current.mjs",
    "8e54c8057f0166c2a2e8bfc942b398c6e2e57d8cc1b68d3790cf6c564227d438",
    "活动空间初始化时快速输入，及工作区 CRUD 流程复测。"
  ],
  [
    "DuoYu-Extensions/scripts/ui-helpers.mjs",
    "4c7a5b864fa366bb3d13dd454664c6c6f0e4f3b44501e981cc107b2a7c787ac2",
    "确认实际右键命中空网格，区别布局移动与应用菜单失败。"
  ],
  [
    "DuoYu-Extensions/scripts/cloud-integration.mjs",
    "bb37c1fa5c5591e663de0ac6307a214297649d08244a80b333a8cb268235bf3d",
    "旧账号冲突重试和既有多客户端同步回归。"
  ],
  [
    "DuoYu-Extensions/src/features/sync/conflicts.ts",
    "0ac19ca266070e88067372397dfabf08ad1e3ae38dcb32cf828d25d562951e51",
    "冲突重试绑定账号、等待锁与提交前重查。真实测试库复现及复测。"
  ],
  [
    "DuoYu-Extensions/src/features/sync/pending-wallpaper.ts",
    "d52a972711a302e6dffc146875433c300b45a05f16209431260b92e4548e0948",
    "当前选中图片与未解决冲突合并边界。"
  ],
  [
    "DuoYu-Extensions/README.md",
    "11b55d658252b72d8d433dfa0553e4569063baae9989205fe26e614d53345b4a",
    "工作区默认选择、标记循环和搜索快捷键说明。"
  ],
  [
    "DuoYu-Backend/docs/backup-access-fix-2026-10-30.md",
    "5705530a0689f034eeb0dc7307abc3ae36ef7bdab14f297cf5299d7276064163",
    "历史备份权限修复与当前只读访问边界。"
  ],
  [
    "DuoYu-Backend/docs/backup-management-2026-11-02.md",
    "aad27d1788ea7af3ca6c220bc856346ca1e67088bbcd387e5f952258f0e992ec",
    "增量还原、备份密钥与管理下载流程。"
  ],
  [
    "DuoYu-Backend/docs/user-backup-restore.md",
    "3c76ab0353997187085d47ec2389d10c877b003856f72fa4032f390745de6a96",
    "账号恢复的版本约束及重试协议。"
  ],
  [
    "DuoYu-Backend/server/backend/seed-user-backups.sql",
    "3dd3596ec7c3cfb67068c10ff31db389dcbc067f5d7a30d3af3e883cc0b6f8e7",
    "仅缺失历史快照的既有账号初始化；此轮未运行正式写入。"
  ],
  [
    "DuoYu-Backend/server/backend/backup_management.go",
    "8f83987563efbc53f382fca63d0f7a8a8ce5f2c16c56c000f8496dd8facce83e",
    "备份列举、用户和系统下载、文件树、资源完整性与返回错误。"
  ],
  [
    "DuoYu-Backend/server/backend/user_backups_test.go",
    "1b03dfc100df0972afe330167bb16cde5b674da8ee9505ce9ec0a9bf39d2a044",
    "真实存储损坏、目录链接、下载授权和快照轮换。"
  ],
  [
    "DuoYu-Backend/server/sync/src/file-backup.mjs",
    "fd27347c2453b902c9cc93b6d869b2e38fac355e7075fb32c46540117c212dbb",
    "加密归档、tar 条目及异常清理私有临时目录。"
  ],
  [
    "DuoYu-Backend/server/sync/src/restore.mjs",
    "fcb0fc9405f6b9f2134d99018ddcb7cd7f79328b8869a768a2d46b9a47ed289f",
    "显式确认、验证、维护期间启停与失败释放。"
  ],
  [
    "DuoYu-Backend/server/sync/src/restore-system.mjs",
    "8b7a881548b25cf7682ad6b10558bbdb1a53d72eab55e18a3dacfb521c72c847",
    "快照重建、资产归档、独占文件和失败清理。"
  ],
  [
    "DuoYu-Backend/server/sync/test/restore-cli.test.mjs",
    "7b7accba22f89cee68e9b743b1516f340636db8a0d6638d3dfc858374e51e60e",
    "错误确认参数与嵌套路径拒绝。"
  ],
  [
    "DuoYu-Backend/server/sync/test/file-backup.test.mjs",
    "84f9a61a3816b27a1f0b5cfc85e4052a874ad95fcf07abcde1b3f1edb4370c2f",
    "加密文件往返、并发创建与拒绝硬链接。"
  ]
]) {
  const earlier = reviewed.get(file);
  reviewed.set(file, {reviewedSha256, scope, finding: scope, evidence: [...new Set([...(earlier?.evidence || []), 'SPACE-ACCESS.md'])]});
}
for (const [file, reviewedSha256, scope] of [
  [
    "DuoYu-Backend/server/backend/backups_test.go",
    "2fa930b4de87a70e14832fdc72c29a86079eb7c67c669f9fab8314dad1032a39",
    "旧格式管理员下载的分页、账号权限、符号链接、不可读目录与审计回归。"
  ],
  [
    "DuoYu-Backend/server/sync/test/backup-restore.test.mjs",
    "3a6d9d908e9d0395741a253b0cca38ff91e712a4d87144ce61015175e5dd44ec",
    "真实 PostgreSQL 恢复的账号隔离、修订保护、幂等响应和资产故障回滚。"
  ],
  [
    "DuoYu-Extensions/src/features/auth/AccountButton.vue",
    "72b937455fe0df44f6c112d57313e1abfbe20089a8ec616650f135f5a469b67a",
    "账号入口、头像回退、后台公开会话更新、定时器和监听释放；四服务集成覆盖登录与退出。"
  ],
  [
    "DuoYu-Extensions/scripts/drag-restore.mjs",
    "a04c00f6320deec30a90b5b4ac93b31eb7938b2ddd2216ab660c20f6fa4002d8",
    "拖动后相邻组件位置、落位及刷新后的布局回归。"
  ],
  [
    "DuoYu-ID/docs/deployment.md",
    "205c13a213b57ca31b8d764db215990fa33040468a1f4d61d97ea0d34a66ca56",
    "升级与备份示例改用独占恢复点，验证 dump 可读性与哈希。正式恢复未执行。"
  ],
  [
    "DuoYu-ID/server/admin_pages.go",
    "6edebc89b94f4198f0df13cc51d11cd4dd6a6fcaca41dc123140c3927d17eb34",
    "管理员详情与统计、权限和期限校验、密钥轮换并发保护、项目配置检查。"
  ]
]) {
  reviewed.set(file, {reviewedSha256, scope, finding: scope, evidence: ['SPACE-ACCESS.md']});
}
for (const [file, reviewedSha256, scope] of [
  [
    "DuoYu-ID/server/main.go",
    "3c15ffb40e6cc38aeb5724edbae09a0d59d8c751c3a9c45aaa6815a2e2a3e593",
    "会话提交、同事务替换旧凭证、协议确认和 Cookie 发布顺序。"
  ],
  [
    "DuoYu-ID/server/auth.go",
    "0ad928a8ccc2db6de6992ff247c056c7635c97dbe8364626bf6f0eed25805f86",
    "邮箱证明行锁、提交条件和绑定操作的当前会话／账号复核。"
  ],
  [
    "DuoYu-ID/server/passkeys.go",
    "c0710c397d26af2723d6b20af310ef19e50ca83cb45a8701447f327965c4a78b",
    "注册挑战归属、历史注册兼容、最终数量限制、可发现凭证验证与登录事务。"
  ],
  [
    "DuoYu-ID/server/authenticator.go",
    "03a69ecf31c8cc630c8613d33ef041b2bbd380efd2695f1ede3bc9241467ca31",
    "绑定、激活、失败次数、动态码时间步、恢复码及会话的原子提交。"
  ],
  [
    "DuoYu-ID/server/qr.go",
    "a642f55faeade833d05d93a9eb2a8af11a4275176cc01ffff3f74964ee31d471",
    "二维码所有者、确认、撤销、领取时锁定凭证及数据库故障语义。"
  ],
  [
    "DuoYu-ID/server/templates/login.html",
    "d5b515591da0a4e126f3c2e2c040da63f99c9ab8a661fe654e51e406d6af5f6d",
    "二维码倒计时、轮询重试、取消和终态；沿用原有主动确认界面。"
  ],
  [
    "DuoYu-ID/server/qr_test.go",
    "f15ec95e6e3238956840872161fe8cd58bbf2b304ec9da199c1b4cef5717aa1f",
    "真实数据库错误与并发领取、重试和会话凭证隔离。"
  ],
  [
    "DuoYu-ID/server/authenticator_test.go",
    "9c892e5c5b85948be33dbe9afd5f12a1d1c3e50f812cce85b9851f1c27a46ff3",
    "入库失败不消耗恢复码与解绑双因素错误重试。"
  ],
  [
    "DuoYu-ID/server/passkey_challenge_test.go",
    "cae804ce45aaeb941ecf26e6236331ccc3bc35d927da06467bf7666be9bfdb95",
    "注册开始失败可重试，两个有效会话隔离，挑战一次性与旧版本兼容。"
  ],
  [
    "DuoYu-ID/server/server_test.go",
    "ab86b6644f7dad76653f8f11cc5f3416eea6d7f05a91b78d338b7a1d0397d283",
    "新回归子场景接入与测试会话的生成。"
  ],
  [
    "DuoYu-ID/server/mcp.go",
    "b2363fe0bc38d47af4df9c5112a542d5f82a2356d72d5cd4ba255b3e0c26c404",
    "认证上下文、工具暴露权限、必填字段、路径编码和复用管理与项目服务授权。"
  ],
  [
    "DuoYu-ID/server/protocol.go",
    "9c906528623eceae5b49f9e12569d555083ac7924643404b97484f5f63395c36",
    "OIDC 发现、CORS 请求与响应、授权类型限制、数据库故障和 UserInfo 错误。"
  ],
  [
    "DuoYu-ID/server/service_mail.go",
    "4a47aa504856cb1864c52868cd7689b808b327022d67189d5ac7dfd966faf53f",
    "项目权限、幂等请求、配额事务、状态查询与重试。真实投递单列。"
  ],
  [
    "DuoYu-ID/admin/src/api/auth.ts",
    "58831cb2416423dbd49cefa828eabb8c3462007590eb012269c0f359fb793a4b",
    "账号中心跳转和同源用户信息入口。"
  ],
  [
    "DuoYu-ID/admin/src/api/duoyu.ts",
    "de38fc97f57606d3e237a63e30dd2c95bae05d0b2c8e2f4ad71f89d4aebd693b",
    "JSON 与 FormData 请求、401 跳转、响应解析和标识信息。"
  ],
  [
    "DuoYu-ID/admin/src/router/core/ComponentLoader.ts",
    "df3e44ad4b55e09eefad20f2b8cc861cf74fcf084086773ac3adbbba05e9bc98",
    "视图允许目录、动态导入和加载失败界面。"
  ],
  [
    "DuoYu-ID/admin/src/router/core/RoutePermissionValidator.ts",
    "f7e4d96f7e695bb2c358d93860e0ca5d50dfb03522f8f76cb551a0aeeff5f73c",
    "菜单权限的精确、动态和路径前缀匹配；权限最终由服务端执行。"
  ],
  [
    "DuoYu-ID/admin/src/router/guards/afterEach.ts",
    "f009241531183e1478b8a48246295fb8e3a81fff00a556daad7458d5578fcfee",
    "导航结束后滚动、进度条与加载状态清理。"
  ],
  [
    "DuoYu-ID/admin/package.json",
    "0f2bdf8fdf266177d10ecc146c8f91e5f2773c08a3cff5b2b809e665684faf24",
    "构建、静态检查、依赖兼容测试和包管理器版本。"
  ],
  [
    "DuoYu-ID/Dockerfile",
    "18b1933d0d2666445aea68d35a4022cff271f75207e98db89adf10126a41a4b5",
    "分阶段构建、冻结依赖及非 root 运行身份；本次验证原生部署，未运行完整 Docker 镜像构建。"
  ],
  [
    "DuoYu-ID/Caddyfile.example",
    "ef0ae2b929e91f6c871948cff033aa4ca830ba0ae7f29854c292625eebcd6a3c",
    "文档中的到本地账号服务反向代理；正式服务使用宝塔。"
  ],
  [
    "DuoYu-ID/.github/workflows/test.yml",
    "89a554cedfcee3edd3a32018d021239684ea6c3a5c887e1ebe10623b32f13c1d",
    "一次性 PostgreSQL 服务、Go 与浏览器检查；CI 的 pnpm 版本已与本地和 Docker 对齐。"
  ],
  [
    "DuoYu-ID/go.mod",
    "dedacea0a2f95311427109b0b2171ea3f20af26ffebb0f672af1a1febb8fc7c4",
    "项目依赖与编译器版本；Go vet、缓存完整性、Linux 构建与协议测试。"
  ],
  [
    "DuoYu-ID/go.sum",
    "cbf2d8c9f98297a77ddf55aa139da98c97cc8ce6b3230818e034be9b4a8e10ba",
    "Go 依赖完整性记录；运行 go mod verify，此项不等同外部漏洞扫描。"
  ],
  [
    "DuoYu-Backend/server/backend/schema.sql",
    "8c3142af4e569e5df582e8dd89d609bc9eff5e8cb1d11d25550aa7bdcfbe06f4",
    "资产历史数据兼容、触发器、角色相关表、完整 DDL 事务以及失败后重复升级。"
  ],
  [
    "DuoYu-Backend/server/sync/schema.sql",
    "2fcb5a9d9d213f0996443654ddc88c558b69256d53086e52c866e50e9c1710df",
    "RLS、用户恢复点、引用及清理函数、事务完整性与更新可重入。"
  ],
  [
    "DuoYu-Backend/server/sync/test/schema-atomicity.test.mjs",
    "3ad940cefabe60666f3ec1553b29f176e0eab7b00570d53bc9ad7aad1bbc5809",
    "两个数据库安装脚本的后段故障、事务回滚及两次重复执行；只使用临时 schema。"
  ],
  [
    "DuoYu-Backend/server/backend/grants.sql",
    "e6af85a68177a8388f1ebb879d269efc4d579dfaec0b36474c3e9c293d237a69",
    "业务账号及同步账号的表权限和行级策略；已比对正式磁盘版本。"
  ],
  [
    "DuoYu-Backend/server/backend/lifecycle.go",
    "86ab0091e194f9da05cafb31b92c230959c6c87024170237a3504d4f3d634156",
    "HTTP 排空、超时关闭及释放连接前等待。"
  ],
  [
    "DuoYu-Backend/server/sync/src/lifecycle.mjs",
    "19725a39be4aeaad00dbd59c8c98b19c6b05d7843aea5245897b32a8e650b518",
    "幂等停止、连接排空和连接池释放。"
  ],
  [
    "DuoYu-Backend/server/sync/src/main.mjs",
    "9c34bc6c9dccd8c9d68dfbd8c2e5af0695538ce847554fb5a6371f7c576b38b7",
    "显式迁移与提供 HTTP 服务的启动分支、数据库超时和退出信号。"
  ],
  [
    "DuoYu-Backend/server/sync/nginx.conf",
    "cd99121d78bbdaf2555ca92974939a89e7d8a69d9879f7e908e49b79554f4722",
    "反向代理指向 Go 网关，TLS、请求大小、缓存与超时；未覆盖宝塔 Nginx 配置。"
  ],
  [
    "DuoYu-Backend/server/backend/catalog_preview.go",
    "4884d20cd350d56cd9d28ab846e6349ec068d13ff309a2f594f587701f28b055",
    "图片解析前的像素上限、缩放、并发解码、预览哈希和落盘。"
  ],
  [
    "DuoYu-Backend/admin/package.json",
    "f331f284c7e7e450c8e19ca38f5162908c3ed1940087db05d027c7f7478ab804",
    "管理界面构建、类型检查和本地资源依赖。"
  ],
  [
    "DuoYu-Backend/package.json",
    "ef8ae9eacb8501d266f7b8b4554e9f2d60c9e589b7f76972b7d072ee3825b34f",
    "根项目测试与构建入口、工作目录和包管理器。"
  ],
  [
    "DuoYu-Backend/server/sync/package.json",
    "deb93e988689e4fea8acf39f19630f21487016039167dbc222da5f171704f7fe",
    "Node 同步服务生产入口及完整测试集的发现。"
  ],
  [
    "DuoYu-Backend/server/backend/go.mod",
    "1f32d6dd4317dc3ecd014740600e7961362b079ea9a570891eb4469af4c11b49",
    "后端模块与编译器约束；以 Go vet 和 Linux 构建验证。"
  ],
  [
    "DuoYu-Backend/server/backend/go.sum",
    "7046f48b566860678d71c2b08878e4f9fbf5da13d4c23815ac4ad718879cf009",
    "Go 后端模块校验，使用 go mod verify 而非外部漏洞判定。"
  ],
  [
    "DuoYu-Extensions/docs/cloud-sync-schema.sql",
    "26de91f6e542c6d9a1b05cf2fcebbe7839ab104ece03b6763c27563a19e23360",
    "历史数据结构提案与实际两份迁移入口的区别；文档已注明用途。"
  ],
  [
    "DuoYu-Extensions/scripts/restore-drill.mjs",
    "e01662371f3461292211489b58589920bb40bbb8f6cfa8d57be5344513f3c7f7",
    "隔离容器归属、数据表／序列／策略校验、损坏注入与清理；本轮重跑恢复演练。"
  ],
  [
    "DuoYu-Extensions/src/features/sync/ConflictCenter.vue",
    "30072676b12c8dface58dec9a7b65ae2bc4b1a4d42c21aeb0257c1968466110f",
    "待处理分组、刷新后成员归属与容量复查，本机提交前阻止布局溢出。"
  ],
  [
    "DuoYu-Extensions/src/features/sync/conflict-preview.ts",
    "015003ac8ee736adc21f051cf02e7c7bb06c4237763ab2b0e0fd551bbcadfc3d",
    "冲突分组、位置合并、移动前后视图和布局容量推导，回归覆盖云端与本机选择。"
  ],
  [
    "DuoYu-Extensions/src/features/sync/ConflictDesktopPreview.vue",
    "db5fa54bad330b9b9e3ea7690a0b076b3f48b8d75eae3285bed74138286ef0c5",
    "只读预览、工作区分组、图片加载竞态、URL 与监听器释放。"
  ],
  [
    "DuoYu-Extensions/src/features/auth/AccountPanel.vue",
    "ba02b3ab616e5786a1c055d979737d7ec986891c7b750c6b315f0d02afdddb75",
    "状态消息、账号入口、同步错误、冲突入口，以及组件挂载与解除监听。"
  ],
  [
    "DuoYu-Extensions/scripts/conflict-apply-flow.mjs",
    "b7c649367185bdb5996e97340d7e17d49fb88616eeb5685af98c02f269e5b3ad",
    "刷新改变布局容量后的用户选择不可上传。"
  ],
  [
    "DuoYu-Extensions/scripts/fixtures/id-security.mjs",
    "84474dfcaa00bf3ce7358ab50d32b5672e91d1318f37a36f45f481cb9062a4a0",
    "真实浏览器注册上限、写入失败的签名计数、二维码暂时失败后恢复及解绑。"
  ]
]) {
  const earlier = reviewed.get(file);
  reviewed.set(file, {reviewedSha256, scope, finding: scope, evidence: [...new Set([...(earlier?.evidence || []), 'CREDENTIALS.md'])]});
}
for (const [file, reviewedSha256, scope] of [
  [
    "DuoYu-Backend/.gitignore",
    "a84e1f261a3aee1e8a81d42ed8cf0571ae3ceaeb61a191b0bbe72e32cae224c9",
    "仓库排除构建目录、本地配置、测试数据和凭证文件，结合 Docker 上下文排除验证。"
  ],
  [
    "DuoYu-Backend/admin/pnpm-lock.yaml",
    "13c0474dfdc9b36c8dd95c893e3a82476b2c6738efc8fc3b31a31978d6a0125c",
    "核对锁文件与直接依赖，冻结安装检查；同步服务两种锁文件比对，账号中心外部表格包另做篡改验证。"
  ],
  [
    "DuoYu-Backend/admin/src/assets/local-icons.json",
    "1e3e062826d825edf97b6148a3ac177138306ec231191d04a5c1777c5636de2c",
    "校验本地图标清单、图标数据格式、实际构建加载。"
  ],
  [
    "DuoYu-Backend/admin/src/vendor/duoyu-id/source.json",
    "0630e404122bec2df0ccdd6064d2f09eef030f745281b1f4935854be857c4528",
    "共享样式来源及两端样式字节一致性。"
  ],
  [
    "DuoYu-Backend/admin/tsconfig.json",
    "d5e6cdc769f0c44376735fbe8610bef4887a512e1d842d69e74da6e65bc527ad",
    "解析类型检查配置、编译目标、别名及构建入口。"
  ],
  [
    "DuoYu-Backend/docs/project-migration.md",
    "b4107db9ce1e14944ac56e1f83642a4c8c50ffe1e68de2df801c7d202840a9a2",
    "迁移说明、宝塔后端实际端口与旧配置兼容。"
  ],
  [
    "DuoYu-Backend/pnpm-lock.yaml",
    "756e075148c2391ae8076ddf0cee01cd160da8fb440b7f7afa6b29e8f75f179d",
    "核对锁文件与直接依赖，冻结安装检查；同步服务两种锁文件比对，账号中心外部表格包另做篡改验证。"
  ],
  [
    "DuoYu-Backend/server/backend/.env.example",
    "a90259c31c80fb87183f2d9003675dc394d38d24cd6927cb70b92e7b92493536",
    "审查服务地址、公开与仅服务端配置边界、环境示例和运行方式。"
  ],
  [
    "DuoYu-Backend/server/sync/package-lock.json",
    "a77f3c0b3a9b7cb1da3b84b1b3cf25bd6fa8c2f70bd8081d3ff297237fd87b17",
    "核对锁文件与直接依赖，冻结安装检查；同步服务两种锁文件比对，账号中心外部表格包另做篡改验证。"
  ],
  [
    "DuoYu-Backend/server/sync/pnpm-lock.yaml",
    "ed68f1b7a0edfadcafdfff32ab5af5e728e6687dcdb4dc3abd86b71ee61bffe5",
    "核对锁文件与直接依赖，冻结安装检查；同步服务两种锁文件比对，账号中心外部表格包另做篡改验证。"
  ],
  [
    "DuoYu-Extensions/.editorconfig",
    "f000102bd4c1a767896b393391d11934a6c1deba7d610c6d36c6686514d7222a",
    "格式及编辑器配置、解析和与项目检查的关系。"
  ],
  [
    "DuoYu-Extensions/.env.example",
    "1693b103fe1008044fbdfa793f8ec17b1ca840f4f14bbb6d2b05ba3676d7d1cb",
    "审查服务地址、公开与仅服务端配置边界、环境示例和运行方式。"
  ],
  [
    "DuoYu-Extensions/.gitignore",
    "7a8157519d33b6b7e3622285f8b8455b1afcff6bcc3bc38a8a4697032306b203",
    "仓库排除构建目录、本地配置、测试数据和凭证文件，结合 Docker 上下文排除验证。"
  ],
  [
    "DuoYu-Extensions/.prettierrc.json",
    "2523c84022f711ac9793535e709a65e34d6fb25e2315614bc817248debe03bb1",
    "格式及编辑器配置、解析和与项目检查的关系。"
  ],
  [
    "DuoYu-Extensions/package.json",
    "c464f259f689644238e0dcd517377bfeb94154601c9551f5c8b7a2c1c9fbc6b3",
    "核对脚本、包管理器、直接依赖约束和冻结安装结果。"
  ],
  [
    "DuoYu-Extensions/pnpm-lock.yaml",
    "1cd4c6fa0990057783d236c6c70c9824d15e4357eea77e666cbe8f5b2e1cf547",
    "核对锁文件与直接依赖，冻结安装检查；同步服务两种锁文件比对，账号中心外部表格包另做篡改验证。"
  ],
  [
    "DuoYu-Extensions/tsconfig.json",
    "4bf9964843549f48d89454568660c05a46b46d2224ba2cd67106198ffbbb7d14",
    "解析类型检查配置、编译目标、别名及构建入口。"
  ],
  [
    "DuoYu-ID/.env.example",
    "7903db218ce675acc451aa93cc7c2ed66670a5626c95e4baa9a20190c158a91d",
    "审查服务地址、公开与仅服务端配置边界、环境示例和运行方式。"
  ],
  [
    "DuoYu-ID/.gitignore",
    "3d79ddc03bb47a228d50a74851d77d6ffe0ec22b5320be5e010caac7a7f0a721",
    "仓库排除构建目录、本地配置、测试数据和凭证文件，结合 Docker 上下文排除验证。"
  ],
  [
    "DuoYu-ID/admin/.gitignore",
    "d3b465328a349f89ab3db38bac343537fa050e362c1ad27d4454a5d5bfc28272",
    "仓库排除构建目录、本地配置、测试数据和凭证文件，结合 Docker 上下文排除验证。"
  ],
  [
    "DuoYu-ID/admin/.vscode/extensions.json",
    "f503ba7993e45371d32bf7e0df97a0249cd34c83398e5ca22b2ce6e24961bbc3",
    "格式及编辑器配置、解析和与项目检查的关系。"
  ],
  [
    "DuoYu-ID/admin/.vscode/settings.json",
    "d9bc5c6e5eabe30ef25a3020bf04533c96d33db4e588da94c98b71b3da8c5705",
    "格式及编辑器配置、解析和与项目检查的关系。"
  ],
  [
    "DuoYu-ID/admin/pnpm-lock.yaml",
    "81085c433ef6784c4fa378cea2644cbea735dd79cbe73ca3f8359265fb71e2fe",
    "核对锁文件与直接依赖，冻结安装检查；同步服务两种锁文件比对，账号中心外部表格包另做篡改验证。"
  ],
  [
    "DuoYu-ID/admin/pnpm-workspace.yaml",
    "2d9cb9be2c26142c745b14405632882c20a73905c0f2fe1ff7a3fc3a0b5890b1",
    "核对 pnpm 构建脚本信任配置和六项实际忽略的依赖。"
  ],
  [
    "DuoYu-ID/admin/src/api/system-manage.ts",
    "ddbf0df07b21d902bfdf842dbd887fc065485b7f89210f16aa3d4eb34d2948a8",
    "用户、角色、菜单调用入口与调用方；真实权限以服务端路由矩阵核验。"
  ],
  [
    "DuoYu-ID/admin/src/assets/local-icons.json",
    "46cd54f64d0ec37b8a741669eb156c4a85c009648bef631bfd48e5830c4d57a1",
    "校验本地图标清单、图标数据格式、实际构建加载。"
  ],
  [
    "DuoYu-ID/admin/src/components/core/forms/art-excel-export/index.vue",
    "8a31787bc005bd3eec26c9f4ae7f8c8ed72945e7e7dbc9583709a8e9fb048003",
    "工作表导入导出、字段与数字零值、表格依赖对旧格式和中文的兼容。"
  ],
  [
    "DuoYu-ID/admin/src/components/core/forms/art-excel-import/index.vue",
    "fad96e8e9ae436855220e0a34f207b7ea9b04b3f4dde98673febca2bbc3e9584",
    "工作表导入导出、字段与数字零值、表格依赖对旧格式和中文的兼容。"
  ],
  [
    "DuoYu-ID/admin/src/locales/langs/en.json",
    "0a20901534789651c490505c1ca2a2928e4b6f69a42d719a59aec661af42b0b3",
    "中英 180 个翻译键对齐及组合式 API 的兼容。"
  ],
  [
    "DuoYu-ID/admin/src/locales/langs/zh.json",
    "3d18e5da1fd43750e45c35533df8ea349d494c8c4b5b53fa765c8446afd598ec",
    "中英 180 个翻译键对齐及组合式 API 的兼容。"
  ],
  [
    "DuoYu-ID/admin/src/router/core/IframeRouteManager.ts",
    "c1e1363ef02d5baf646cb8427a3c0abad7b38e033406f5334c8436b3781c0568",
    "动态菜单和 iframe 登记的存储、清理及账号切换。"
  ],
  [
    "DuoYu-ID/admin/src/router/core/MenuProcessor.ts",
    "43f92c968070ec1b0d93073fb184a654f320549da29b68f5328b3d9fb88a5fbe",
    "角色过滤、空角色拒绝、菜单路径处理和管理入口不可达测试。"
  ],
  [
    "DuoYu-ID/admin/src/router/core/RouteRegistry.ts",
    "a68e507b6f23c1636bb5f0f3ab34dbacf98b50c97b0628089cedb76a3234dd2d",
    "嵌套路由安装中断的回滚、重试和卸载。"
  ],
  [
    "DuoYu-ID/admin/src/router/core/RouteTransformer.ts",
    "92d709f6764ea51ee59d85a18455d83124a7e6ee38e64c1d2213afc0f73b1751",
    "菜单到路由的嵌套映射、目录和 iframe 分支。"
  ],
  [
    "DuoYu-ID/admin/src/router/core/RouteValidator.ts",
    "6115bd1ad58c248f717474affc494ab42e23d0efc3156570f6c9f3da805f7333",
    "动态路由的路径、重名与组件验证范围。"
  ],
  [
    "DuoYu-ID/admin/src/router/core/index.ts",
    "30cbff450bd7934355f37ad58c2cc4de2049bd2231baabe0543801c1a12a494d",
    "核心路由模块导出与实际使用入口。"
  ],
  [
    "DuoYu-ID/admin/src/router/guards/beforeEach.ts",
    "9008382258add623eafd6c538becddfe81351602832314aa25c7831371672730",
    "并发初始化、401、临时 503、空角色、旧路由回收和最终导航。"
  ],
  [
    "DuoYu-ID/admin/src/router/index.ts",
    "40d9a23692f2df3370e3466f5028622102b493ee588827f6d76ed9cc7f6d5b61",
    "路由名称、静态和动态注册来源、访问角色、入口与服务端授权关系。"
  ],
  [
    "DuoYu-ID/admin/src/router/modules/dashboard.ts",
    "fe74a20669f7857acdc89b75bd978d6f5b7e614f30383dcb55ad6499e0c0bb85",
    "路由名称、静态和动态注册来源、访问角色、入口与服务端授权关系。"
  ],
  [
    "DuoYu-ID/admin/src/router/modules/exception.ts",
    "45ccfe77dc8d5bf605d023a57ac243d11cbad7bcb9cd0c29dc288c5709523287",
    "路由名称、静态和动态注册来源、访问角色、入口与服务端授权关系。"
  ],
  [
    "DuoYu-ID/admin/src/router/modules/index.ts",
    "4edb59127106544090243eee77bf2f0b6e0defe23cba3becef4ff8ef613f192c",
    "路由名称、静态和动态注册来源、访问角色、入口与服务端授权关系。"
  ],
  [
    "DuoYu-ID/admin/src/router/modules/result.ts",
    "89e9160e25f823abe22156010da9ba2bfa378894ef97e3e71e9dd6188c17dedf",
    "路由名称、静态和动态注册来源、访问角色、入口与服务端授权关系。"
  ],
  [
    "DuoYu-ID/admin/src/router/modules/system.ts",
    "7d3a5461f658d5a9bf77b74e5e3839333f374cbddff51331d5bf190a9e4fcb5b",
    "路由名称、静态和动态注册来源、访问角色、入口与服务端授权关系。"
  ],
  [
    "DuoYu-ID/admin/src/router/routes/asyncRoutes.ts",
    "3e7f7bfe559500e2dee6d35419dcf356bc03c30f412fe173bd3ed6a60a8fb5fe",
    "路由名称、静态和动态注册来源、访问角色、入口与服务端授权关系。"
  ],
  [
    "DuoYu-ID/admin/src/router/routes/staticRoutes.ts",
    "35995f8e3f8d72627582af19c74c171f2d416f6033f6a691b47429e33297822b",
    "路由名称、静态和动态注册来源、访问角色、入口与服务端授权关系。"
  ],
  [
    "DuoYu-ID/admin/src/router/routesAlias.ts",
    "2bc205a68fcd3d7cb851195fe249fd4f9aef4520feb9bf4e409637de2264fdff",
    "路由名称、静态和动态注册来源、访问角色、入口与服务端授权关系。"
  ],
  [
    "DuoYu-ID/admin/src/types/api/api.d.ts",
    "b443f22c0d56984dd4ae7fadb4946933c40870364aecea62d4a81d36633d7155",
    "账号 ID 的字符串契约和基础响应类型，与真实接口响应核对。"
  ],
  [
    "DuoYu-ID/admin/src/types/import/auto-imports.d.ts",
    "fa409df6fe42cbc4075cafda960439d4378499ec3ef01de559c66e545be42924",
    "自动导入、组件类型的生成来源与生产编译。"
  ],
  [
    "DuoYu-ID/admin/src/types/import/components.d.ts",
    "f04d57bf745f87edcfbf7dc69ad220610ddc70899f4e4b1eef56be608be9fb0b",
    "自动导入、组件类型的生成来源与生产编译。"
  ],
  [
    "DuoYu-ID/admin/src/types/router/index.ts",
    "3a0eacbb52e9a654bff52576072a8ed8850ecaf67c61a840420cb0f0abea6681",
    "路由名称、静态和动态注册来源、访问角色、入口与服务端授权关系。"
  ],
  [
    "DuoYu-ID/admin/tsconfig.json",
    "975c1cf76307e4d9c9ea9c467a242404960d07b7b8f64677da007d6924d4e9ac",
    "解析类型检查配置、编译目标、别名及构建入口。"
  ],
  [
    "DuoYu-ID/compose.dev.yaml",
    "f3c3d23cd32734bc21c4a1e69c3a69036f3596f7b45ea883d8573ea68c1296f8",
    "运行角色、依赖、挂载及配置插值；实际解析开发和生产两份 Compose。"
  ],
  [
    "DuoYu-ID/compose.yaml",
    "28c3c86c87f5713afd5041340250ab30f70febb2d012e4d4f5387fb5f8fec49a",
    "运行角色、依赖、挂载及配置插值；实际解析开发和生产两份 Compose。"
  ],
  [
    "DuoYu-ID/server/avatar.go",
    "27c02a1047179e177e910ab8c7a758a259a637e29a640ab367a5a94317364b14",
    "受管图片命名、文件及父目录符号链接、实际目录约束、普通读取和数据库失败路径。"
  ],
  [
    "DuoYu-ID/server/diagnostics.go",
    "8dbf9cc590f27135251c1527da5addb6a9f7bd07355f10ffb31e14fff489eb42",
    "管理身份边界及诊断返回数据；接口权限矩阵。"
  ],
  [
    "DuoYu-ID/server/http_response.go",
    "995798b3a052c329ab34ec83625a2888082763147f97111921d156c68509a1fb",
    "标准响应、错误信息、状态码和请求标识。"
  ],
  [
    "DuoYu-ID/server/legal.go",
    "f38903f82958a094b1dff69ba9ed207b392ace3a35dfda2eb3e8783cfee7fdeb",
    "法律文本访问及接受记录的权限和数据流。"
  ],
  [
    "DuoYu-ID/server/lifecycle.go",
    "86ab0091e194f9da05cafb31b92c230959c6c87024170237a3504d4f3d634156",
    "服务关闭及上下文资源释放。"
  ],
  [
    "DuoYu-ID/server/monitoring.go",
    "db485699eca6584fdbde100e46610bb7e268820afb33488e11e9db6027b310c9",
    "数据库指标读取、后台角色与监控记录。"
  ],
  [
    "DuoYu-ID/server/pagination.go",
    "d9482bb6c9c2c51e580df6bf908d4e4cb7f273ac462f1f3273efc0a58aef2d60",
    "列表计数与记录在同一只读快照，空查询不生成 JSON 文本扫描。"
  ],
  [
    "DuoYu-ID/server/project_logo.go",
    "535ce0575bd25747a0fa2e9520bf84032f9347d2313b543b10f980f9d2019994",
    "受管图片命名、文件及父目录符号链接、实际目录约束、普通读取和数据库失败路径。"
  ],
  [
    "DuoYu-ID/server/service_spec.go",
    "a2e8826feb51f090501edfc2ad27a81d5ce1b4258d4f7b3127c67d3307535ea5",
    "服务接口说明、公开契约及管理调用关系。"
  ],
  [
    "DuoYu-ID/server/public_images.go",
    "0eaaedf124b34869f4d1a4d334742612815f2e5ddf16eae06d52780261547302",
    "公开图片目录、文件句柄一致性和文件边界，Linux 下复现并回归父目录与叶子链接。"
  ],
  [
    "DuoYu-ID/server/public_images_test.go",
    "4c062698868997943afbb52185b136dbdd6e2b828b1a4bdb77e65410a5d7a3dd",
    "公开图片目录、文件句柄一致性和文件边界，Linux 下复现并回归父目录与叶子链接。"
  ],
  [
    "DuoYu-ID/server/pagination_test.go",
    "87c918c68dbd5c25c89e7132d733a8bb72e79c4ebc1a7ac375b49f0fb910d3c6",
    "真实 PostgreSQL 并发写入时列表行数与计数一致，挂入全套 Go 测试。"
  ],
  [
    "DuoYu-ID/server/server_test.go",
    "13c8249a90c522113ef28ec9ac9f6caf77f444fc440e0d2e43a2e2156e3750ff",
    "真实 PostgreSQL 并发写入时列表行数与计数一致，挂入全套 Go 测试。"
  ],
  [
    "DuoYu-ID/admin/src/main.ts",
    "6222a20a7d0168f6f2ca466913a92e1e82c7981f01cc1397e837b1d1219d38c7",
    "用户首次读入、失败后重试、注销时即时清理，临时失败和快速切换路由的浏览器回归。"
  ],
  [
    "DuoYu-ID/admin/src/store/modules/user.ts",
    "9f3f6581f9eb14570ea5c0e2cba583b70db4878186068be2acf73b0a054d0ca7",
    "用户首次读入、失败后重试、注销时即时清理，临时失败和快速切换路由的浏览器回归。"
  ],
  [
    "DuoYu-ID/admin/src/components/core/layouts/art-screen-lock/index.vue",
    "ceab4ac3f3cbb67ccceee95a0a0e2627a398b0aaa6833b9a6ea889025f51d650",
    "锁屏密码改为有盐摘要，兼容旧数据、避免竞态、移除全局监听；双实现交叉校验和浏览器刷新解锁。"
  ],
  [
    "DuoYu-ID/admin/src/components/core/layouts/art-screen-lock/lock-proof.ts",
    "d67f506830609ef674f32edf969f0b585cfe8171554f96e55fe8caf6d9ad4a87",
    "锁屏密码改为有盐摘要，兼容旧数据、避免竞态、移除全局监听；双实现交叉校验和浏览器刷新解锁。"
  ],
  [
    "DuoYu-ID/admin/tests/lock-proof.mjs",
    "18a50fe0339cdcbf2b4503574b4176140300714c87e723a19e525449cd28e265",
    "锁屏密码改为有盐摘要，兼容旧数据、避免竞态、移除全局监听；双实现交叉校验和浏览器刷新解锁。"
  ],
  [
    "DuoYu-ID/admin/tests/route-registry.mjs",
    "92466160cc6fbfa776a99c67e0b96541b072e2ebc0fcc190f2afbcbcfdae6763",
    "真实 Vue Router 局部注册失败的回滚与重试、依赖兼容入口。"
  ],
  [
    "DuoYu-ID/admin/tests/dependency-compat.mjs",
    "ef60f5843b4addde60f7f4f229bee3baa9a403fa7f804225ee0cd3d0f3e19516",
    "真实 Vue Router 局部注册失败的回滚与重试、依赖兼容入口。"
  ],
  [
    "DuoYu-ID/.dockerignore",
    "89a71f6bb9b0e830bbf61753f2cf44f672dba4fbd6e8d8a6c23570785e69aaa4",
    "构建上下文排除本地秘密和备份；用含假凭证的临时构建上下文验证。"
  ],
  [
    "DuoYu-ID/admin/src/views/auth/login/index.vue",
    "8b77821047ed563b20e682945c578548f7cda0ada48dec333fa27afcbad1ba36",
    "旧 SPA 账号入口实际跳转目标与登录表单的归属。"
  ],
  [
    "DuoYu-ID/admin/src/views/auth/register/index.vue",
    "8b77821047ed563b20e682945c578548f7cda0ada48dec333fa27afcbad1ba36",
    "旧 SPA 账号入口实际跳转目标与登录表单的归属。"
  ],
  [
    "DuoYu-ID/admin/src/views/auth/forget-password/index.vue",
    "8b77821047ed563b20e682945c578548f7cda0ada48dec333fa27afcbad1ba36",
    "旧 SPA 账号入口实际跳转目标与登录表单的归属。"
  ],
  [
    "DuoYu-ID/docs/operations.md",
    "dd3db747f233102c6a807ddf7fd7fa9b9e0803152f8869c1380ae743a899e49f",
    "角色与环境变量、SMTP、上线和恢复说明；数据库、数据目录、撤销与黑名单行为对照源码。"
  ],
  [
    "DuoYu-ID/docs/configuration.md",
    "7322e7dbf6e644167f428e7c1e9678271c231121cdcba67e1af7d7021ca73a93",
    "角色与环境变量、SMTP、上线和恢复说明；数据库、数据目录、撤销与黑名单行为对照源码。"
  ],
  [
    "DuoYu-Extensions/scripts/auth-isolated.mjs",
    "a480c8f91be537371964aa45ed55581d4a40b24a3667318086f08562e3c8c0e4",
    "隔离身份、管理访问、切换、异常、真实浏览器回归与测试环境清理。"
  ],
  [
    "DuoYu-Extensions/scripts/fixtures/id-route-access.mjs",
    "abac8f04aa7ad48835431d94a429e1f9296d8837bf27663f28d96be74956085b",
    "隔离身份、管理访问、切换、异常、真实浏览器回归与测试环境清理。"
  ],
  [
    "DuoYu-Extensions/scripts/fixtures/id-pages.mjs",
    "d2838ab8184d7eafc1bf16ee7a23b6d608e5a2b1a682f7c7761184a8bc31425c",
    "隔离身份、管理访问、切换、异常、真实浏览器回归与测试环境清理。"
  ],
  [
    "DuoYu-Extensions/scripts/fixtures/multi-account-soak.mjs",
    "b2efaf9f34a3ebcf43863cf0075ccb797376f6e7a0502b3c1d7ff06ea7bf02f1",
    "三个独立账号同一实体 ID 的读写、续期、数据库行对照和浏览器资源清理。"
  ],
  [
    "DuoYu-Extensions/src/features/search/bing.ts",
    "010127766df5ac2bb4c70ba1ba961a21295fbc18a6aaf4642e6890e0e29209c3",
    "搜索输入取消、过时结果、缓存、流式响应大小限制、异常恢复及浏览器界面回归。"
  ],
  [
    "DuoYu-Extensions/src/features/search/useSearchSuggestions.ts",
    "91b4c0e780a47599aff7d9268bf0a3ea49aab10ddf889e7fed1cff1dd7cbc16d",
    "搜索输入取消、过时结果、缓存、流式响应大小限制、异常恢复及浏览器界面回归。"
  ],
  [
    "DuoYu-Extensions/scripts/search-regression.mjs",
    "4a8e42a71ada13bee37f29366964ec46c62dfe7117f6d2960b03ea3af39b6eba",
    "搜索输入取消、过时结果、缓存、流式响应大小限制、异常恢复及浏览器界面回归。"
  ],
  [
    "DuoYu-Extensions/src/features/search/engines.ts",
    "254e181b25ebfe3d72d9ee365cf591565e4c5e66952c59fa4d10dfc9b8db3742",
    "搜索引擎白名单和参数编码；浏览器回归覆盖引擎切换和导航。"
  ],
  [
    "DuoYu-Extensions/src/features/library/link-title.ts",
    "20a6b6556019d1470d0ec8f0cfad1792ce08f00fa40502e266e73e3632a2f719",
    "书签标题提取与 Unicode 截断、外站图标 URL 过滤、请求超时、流式大小上限及释放；网站图标回归覆盖。"
  ],
  [
    "DuoYu-Extensions/src/features/library/website-title.ts",
    "74a21c71705deb923804202b522baaa46b4f246c4654b2eeb74da73a2166d3e6",
    "书签标题提取与 Unicode 截断、外站图标 URL 过滤、请求超时、流式大小上限及释放；网站图标回归覆盖。"
  ],
  [
    "DuoYu-Extensions/src/features/library/website-icon.ts",
    "9a7cebca1af1ff6a57fd9f55782d5c320a0197f4f0ef4535b597caf9f3cdaa92",
    "书签标题提取与 Unicode 截断、外站图标 URL 过滤、请求超时、流式大小上限及释放；网站图标回归覆盖。"
  ],
  [
    "DuoYu-Extensions/src/shared/response-body.ts",
    "9dbe1110549b597d068a2700963e940d9b0ecb809c8b018d3d518e803eb38c81",
    "书签标题提取与 Unicode 截断、外站图标 URL 过滤、请求超时、流式大小上限及释放；网站图标回归覆盖。"
  ]
]) {
  const earlier = reviewed.get(file);
  reviewed.set(file, {reviewedSha256, scope, finding: scope, evidence: [...new Set([...(earlier?.evidence || []), 'ACCESS.md'])]});
}
for (const [file, reviewedSha256, scope] of [
  [
    "DuoYu-Backend/admin/src/AdminIcon.vue",
    "745d899211e92dfa5e29536d2673718036328201e652a2a670b45711b9c1ec3d",
    "离线图标集与可访问性，实际本地打包。"
  ],
  [
    "DuoYu-Backend/admin/src/AdminSearch.vue",
    "6f0d42230e18e338f1617e5e6b8ee5e4b364113911b709eaf2b22a2e6eac4489",
    "查询表单提交、清除与键盘操作。"
  ],
  [
    "DuoYu-Backend/admin/src/App.vue",
    "171f2d92cb92a9a28b2010c88580f6b32a43704b633e1907830be511f225a97b",
    "会话 401 与临时不可用提示、就地重试、路由页签、移动菜单及注销。"
  ],
  [
    "DuoYu-Backend/admin/src/Dashboard.vue",
    "08f314a3dda8082b010c182bd1c2bf3e4a08e1efd0fdb7cb9ff05034dcebafeb",
    "并发刷新顺序、图表及 ResizeObserver 清理、错误与重试。"
  ],
  [
    "DuoYu-Backend/admin/src/FilePreview.vue",
    "de2b806711bb3b193a44920d926a34fef6568b876ed8b130036f6092f3b1d105",
    "图片加载、错误占位、尺寸重置及预览关闭。"
  ],
  [
    "DuoYu-Backend/admin/src/PageHeading.vue",
    "e7175663d4e507301e71d6c9f1d96708f4a9954655ad017fcc344ece60d2cf71",
    "刷新动作、加载反馈和页面标题。"
  ],
  [
    "DuoYu-Backend/admin/src/UserAvatar.vue",
    "18248bb16d34b6cd3f66c247152beda40fd7d02882dbab60ca67f39794201c85",
    "HTTPS 与默认头像、错误回退及不发送 Referrer。"
  ],
  [
    "DuoYu-Backend/admin/src/api.ts",
    "47982f7ef1ae0305598d955c283e87d73b3b58af671f9d1db8184188cb88a514",
    "真实会话 401 清理与 503 保持原页面、接口错误反馈和恢复。"
  ],
  [
    "DuoYu-Backend/admin/src/main.ts",
    "82cb8a64af63850c9d922c7207d9133d407309365b5c37fc2d5c4ff981045f15",
    "管理端入口、异步加载、旧 /sync 跳转及管理页面路由。"
  ],
  [
    "DuoYu-Backend/admin/src/navigation.ts",
    "3158959dfb21d56278c6111212d69a402625a5d6f3c792eaf7ecb1d5db03af94",
    "控制台菜单、明细页导航和分组顺序。"
  ],
  [
    "DuoYu-Backend/admin/vite.config.ts",
    "e76471559a751c03bfa1cf320238364575f13b8d1aa4e3f6e4c881d3d658dde9",
    "检查开发代理与本机构建入口，正式宝塔端口已分开记录。"
  ],
  [
    "DuoYu-Extensions/scripts/fixtures/business-pages.mjs",
    "90959df7c9fb81f74dc8c03028e428382f66d468059736a5df678402fe4ce493",
    "管理端真实 OIDC、503 重试、桌面和手机 13 个页面、资产/配额与会话隔离测试。"
  ]
]) {
  const earlier = reviewed.get(file);
  reviewed.set(file, {reviewedSha256, scope, finding: scope, evidence: [...new Set([...(earlier?.evidence || []), 'ACCESS.md'])]});
}
for (const [file, reviewedSha256, scope] of [
  [
    "DuoYu-Backend/admin/src/Manage.vue",
    "a5d92c590411ac1821436aebb8fde89d5b947c19c3b641bfc4783d6d5faf547a",
    "管理页读取、路由切换、表单提交和失败重试。真实延迟 POST 表明提交时仍可编辑，已锁定进行中的表单，回归 13 页桌面与窄屏以及真实增删改。"
  ],
  [
    "DuoYu-Backend/server/backend/admin.go",
    "ff865fc39c8a133691803476f6e7189fcaf5aaa3a5673713fb44359f41ef1c79",
    "旧备份下载的目录内读取、打开句柄身份、目录外替换文件和旧格式可下载性。Linux 250 次替换，改前实际返回外部内容，修复后同场景通过。"
  ],
  [
    "DuoYu-Backend/server/backend/backup_management.go",
    "620ea501076813c78a1446027396fd244bea6129908c8c7a27c3d973b57e74df",
    "旧备份下载的目录内读取、打开句柄身份、目录外替换文件和旧格式可下载性。Linux 250 次替换，改前实际返回外部内容，修复后同场景通过。"
  ],
  [
    "DuoYu-Backend/server/backend/user_backups_test.go",
    "1157f13a33463942355be9e7b7c61c012a23df2443771105eb1e8a53f0146174",
    "旧备份下载的目录内读取、打开句柄身份、目录外替换文件和旧格式可下载性。Linux 250 次替换，改前实际返回外部内容，修复后同场景通过。"
  ],
  [
    "DuoYu-Extensions/src/features/library/library.ts",
    "b4b1b90c344374bb13882f67bde6d007f2a14902b9b83cdd4e8e604fb91779f3",
    "收藏、文件夹与收藏页删除和修改、移动、排序、旧默认页及 home 虚拟页；写事务内查目标，跨页编辑、过期排序拒绝。"
  ],
  [
    "DuoYu-Extensions/src/features/library/pages.ts",
    "ca3b5f13d3d4c36d349f56c7fd381fa947b1fcfb096347545b366be30fed9062",
    "收藏、文件夹与收藏页删除和修改、移动、排序、旧默认页及 home 虚拟页；写事务内查目标，跨页编辑、过期排序拒绝。"
  ],
  [
    "DuoYu-Extensions/src/features/library/LibraryPageMenu.vue",
    "aa5841a4218f88033e56385603d123f0d9ba815c6471bb6eda54c7afe677f1a3",
    "收藏、文件夹与收藏页删除和修改、移动、排序、旧默认页及 home 虚拟页；写事务内查目标，跨页编辑、过期排序拒绝。"
  ],
  [
    "DuoYu-Extensions/src/features/library/LibraryBoard.vue",
    "ab06b598c51c66331125627b9fec30e41284208fd44c16998cddba7f4eca415c",
    "首页和收藏页共用的组件新建、编辑、标题获取、单次提交、拖放与菜单，核对组件与普通收藏同一事务检查目标页。"
  ],
  [
    "DuoYu-Extensions/src/features/library/grid-layout.ts",
    "3c62a82d7dae4d11ae27273896f25e2d474db897ef80fc9b3453695bb1a09559",
    "检查网格占位、最小最大跨度、尺寸菜单、带引号 ID 查找和排序；渲染历史异常尺寸时保护布局与菜单。"
  ],
  [
    "DuoYu-Extensions/src/features/library/GridItemMenu.vue",
    "1f5719f94842767a7b4da8936dc658039300f3dd0b56ed7ce0a37377b1b789d3",
    "检查网格占位、最小最大跨度、尺寸菜单、带引号 ID 查找和排序；渲染历史异常尺寸时保护布局与菜单。"
  ],
  [
    "DuoYu-Extensions/src/features/library/LibraryGrid.vue",
    "1e27ec91b5716a03f5cea26b5627d3e75ae45772a8c51e10f3577240e49210a8",
    "检查网格占位、最小最大跨度、尺寸菜单、带引号 ID 查找和排序；渲染历史异常尺寸时保护布局与菜单。"
  ],
  [
    "DuoYu-Extensions/src/features/library/FolderIconGrid.vue",
    "929fc3e2a22fc4d62c60fccf9221a3f80dcb800e62da93c25d8a89e141704427",
    "文件夹内排序、更改后再拖动、移出、拖动状态清理；文件夹分页与真实拖拽回归。"
  ],
  [
    "DuoYu-Extensions/src/features/library/FolderPreviewIcons.vue",
    "a7501bbbb9cedf3bdb5e21cd07581ea9a22ea19671834dcd0e3911181897e513",
    "文件夹内排序、更改后再拖动、移出、拖动状态清理；文件夹分页与真实拖拽回归。"
  ],
  [
    "DuoYu-Extensions/src/features/library/LinkIconEditor.vue",
    "b8581f4ed39c6f877957eccfe9f8b47550e15397e7b80c9ffebd9c76bc6b670f",
    "上传文件类型和大小、图片解码晚到与删除、编辑器卸载、图片句柄释放；实际浏览器 PNG 解码延迟后删除。"
  ],
  [
    "DuoYu-Extensions/src/features/wallpaper/MyWallpapers.vue",
    "19065f56abd1f34dc7e9928a19b15a430eb2efe651418b0830ca75d435cf31fd",
    "上传和商店壁纸显式选择、预览滞后、删除事务与锁；分别回归真实上传删除、部分预览失败和对象 URL 释放。"
  ],
  [
    "DuoYu-Extensions/src/features/wallpaper/wallpaper-cache.ts",
    "83f33a443389dc26951a36699abb85d44f33cf7a63c69363fb940d1e4c881b12",
    "上传和商店壁纸显式选择、预览滞后、删除事务与锁；分别回归真实上传删除、部分预览失败和对象 URL 释放。"
  ],
  [
    "DuoYu-Extensions/src/features/wallpaper/useWallpaperSelection.ts",
    "9d123b7e59d38b0d106eb4d56a197b913f47c9223db556ee1f75894c328ab97c",
    "桌面切换、偏好作用域、预览与清理，Dexie 的观察键随桌面变化，另页写入可见。"
  ],
  [
    "DuoYu-Extensions/src/features/wallpaper/desktops.ts",
    "6340e36ca3e5b06c95a8fd0118842b7d44f30379e459e3b715d9b2068c0c9294",
    "桌面切换、偏好作用域、预览与清理，Dexie 的观察键随桌面变化，另页写入可见。"
  ],
  [
    "DuoYu-Extensions/src/features/wallpaper/DesktopSwitcher.vue",
    "4e2b849d9605dfa273e775abab6a83c81fc7b742f352c5eea611615c68403cf8",
    "桌面切换、偏好作用域、预览与清理，Dexie 的观察键随桌面变化，另页写入可见。"
  ],
  [
    "DuoYu-Extensions/src/features/wallpaper/WallpaperBackground.vue",
    "1b09e6d7394cfb7ea24190d724d6841cac2f63fb95bda41e9ccafd35c7521e53",
    "启动渲染、解码时序、最新选择的恢复、同步确认与清理。"
  ],
  [
    "DuoYu-Extensions/src/features/wallpaper/wallpaper-intent.ts",
    "fcb0d724b7b264429dba8bd05699fb63edad721f147ab20b8ffca38b33542cb1",
    "启动渲染、解码时序、最新选择的恢复、同步确认与清理。"
  ],
  [
    "DuoYu-Extensions/src/features/wallpaper/download-wallpaper.ts",
    "f3ce324ff4869e72b22947c22de39e472f0f2beb1d4fd61732a6678f947b671e",
    "原图与每日地址、下载取消/大小、错误重试、第三方列表数据校验、去重、分页与响应大小限制。"
  ],
  [
    "DuoYu-Extensions/src/features/wallpaper/BingWallpaperGallery.vue",
    "528138b341dc898ad7a2cd4797dbfa034486fd16a84369cdbf081faa26747394",
    "原图与每日地址、下载取消/大小、错误重试、第三方列表数据校验、去重、分页与响应大小限制。"
  ],
  [
    "DuoYu-Extensions/src/features/wallpaper/wallpaper.ts",
    "930032211355e9d92aa1cc501654d189a3bd1874367f4bc3d8bc421a04c895cc",
    "原图与每日地址、下载取消/大小、错误重试、第三方列表数据校验、去重、分页与响应大小限制。"
  ],
  [
    "DuoYu-Extensions/src/features/wallpaper/WallpaperSurface.vue",
    "dd5935774cc0429cd56c834c4f3c8609b10002947d45a44e94bdf6919b40fc96",
    "壁纸状态、下载进度、装饰图片、网格边界与空白处手势，真实页面桌面和手机宽度回归。"
  ],
  [
    "DuoYu-Extensions/src/features/wallpaper/WallpaperSelectionMark.vue",
    "36bbdddeab845b86aa4207eaa9f4d53bc0a643c6296ea5d3018e295a64fd7e14",
    "壁纸状态、下载进度、装饰图片、网格边界与空白处手势，真实页面桌面和手机宽度回归。"
  ],
  [
    "DuoYu-Extensions/src/features/wallpaper/WallpaperDownloadProgress.vue",
    "00982a8dc25736ba6074924011a53cc3cb64d9d8617374a608358840207ebb39",
    "壁纸状态、下载进度、装饰图片、网格边界与空白处手势，真实页面桌面和手机宽度回归。"
  ],
  [
    "DuoYu-Extensions/src/features/wallpaper/blank-area.ts",
    "dbaf76fb62473e81d1de163398d5324be55f6bcb2c6ef8beac26cd9d758f78b4",
    "壁纸状态、下载进度、装饰图片、网格边界与空白处手势，真实页面桌面和手机宽度回归。"
  ],
  [
    "DuoYu-Extensions/src/features/desktop/CloudCatalog.vue",
    "5e4b330b553f366bb3505e67400718668b1d10446096af05dfb48372ab45d7b9",
    "商店列表的请求代数、应用事务、缩略图 URL 与组件尺寸传入。"
  ],
  [
    "DuoYu-Extensions/src/features/desktop/home-grid.ts",
    "13e50b9932dad0fb3c519a0273e81a6f70c974d6a51eb0f33a1bec55cf04b525",
    "旧首页分组迁移、幂等标志、加载错误，退出时数据库实例与账号标志不同步，避免写错数据库。"
  ],
  [
    "DuoYu-Extensions/src/features/desktop/BottomWidgets.vue",
    "39e663f09dd9f736877003670ae52252fd182e71f3726fb96bad8b487f98f483",
    "旧首页分组迁移、幂等标志、加载错误，退出时数据库实例与账号标志不同步，避免写错数据库。"
  ],
  [
    "DuoYu-Extensions/src/features/desktop/widget-links.ts",
    "5c3671dde3fa25dd061103f9aa81450e6a17cbfd592b72e6cab0794df94fcf91",
    "旧首页分组迁移、幂等标志、加载错误，退出时数据库实例与账号标志不同步，避免写错数据库。"
  ],
  [
    "DuoYu-Extensions/src/features/desktop/settings-state.ts",
    "e8c8d50773757f9184b0727b53090822f79b4e38ce00dde23867638503d38a4c",
    "设置弹窗的打开状态、默认分区和记忆目标页，与首页菜单入口核对。"
  ],
  [
    "DuoYu-Extensions/src/shared/storage/database.ts",
    "1c32f25b0e8eb13222cf932cbf7313423fc47e1175fe71d48569b46cf4688fec",
    "页面生命周期的数据库命名和账号标记，拒绝过时页面写入及撤销整个事务；现有版本迁移和 outbox 路径。"
  ],
  [
    "DuoYu-Extensions/src/shared/storage/account.ts",
    "9dd819dd5b1e23a96bedeb4bbf867960b889561d99b3cb4e60240972235ac796",
    "页面生命周期的数据库命名和账号标记，拒绝过时页面写入及撤销整个事务；现有版本迁移和 outbox 路径。"
  ],
  [
    "DuoYu-Extensions/scripts/data-integrity.mjs",
    "918d665ca9a0c582d65b14f7107068d01d9da500a6a93c958867b6660c52f79c",
    "增补真实渲染、真实图标解码延迟和 IndexedDB 读写，缺失目标页、畸形尺寸、旧账号提交和中途切换时事务回滚。"
  ],
  [
    "DuoYu-Extensions/scripts/library-crud-ui.mjs",
    "8522c4cb9263e5674bd03fcfe72dcaa4722caa8ce011454ac9e14f4d3545271b",
    "增补真实渲染、真实图标解码延迟和 IndexedDB 读写，缺失目标页、畸形尺寸、旧账号提交和中途切换时事务回滚。"
  ],
  [
    "DuoYu-Extensions/scripts/library-grid.mjs",
    "39ff1932d2c2dd84700795860652e0bbdf346e18b62929fc1633206d027d5d9b",
    "增补真实渲染、真实图标解码延迟和 IndexedDB 读写，缺失目标页、畸形尺寸、旧账号提交和中途切换时事务回滚。"
  ],
  [
    "DuoYu-Extensions/scripts/wallpaper-selection-race.mjs",
    "37e50de15fb0e024bffe721976632b4b777f6ccdf5eddc8cd575ff9e5a5cab07",
    "壁纸测试覆盖同步先于预览、部分预览失败、跨桌面订阅、响应提前取消、坏记录与重复记录，区分组件故障注入与真实浏览器。"
  ],
  [
    "DuoYu-Extensions/scripts/wallpaper-selection-state.mjs",
    "af71c525d3298291b8adef39fd7e3d79f158be9debb38696dfce1e69d55775ee",
    "壁纸测试覆盖同步先于预览、部分预览失败、跨桌面订阅、响应提前取消、坏记录与重复记录，区分组件故障注入与真实浏览器。"
  ],
  [
    "DuoYu-Extensions/scripts/wallpaper-download.mjs",
    "226696139c159398db4df0da89b069385f64a6be4cdaf089e0044379cf1fd0ac",
    "壁纸测试覆盖同步先于预览、部分预览失败、跨桌面订阅、响应提前取消、坏记录与重复记录，区分组件故障注入与真实浏览器。"
  ],
  [
    "DuoYu-Extensions/scripts/store-cards.mjs",
    "fbe665d4b0ae7a3182893027ee07b31c8e39b44b396afe0717d57d31d78c4764",
    "壁纸测试覆盖同步先于预览、部分预览失败、跨桌面订阅、响应提前取消、坏记录与重复记录，区分组件故障注入与真实浏览器。"
  ],
  [
    "DuoYu-Extensions/scripts/fixtures/business-crud.mjs",
    "8236af02caa02edec92aeed7f068e0b398f109b36ca4be61c8da6ed7af587846",
    "真实业务管理端新增和编辑后端记录，在保存请求传输途中验证编辑器锁定，异步导向其它页面不污染草稿。"
  ]
]) {
  const earlier = reviewed.get(file);
  reviewed.set(file, {reviewedSha256, scope, finding: scope, evidence: [...new Set([...(earlier?.evidence || []), 'FLOW-REVIEW.md'])]});
}
for (const [file, reviewedSha256, scope] of [
  [
    "DuoYu-ID/admin/src/components/core/base/art-logo/index.vue",
    "1ad748960160ee2e617a1b57d8ce2713433eb03564fe8927ac6be57da095c99a",
    "组件输入、渲染路径与管理界面调用范围，结合生产类型检查和浏览器页面回归。"
  ],
  [
    "DuoYu-ID/admin/src/components/core/layouts/art-global-component/index.vue",
    "79d03bc1a3ae2e1bb75114417fd0243f15f02eb8d2768d6b2a294081d421c434",
    "组件输入、渲染路径与管理界面调用范围，结合生产类型检查和浏览器页面回归。"
  ],
  [
    "DuoYu-ID/admin/src/components/core/layouts/art-settings-panel/widget/SectionTitle.vue",
    "eecf4c2cafd33e9c7218d2905374ccbbc7d496e57682c63204c8101d51a60ef5",
    "组件输入、渲染路径与管理界面调用范围，结合生产类型检查和浏览器页面回归。"
  ],
  [
    "DuoYu-ID/admin/src/components/core/layouts/art-settings-panel/widget/SettingHeader.vue",
    "298271b440124c6c3653a1a58ee79c28be8787ed22dc1a499e7a986e45003038",
    "顶部操作、原生按钮、同语种可访问名称、关闭按钮和调用点。实际启用的搜索入口完成键盘打开、输入框获焦和 Esc 关闭；关闭的可选模块只做源码及构建验证。"
  ],
  [
    "DuoYu-ID/admin/src/components/core/widget/art-icon-button/index.vue",
    "a98ec67a338e9e983c8f63cadd2f8e3829921ecd2287068c550b8b761028071f",
    "顶部操作、原生按钮、同语种可访问名称、关闭按钮和调用点。实际启用的搜索入口完成键盘打开、输入框获焦和 Esc 关闭；关闭的可选模块只做源码及构建验证。"
  ],
  [
    "DuoYu-ID/admin/src/config/modules/fastEnter.ts",
    "323e1ff855df7b4dd7cc5f1221d7d45db4240e2e7345abd4e17af25e57d8cbe7",
    "快速入口配置默认值与模板消费者；当前产品配置关闭该入口。"
  ],
  [
    "DuoYu-ID/admin/src/enums/formEnum.ts",
    "b72c5b2b9c8b4e2f1e4c57edf3bea7c2c8b52d78926397c41028278ae457e286",
    "共享响应、全局指令或表单枚举的类型及其使用范围，管理前端通过类型检查。"
  ],
  [
    "DuoYu-ID/admin/src/mock/upgrade/changeLog.ts",
    "03d91f72eb8bff1b02b502ae2ab961d8af2b04269162552c8e3c134f9ceceae0",
    "版本日志空列表的类型和用途，无生产数据写入。"
  ],
  [
    "DuoYu-ID/admin/src/plugins/index.ts",
    "7105473305a71152b1f5e02fdcb1e29b034bb23e106095da2bd9505fc4a16f58",
    "统一导出、文件目标存在与类型依赖，现有入口保持兼容。"
  ],
  [
    "DuoYu-ID/admin/src/types/common/response.ts",
    "b56d4d14d0e315b3ffc5d26b8c447284106deed1cc82012b2543209e4c878320",
    "共享响应、全局指令或表单枚举的类型及其使用范围，管理前端通过类型检查。"
  ],
  [
    "DuoYu-ID/admin/src/types/directive/directive.d.ts",
    "e684f91d62a0212be92f6220c8e9f2de5b6a378e50ec79afb21e9290428afbf2",
    "共享响应、全局指令或表单枚举的类型及其使用范围，管理前端通过类型检查。"
  ],
  [
    "DuoYu-ID/admin/src/types/index.ts",
    "3fcdaea9c826ff0234abbce4da9935cc90b674a8a361e7a6266fd6bbc417c4ae",
    "统一导出、文件目标存在与类型依赖，现有入口保持兼容。"
  ],
  [
    "DuoYu-ID/admin/src/utils/constants/index.ts",
    "b3ac86bd03a3bd415bce4d97c7671e3987c0ae4e6d0dfbbcdaee394ce0678848",
    "统一导出、文件目标存在与类型依赖，现有入口保持兼容。"
  ],
  [
    "DuoYu-ID/admin/src/utils/form/index.ts",
    "11a50a1831bfb437680c48aa4850ad2f42ba443d1c6376f3218658aa0990ceb4",
    "统一导出、文件目标存在与类型依赖，现有入口保持兼容。"
  ],
  [
    "DuoYu-ID/admin/src/utils/http/status.ts",
    "b5a30c6fcefd9aac68dcb71c3bfa2a2f7ad85c5d828944f15bc41deed743aa10",
    "HTTP 状态枚举与实际身份和失败响应的区分。"
  ],
  [
    "DuoYu-ID/admin/src/utils/index.ts",
    "3b168c6515d9dd5bb21197c7b04cb6174ad3ca76201b2feb012706bb6ee078d1",
    "统一导出、文件目标存在与类型依赖，现有入口保持兼容。"
  ],
  [
    "DuoYu-ID/admin/src/utils/navigation/index.ts",
    "0b036740544ee7a807676134e63267f35214e7cb81d211a612ee355459912ba2",
    "统一导出、文件目标存在与类型依赖，现有入口保持兼容。"
  ],
  [
    "DuoYu-ID/admin/src/utils/storage/index.ts",
    "a96d3fd44f540a913f26725c108faa9680e9874101fd3a0a4e16d4e04e17d881",
    "统一导出、文件目标存在与类型依赖，现有入口保持兼容。"
  ],
  [
    "DuoYu-ID/admin/src/utils/sys/console.ts",
    "6ec5182009f606232f859bbb9bf6cced00c8550c0504c959000531ba561d7cee",
    "追踪模板控制台输出及静态引用情况，保留兼容文件。"
  ],
  [
    "DuoYu-ID/admin/src/utils/sys/index.ts",
    "4604180c4f2093334f6b991bda7ca8fbc59be4837f7ea00b9dfb6fe8713bdc19",
    "统一导出、文件目标存在与类型依赖，现有入口保持兼容。"
  ],
  [
    "DuoYu-ID/admin/src/utils/ui/iconify-loader.ts",
    "ccdd3c178530574488d07caadcc8f7a632914c436c9664384cc12418eec3e15a",
    "离线图标集合注册与管理前端构建。"
  ],
  [
    "DuoYu-ID/admin/src/utils/ui/index.ts",
    "5790f1a83408776b0bc681506e4b9aacb5cce013cf1b02b029e892ef8d7894f0",
    "统一导出、文件目标存在与类型依赖，现有入口保持兼容。"
  ],
  [
    "DuoYu-ID/admin/src/views/duoyu/access/index.vue",
    "ba90fbdc919ec768cf02d98cfe78b191dd94a7fa0959d2e297fb58a034a34c64",
    "权限说明只读页、返回用户管理入口和真实普通账号/管理员边界。"
  ],
  [
    "DuoYu-ID/admin/src/views/exception/403/index.vue",
    "b0f9372cc0965df6e6a06f489229501a1f258293376299e34db5439d92d2d6c6",
    "错误页编码、翻译键、静态插图及返回首页的组件输入。"
  ],
  [
    "DuoYu-ID/admin/src/views/exception/404/index.vue",
    "2bdd25c9a6285ce841cbbdfd9fd8ea474c8115c6d12b12565f3424c0a5340c5b",
    "错误页编码、翻译键、静态插图及返回首页的组件输入。"
  ],
  [
    "DuoYu-ID/admin/src/views/exception/500/index.vue",
    "b4c70468136284040fb37c5fe61e71292664a7c4c505218079c523f209eac4f1",
    "错误页编码、翻译键、静态插图及返回首页的组件输入。"
  ],
  [
    "DuoYu-ID/admin/src/views/index/index.vue",
    "4f24e5d1ff0efc2739caafba3512d828093147d0ce639db4d4fb4fd3542101b2",
    "布局地标、侧栏、顶部栏与全局组件挂载；实际两种视口的管理页面联调。"
  ],
  [
    "DuoYu-ID/admin/vite.login.config.ts",
    "e080c9243bb3f00e7a18342fd8df3d057314e95a68d18ce00916b4889f569dc1",
    "登录提示脚本 IIFE、生产环境配置、独立 dist/login-ui 目录；生产构建核验。"
  ],
  [
    "DuoYu-ID/admin/src/components/core/layouts/art-header-bar/index.vue",
    "7f2e3e6d830176b7c9e26a75ee8359615fd477142e66615e151be4c15c7950cb",
    "顶部操作、原生按钮、同语种可访问名称、关闭按钮和调用点。实际启用的搜索入口完成键盘打开、输入框获焦和 Esc 关闭；关闭的可选模块只做源码及构建验证。"
  ],
  [
    "DuoYu-ID/admin/src/components/core/forms/art-button-more/index.vue",
    "3d95a01aebf1b3a38c30d6a9799fb081230fafb51528e508137461eec67b317a",
    "顶部操作、原生按钮、同语种可访问名称、关闭按钮和调用点。实际启用的搜索入口完成键盘打开、输入框获焦和 Esc 关闭；关闭的可选模块只做源码及构建验证。"
  ],
  [
    "DuoYu-ID/admin/src/components/core/layouts/art-menus/art-sidebar-menu/index.vue",
    "47f416fe91255070b0e0d236fbac6653cf740e7f9d778ebbe29230572f64c82e",
    "顶部操作、原生按钮、同语种可访问名称、关闭按钮和调用点。实际启用的搜索入口完成键盘打开、输入框获焦和 Esc 关闭；关闭的可选模块只做源码及构建验证。"
  ],
  [
    "DuoYu-ID/admin/src/config/modules/headerBar.ts",
    "359205436f245d8a5fdb0505254a1c9a089a16596aaa451f454d58b0e75455e6",
    "顶部操作、原生按钮、同语种可访问名称、关闭按钮和调用点。实际启用的搜索入口完成键盘打开、输入框获焦和 Esc 关闭；关闭的可选模块只做源码及构建验证。"
  ],
  [
    "DuoYu-ID/admin/src/locales/langs/zh.json",
    "a5fde4eae6fbcf11ae656845fbe6e1c52a8c52aaf2dfab9864626766d6946e3d",
    "顶部操作、原生按钮、同语种可访问名称、关闭按钮和调用点。实际启用的搜索入口完成键盘打开、输入框获焦和 Esc 关闭；关闭的可选模块只做源码及构建验证。"
  ],
  [
    "DuoYu-ID/admin/src/locales/langs/en.json",
    "32401556a526491ff1f60a2c0e004daa0eb31735ddfdeb0a80f76f2930f3722d",
    "顶部操作、原生按钮、同语种可访问名称、关闭按钮和调用点。实际启用的搜索入口完成键盘打开、输入框获焦和 Esc 关闭；关闭的可选模块只做源码及构建验证。"
  ],
  [
    "DuoYu-Extensions/scripts/fixtures/id-pages.mjs",
    "2a50f7b70f2c632610f027fae1f67dfc155ed3c8349942ad0af950fd3d51ec32",
    "账号中心 20 页两种尺寸、角色验证及顶部键盘路径。"
  ]
]) {
  const earlier = reviewed.get(file);
  reviewed.set(file, {reviewedSha256, scope, finding: scope, evidence: [...new Set([...(earlier?.evidence || []), 'FLOW-REVIEW.md'])]});
}
for (const [file, reviewedSha256, scope] of [
  [
    "DuoYu-Extensions/src/features/workspace/collections.ts",
    "d160928b22226f78bc9ea745947e3ab63c5a469ef10c9346b624194623d231f1",
    "空账号首次保存、删除/撤销的事务一致性、修复旧默认空间、隔离集合排序与过期目标；workspace-integrity 和真实 Edge。"
  ],
  [
    "DuoYu-Extensions/src/features/workspace/spaces.ts",
    "846df32c5f75fc219598408c2ca9570f18143e965e58d88f31771c35fe34bf84",
    "空账号首次保存、删除/撤销的事务一致性、修复旧默认空间、隔离集合排序与过期目标；workspace-integrity 和真实 Edge。"
  ],
  [
    "DuoYu-Extensions/src/features/workspace/useWorkspace.ts",
    "850de3b3e118261e4e4c3db3034c18a3d1804121981ddc431269aaccc3d64069",
    "工作区入口与订阅、集合调用、拖动空间上下文、撤销与导航，标记空间和搜索焦点；workspace-crud-current、workspace-collections、home-navigation-ui。"
  ],
  [
    "DuoYu-Extensions/src/features/workspace/WorkspaceBoard.vue",
    "1ee84532b0f0cfde7098cae391d9fabdb260bf20cea8daa277360ec8f990c6c5",
    "工作区入口与订阅、集合调用、拖动空间上下文、撤销与导航，标记空间和搜索焦点；workspace-crud-current、workspace-collections、home-navigation-ui。"
  ],
  [
    "DuoYu-Extensions/src/features/workspace/WorkspaceCardMain.vue",
    "d89e82cf62fc18b624714206d97934e78de4af3fc496f286f012bf0273aa6977",
    "工作区入口与订阅、集合调用、拖动空间上下文、撤销与导航，标记空间和搜索焦点；workspace-crud-current、workspace-collections、home-navigation-ui。"
  ],
  [
    "DuoYu-Extensions/src/features/workspace/WorkspaceOverlay.vue",
    "45d993ed4171c775cef5c2ae91ca1fd88b37550b6baf3de75770f873a5dbe219",
    "工作区入口与订阅、集合调用、拖动空间上下文、撤销与导航，标记空间和搜索焦点；workspace-crud-current、workspace-collections、home-navigation-ui。"
  ],
  [
    "DuoYu-Extensions/src/features/workspace/WorkspaceFavicon.vue",
    "a19c9033a88fd5e1a2c418aaa64229e266ff7ba5356de87ae134483c0aae7072",
    "旧网址的安全解析、图标发现缓存、加载失败与迟到结果、像素染色边界；实际 Edge 注入异常网址并检查文字回退。"
  ],
  [
    "DuoYu-Extensions/src/features/library/auto-icon.ts",
    "ea4f71f186f49bb2068f6e6934d1bb4b19aecb76969152e575bbd8ee8abba9cc",
    "旧网址的安全解析、图标发现缓存、加载失败与迟到结果、像素染色边界；实际 Edge 注入异常网址并检查文字回退。"
  ],
  [
    "DuoYu-Extensions/src/shared/image-tint.ts",
    "86e15f22e6d7c65ac11734973f5dd1fc4f261458992c0b7aacab320c3fbe0985",
    "旧网址的安全解析、图标发现缓存、加载失败与迟到结果、像素染色边界；实际 Edge 注入异常网址并检查文字回退。"
  ],
  [
    "DuoYu-Extensions/src/shared/components/base/ReorderTransition.vue",
    "2dd08232ac3d29dd4855d8c6b47578cf83834c6a1d8242c6a1a345f55cada626",
    "排序动画、系统减少动画偏好、浮层命中、拖动失败与 Escape/失焦/卸载清理；工作区与收藏拖放回归。"
  ],
  [
    "DuoYu-Extensions/src/shared/components/base/IconDragPreview.vue",
    "65b21aff83223795121f459862047469db9c88e3fa72c01724883875f097f482",
    "排序动画、系统减少动画偏好、浮层命中、拖动失败与 Escape/失焦/卸载清理；工作区与收藏拖放回归。"
  ],
  [
    "DuoYu-Extensions/src/shared/useMouseSort.ts",
    "342738ba708e33ac9ae61e607bd60a721236d9970407576e0df9d49b459d916a",
    "排序动画、系统减少动画偏好、浮层命中、拖动失败与 Escape/失焦/卸载清理；工作区与收藏拖放回归。"
  ],
  [
    "DuoYu-Extensions/src/shared/components/base/MenuEditorDialog.vue",
    "ca9d51cc5eb35cdc57a0defcc189d22f365a94af0c720b452d5609bd0edea44f",
    "空间命名、图标标识白名单回退、按钮标签和选中状态；空间菜单与收藏页图标浏览器回归。"
  ],
  [
    "DuoYu-Extensions/src/shared/components/base/PageIconPicker.vue",
    "d8ebe515d4d4ab48bb658518b4d289f1a9d2f1e0b8e065147795be9268988084",
    "空间命名、图标标识白名单回退、按钮标签和选中状态；空间菜单与收藏页图标浏览器回归。"
  ],
  [
    "DuoYu-Extensions/src/shared/components/base/PageIcon.vue",
    "593adaa110fa21236669bebb18dbc2608cac091d23f57fa070a4023b7c87c850",
    "空间命名、图标标识白名单回退、按钮标签和选中状态；空间菜单与收藏页图标浏览器回归。"
  ],
  [
    "DuoYu-Extensions/src/shared/page-icons.ts",
    "698a5dfa6782b61a8c3784ac43891d662cd46793e8b1662e06113280d48b2ccc",
    "空间命名、图标标识白名单回退、按钮标签和选中状态；空间菜单与收藏页图标浏览器回归。"
  ],
  [
    "DuoYu-Extensions/src/shared/icon-text.ts",
    "718670657963d583ea0efd90303827bc9fdd9a3fa2b97ecf36f974c86ae0590d",
    "检查汉字判断、码点截断与 UTF-16 光标偏移、图标颜色回退和减少动画偏好；图标编辑与网格回归。"
  ],
  [
    "DuoYu-Extensions/src/shared/icon-material.ts",
    "3fe1935f65ee5188d69c6cc4a59ada9658e562e3cbe46a62bb75fd265f17aee5",
    "检查汉字判断、码点截断与 UTF-16 光标偏移、图标颜色回退和减少动画偏好；图标编辑与网格回归。"
  ],
  [
    "DuoYu-Extensions/src/shared/components/base/TextIcon.vue",
    "2ce73fa2e995d24293b481e72b6eea0915d67ce206f089a873d10bf96dc58719",
    "检查汉字判断、码点截断与 UTF-16 光标偏移、图标颜色回退和减少动画偏好；图标编辑与网格回归。"
  ],
  [
    "DuoYu-Extensions/src/entrypoints/newtab/main.ts",
    "902826d92c8b2d785f9a47072a14295b5584bc3c31aa6f2407accfab7f967350",
    "启动次序、存储不可用回退、界面与后台认证分离、版本输出；离线启动与账号隔离浏览器测试。"
  ],
  [
    "DuoYu-Extensions/src/features/desktop/glass/preferences.ts",
    "a96c88d6c2e4e03586b8fde9338b8a9790fcedcb275dc420132f923059292f84",
    "启动次序、存储不可用回退、界面与后台认证分离、版本输出；离线启动与账号隔离浏览器测试。"
  ],
  [
    "DuoYu-Extensions/src/shared/console-banner.ts",
    "12b5f7a962013933a3d5a38ba540519584a0da897f679b09c8e37f4e346cb42f",
    "启动次序、存储不可用回退、界面与后台认证分离、版本输出；离线启动与账号隔离浏览器测试。"
  ],
  [
    "DuoYu-Extensions/src/entrypoints/popup/App.vue",
    "4a4636604b232d8b77bcac4c6cdbb3b2d22345ef977fccec65f51597fc86f50b",
    "扩展入口、中文文档语言、视口、版本绑定与静态资源；新标签页与弹窗由打包产物加载。"
  ],
  [
    "DuoYu-Extensions/src/entrypoints/popup/main.ts",
    "5d2f4c0f5d289c2624f3569aea0b5a48e48cb0d22ef5f57a5ba47d64a0ec7969",
    "扩展入口、中文文档语言、视口、版本绑定与静态资源；新标签页与弹窗由打包产物加载。"
  ],
  [
    "DuoYu-Extensions/src/entrypoints/popup/index.html",
    "8f0774fb86538f72c5cb224f19951dc067d5d6e36f55c09e3f71b303d60207a2",
    "扩展入口、中文文档语言、视口、版本绑定与静态资源；新标签页与弹窗由打包产物加载。"
  ],
  [
    "DuoYu-Extensions/src/entrypoints/popup/style.css",
    "03cdea3de9a11a11a04cf9f075bee8a544a1ea476dbf30e5968b2d9c9d66c6b8",
    "扩展入口、中文文档语言、视口、版本绑定与静态资源；新标签页与弹窗由打包产物加载。"
  ],
  [
    "DuoYu-Extensions/src/entrypoints/newtab/index.html",
    "3a82ee7b15b59565e4a92ad634e515c93480f087a892541119295db0c1819153",
    "扩展入口、中文文档语言、视口、版本绑定与静态资源；新标签页与弹窗由打包产物加载。"
  ],
  [
    "DuoYu-Extensions/src/features/clock/ClockWidget.vue",
    "60d13c498bb95d2a970d5ed49d4cb7ece6427462a657b3f9b14865e9602ce448",
    "本地日期及农历依赖、秒定时器释放、纯文本输出；新标签页实际加载。"
  ],
  [
    "DuoYu-Extensions/scripts/workspace-integrity.mjs",
    "db4b29f93d7be0b522a16d5b0be3f5072edb461d1b7707cb1f352b22bfe12ee1",
    "8 项 IndexedDB/Dexie 测试、历史数据真实浏览器恢复、首页焦点、重复运行和全套结果；临时浏览器与日常配置分开。"
  ],
  [
    "DuoYu-Extensions/scripts/workspace-crud-current.mjs",
    "96387e370be329de789fa91d29b03ffc01bec8e3fedfed815d50f3255b330cb9",
    "8 项 IndexedDB/Dexie 测试、历史数据真实浏览器恢复、首页焦点、重复运行和全套结果；临时浏览器与日常配置分开。"
  ],
  [
    "DuoYu-Extensions/scripts/startup-account-isolation-ui.mjs",
    "0de5f63d426db1055252b3006859df20cbf6d91a9aeeee50b026f6ee2b81bc7a",
    "8 项 IndexedDB/Dexie 测试、历史数据真实浏览器恢复、首页焦点、重复运行和全套结果；临时浏览器与日常配置分开。"
  ],
  [
    "DuoYu-Extensions/scripts/review-regression.mjs",
    "d82a48351c2e8bd5ce3da65917dac6ea8a11bca4deb34006d9cc4ffac7d74914",
    "8 项 IndexedDB/Dexie 测试、历史数据真实浏览器恢复、首页焦点、重复运行和全套结果；临时浏览器与日常配置分开。"
  ],
  [
    "DuoYu-Extensions/scripts/auth-isolated.mjs",
    "27e12ae6444c4af6563c6eacc0d12061c5163522c19497a5176cac17b3825627",
    "本地测试库限制、临时 schema、真实登录、账号切换重载后的存储断言竞态；改用扩展 worker 读取凭证，回归后清理 schema。"
  ],
  [
    "DuoYu-ID/admin/src/hooks/core/useAuth.ts",
    "9b4ec9ba0c86b5858bf9549aca4141fc02e74c22d2ef3ae9ac68891fc374e0b2",
    "角色数据替换、路由权限替换、模式选择和按钮菜单可见性；真实 Vue 和 Pinia 的同组件撤权、切换与恢复。模板系统角色页不在当前生产路由中。"
  ],
  [
    "DuoYu-ID/admin/src/hooks/core/useAppMode.ts",
    "46ec654a13dbabfb4e46ea38f814d2581d402202dfdd8ce6df9bec7ff119be6d",
    "角色数据替换、路由权限替换、模式选择和按钮菜单可见性；真实 Vue 和 Pinia 的同组件撤权、切换与恢复。模板系统角色页不在当前生产路由中。"
  ],
  [
    "DuoYu-ID/admin/src/components/core/forms/art-button-more/index.vue",
    "3d95a01aebf1b3a38c30d6a9799fb081230fafb51528e508137461eec67b317a",
    "角色数据替换、路由权限替换、模式选择和按钮菜单可见性；真实 Vue 和 Pinia 的同组件撤权、切换与恢复。模板系统角色页不在当前生产路由中。"
  ],
  [
    "DuoYu-ID/admin/src/router/core/ComponentLoader.ts",
    "df3e44ad4b55e09eefad20f2b8cc861cf74fcf084086773ac3adbbba05e9bc98",
    "核对模板系统角色页与生产动态加载白名单的界限，核对最终构建与已部署资产摘要。"
  ],
  [
    "DuoYu-ID/admin/src/router/modules/system.ts",
    "7d3a5461f658d5a9bf77b74e5e3839333f374cbddff51331d5bf190a9e4fcb5b",
    "核对模板系统角色页与生产动态加载白名单的界限，核对最终构建与已部署资产摘要。"
  ],
  [
    "DuoYu-ID/admin/src/directives/core/auth.ts",
    "7383656f11813949a27f9d48a762ea8c33a5c087255a76e266528ad97b62d650",
    "检查全局注册、当前权限标识匹配及移除 DOM 的行为，追踪实际模板引用；界面指令本身不承担服务端授权。"
  ],
  [
    "DuoYu-ID/admin/src/directives/core/roles.ts",
    "751c705ad3810d4fb076e96df580daf6b784fae2d774e874ec16b0652cf64be7",
    "检查全局注册、当前权限标识匹配及移除 DOM 的行为，追踪实际模板引用；界面指令本身不承担服务端授权。"
  ],
  [
    "DuoYu-ID/admin/src/directives/index.ts",
    "1c4e72184018100dcf881c4f0f812e8481b061c5b7d42169f27ecc5629c5f618",
    "检查全局注册、当前权限标识匹配及移除 DOM 的行为，追踪实际模板引用；界面指令本身不承担服务端授权。"
  ],
  [
    "DuoYu-ID/admin/src/directives/manual-entry.ts",
    "108f332fde2194a6cc6f783eb091f782834381e45e101c147a26e62c01b5d2ff",
    "个人安全表单焦点/粘贴/监听器释放，独立登录消息的文本输出；管理与正式登录入口核验。"
  ],
  [
    "DuoYu-ID/admin/src/login-message.ts",
    "4ac031c6c6606b5aba5af9899da855deb201300fe59b513e414d806bec30a3af",
    "个人安全表单焦点/粘贴/监听器释放，独立登录消息的文本输出；管理与正式登录入口核验。"
  ],
  [
    "DuoYu-ID/admin/tests/button-auth.mjs",
    "75b2c248086f5c8eec50afaf359fe018e9bde7f12ba0f03a345f3b2f174ed8ab",
    "临时 Pinia 权限、可响应路由元数据与两种权限模式的撤销/恢复，接入现有依赖验证。"
  ],
  [
    "DuoYu-ID/admin/tests/dependency-compat.mjs",
    "c85cbe633332ef32081e8968ad4f81488fe1ddbed5d71e9d04d40b9d80020b08",
    "临时 Pinia 权限、可响应路由元数据与两种权限模式的撤销/恢复，接入现有依赖验证。"
  ],
  [
    "DuoYu-Extensions/scripts/dock-links.mjs",
    "8a399cca5bf7c166887be550578bfd3bcbf67b9fc063f19b9cf9b40049b49262",
    "桌面链接拖入 Dock、移回网格、刷新保留，修复悬停动画中单次取样的测试误报；移出鼠标后仍精确断言 30×30。"
  ],
  [
    "DuoYu-Extensions/scripts/fixtures/id-crud.mjs",
    "dc0a951cf263bf6294ecdec08d52090764f3e22c30274658da0d5ef1f08d90c5",
    "验收角色创建、分配、编辑和删除；既验证数据库，也等待页面成功导航，避免下一操作撞上上一操作的迟到跳转。"
  ]
]) {
  const earlier = reviewed.get(file);
  reviewed.set(file, {reviewedSha256, scope, finding: scope, evidence: [...new Set([...(earlier?.evidence || []), 'WORKSPACE-INTEGRITY.md'])]});
}
for (const [file, reviewedSha256, scope] of [
  [
    "DuoYu-Extensions/src/env.d.ts",
    "b04b762e0b6a6525a2dbb836775c129f8801291fa8e5e97d72ac0dbb8d3581b7",
    "类型、配置及调用方依赖；结合实际类型检查、模板编译和构建输出。 追踪点：ImportMetaEnv。扩展源码。"
  ],
  [
    "DuoYu-Extensions/src/features/desktop/DesktopDock.vue",
    "1a4b8713a25f760da731e528611755ac6c565aad530d7eca362e77df08a15d5c",
    "桌面入口、账号存储来源、订阅释放及外部导航；隔离浏览器覆盖账号切换、Dock 操作。 追踪点：readOrder, cloudOrder, children, openFolderLink, isActive, activate。扩展源码。"
  ],
  [
    "DuoYu-Extensions/src/features/desktop/DesktopGrid.vue",
    "eaeeb3592b6aadef56faabf42091108d5005d8be42cc55015c32592c8b21fcc9",
    "扩展挂载、事件和状态流，检查输入/拖放/资源生命周期，关联桌面、拖拽、快捷方式和图标回归。 追踪点：vue, gridstack, gridstack/dist/gridstack.min.css。扩展源码。"
  ],
  [
    "DuoYu-Extensions/src/features/desktop/DesktopTools.vue",
    "2c9ec4b64480fd3afe456cd076561f605c9b40978d6f48370fe874b88ae73e43",
    "桌面入口、账号存储来源、订阅释放及外部导航；隔离浏览器覆盖账号切换、Dock 操作。 追踪点：run, upload, daily, open。扩展源码。"
  ],
  [
    "DuoYu-Extensions/src/features/desktop/GlassModeSwitch.vue",
    "aa5c233a3a50a8aac7353bab7d5486f1c5da86cd10a018c14e719af399db33f9",
    "桌面入口、账号存储来源、订阅释放及外部导航；隔离浏览器覆盖账号切换、Dock 操作。 追踪点：applyMode, guestChanged, setGlassMode。扩展源码。"
  ],
  [
    "DuoYu-Extensions/src/features/desktop/components/LiquidGlassLayer.vue",
    "6f2ea7655527de47e8d6490f387fd5d84c7e299432b912e19e5e46e0ec0ff2b3",
    "扩展挂载、事件和状态流，检查输入/拖放/资源生命周期，关联桌面、拖拽、快捷方式和图标回归。 追踪点：draw, schedule, pageChanged, changed, pointer, visibility。扩展源码。"
  ],
  [
    "DuoYu-Extensions/src/features/desktop/components/WidgetLinks.vue",
    "dc1db6c9157a3ad6aa2aa13b4667b9c7ad360ee4b13b25465f68525151aaa2c9",
    "扩展挂载、事件和状态流，检查输入/拖放/资源生命周期，关联桌面、拖拽、快捷方式和图标回归。 追踪点：vue, ../../../shared/components/base/IconTile.vue, ../../../shared/components/base/ReorderTransition.vue, ../widget-links。扩展源码。"
  ],
  [
    "DuoYu-Extensions/src/features/desktop/glass/renderer.ts",
    "31d0735622adaaa7e15b2c0e3bdaf827ab0dd26bd4ca482a1ca478f1c85c1f53",
    "扩展挂载、事件和状态流，检查输入/拖放/资源生命周期，关联桌面、拖拽、快捷方式和图标回归。 追踪点：createGlassRenderer, shader, setImage, render, destroy。扩展源码。"
  ],
  [
    "DuoYu-Extensions/src/features/desktop/useIconHighlight.ts",
    "a448bce223b441be1acb13237b43aa9a11099c57f0e127bae847e7f7584c34be",
    "扩展挂载、事件和状态流，检查输入/拖放/资源生命周期，关联桌面、拖拽、快捷方式和图标回归。 追踪点：useIconHighlight, tiltTarget, clear, move, ease。扩展源码。"
  ],
  [
    "DuoYu-Extensions/src/features/desktop/useWidgetLinks.ts",
    "af96ce165524208b9d1d7ae91755cbc4ae532d1dfde494a4be003476b6321827",
    "扩展挂载、事件和状态流，检查输入/拖放/资源生命周期，关联桌面、拖拽、快捷方式和图标回归。 追踪点：useWidgetLinks。扩展源码。"
  ],
  [
    "DuoYu-Extensions/src/features/shortcuts/components/AddShortcutDialog.vue",
    "6cfc90ec62cf25a04484bd064ec56880c198cf86df2c488f8fe687613019d416",
    "扩展挂载、事件和状态流，检查输入/拖放/资源生命周期，关联桌面、拖拽、快捷方式和图标回归。 追踪点：submit。扩展源码。"
  ],
  [
    "DuoYu-Extensions/src/shared/BoundedWidgetEngine.ts",
    "5852910b61ef17b5835ac45a36bd75f54410f6cea962a3843bafaf65f342d3ac",
    "扩展挂载、事件和状态流，检查输入/拖放/资源生命周期，关联桌面、拖拽、快捷方式和图标回归。 追踪点：position, overlaps, beginDrag, setMergeHover, endDrag, moveSelection。扩展源码。"
  ],
  [
    "DuoYu-Extensions/src/shared/components/base/DesktopMenu.vue",
    "02b98df822937826f4ac6a0698861a91762f7bb8ea92cb3c7b6b2fefe245af3b",
    "扩展挂载、事件和状态流，检查输入/拖放/资源生命周期，关联桌面、拖拽、快捷方式和图标回归。 追踪点：blur, start, over, end, drop。扩展源码。"
  ],
  [
    "DuoYu-Extensions/src/shared/components/base/IconTile.vue",
    "afd985ebf5fb15043e89fb832f365636d262fab6017c8824bb610f8019634538",
    "扩展挂载、事件和状态流，检查输入/拖放/资源生命周期，关联桌面、拖拽、快捷方式和图标回归。 追踪点：vue。扩展源码。"
  ],
  [
    "DuoYu-Extensions/src/shared/drag-landing.ts",
    "f919af2b198a6eb59d3527478ff72b7c069a005e5a2666db19307b194f4849ea",
    "扩展挂载、事件和状态流，检查输入/拖放/资源生命周期，关联桌面、拖拽、快捷方式和图标回归。 追踪点：createDragLanding, dispose, capture, track, commit, setTarget。扩展源码。"
  ],
  [
    "DuoYu-Extensions/src/shared/glass-material.ts",
    "eb679e7f3eef6c6a076e378fa0b7b899f578249b5cfa5937c62b42d675fd07ee",
    "扩展挂载、事件和状态流，检查输入/拖放/资源生命周期，关联桌面、拖拽、快捷方式和图标回归。 追踪点：readGlassMaterial, number, stop。扩展源码。"
  ],
  [
    "DuoYu-Extensions/src/shared/useIconGrid.ts",
    "19cf90aafe268160babef51465e3cb7ee6d91847c7025c7a3266ae452549bb7c",
    "扩展挂载、事件和状态流，检查输入/拖放/资源生命周期，关联桌面、拖拽、快捷方式和图标回归。 追踪点：useIconGrid, message, save, startLinkDrag, move, cancel。扩展源码。"
  ],
  [
    "DuoYu-ID/admin/eslint.config.mjs",
    "ac8dbb25a4d57ad117cd09ca00180eec3b526bf53b376bd263505ad5e4bfb13a",
    "类型、配置及调用方依赖；结合实际类型检查、模板编译和构建输出。 追踪点：fs, path, url, @eslint/js。当前管理端 JS 产物无此模块的运行时代码。"
  ],
  [
    "DuoYu-ID/admin/src/App.vue",
    "aebf1d22d770ef6214fec9ac4b1b38f6fbc8ffe44fa4b767a881ea3471690f15",
    "追踪该文件的输入、主要操作、返回值或渲染绑定，以及直接副作用和生产构建边界。 追踪点：ElConfigProvider, RouterView。管理端产物包含此模块。"
  ],
  [
    "DuoYu-ID/admin/src/assets/svg/loading.ts",
    "254473e0acc858e9304453648dc9826c385a2a59a9a495800aad0122f7baccaa",
    "内容来源、DOM 写入、图片及动画生命周期，区分内置配置与用户输入。 追踪点：loading.ts。管理端产物包含此模块。"
  ],
  [
    "DuoYu-ID/admin/src/components/core/banners/art-basic-banner/index.vue",
    "117cc7ef4a57e717de43749477e7455650ffb06bd7451585e4acb2e75d5288ed",
    "追踪该文件的输入、主要操作、返回值或渲染绑定，以及直接副作用和生产构建边界。 追踪点：generateMeteors。当前管理端 JS 产物无此模块的运行时代码。"
  ],
  [
    "DuoYu-ID/admin/src/components/core/base/art-back-to-top/index.vue",
    "0c6afd478f968257cda86327cc0f0f333da9755972449d7bc6e5bcf406a0be11",
    "追踪该文件的输入、主要操作、返回值或渲染绑定，以及直接副作用和生产构建边界。 追踪点：ArtSvgIcon, Transition。当前管理端 JS 产物无此模块的运行时代码。"
  ],
  [
    "DuoYu-ID/admin/src/components/core/base/art-svg-icon/index.vue",
    "df5ab26c5e477bfec24db23b5e48e74c9c83abc7c150b4e19b3d9e66043ee6c4",
    "追踪该文件的输入、主要操作、返回值或渲染绑定，以及直接副作用和生产构建边界。 追踪点：Icon。管理端产物包含此模块。"
  ],
  [
    "DuoYu-ID/admin/src/components/core/cards/art-bar-chart-card/index.vue",
    "c99542d9caaaca5d3b6ec896fb4c1c7a56016190c6b3c5a768021ab8a52f7154",
    "对照图表或卡片实际输入、数据映射、渲染及定时器入口，核查构建是否引用。 追踪点：EChartsOption, Props。当前管理端 JS 产物无此模块的运行时代码。"
  ],
  [
    "DuoYu-ID/admin/src/components/core/cards/art-data-list-card/index.vue",
    "27534328f350efacd2fba0b3f894be9ee2169f262156f44b7c08e0ea8bedc544",
    "对照图表或卡片实际输入、数据映射、渲染及定时器入口，核查构建是否引用。 追踪点：handleMore。当前管理端 JS 产物无此模块的运行时代码。"
  ],
  [
    "DuoYu-ID/admin/src/components/core/cards/art-donut-chart-card/index.vue",
    "dbf694e44f2b32143454764eb07640b406da7ef29638fd4929ee3ddc4f610132",
    "对照图表或卡片实际输入、数据映射、渲染及定时器入口，核查构建是否引用。 追踪点：formatNumber。当前管理端 JS 产物无此模块的运行时代码。"
  ],
  [
    "DuoYu-ID/admin/src/components/core/cards/art-image-card/index.vue",
    "8399f0f1f563e64b4159be1133fd91424a2acd1e65993529a868f3b31388899b",
    "对照图表或卡片实际输入、数据映射、渲染及定时器入口，核查构建是否引用。 追踪点：handleClick。当前管理端 JS 产物无此模块的运行时代码。"
  ],
  [
    "DuoYu-ID/admin/src/components/core/cards/art-line-chart-card/index.vue",
    "fa9502013ef8db9ad8cd9b1321085ef32a525cb0b68e4588eaeb5c988218c1b7",
    "对照图表或卡片实际输入、数据映射、渲染及定时器入口，核查构建是否引用。 追踪点：EChartsOption, Props。当前管理端 JS 产物无此模块的运行时代码。"
  ],
  [
    "DuoYu-ID/admin/src/components/core/cards/art-progress-card/index.vue",
    "193493258ca6aba4b3f971a180e6726d2733b62b1be74f2de9aae103fbd4b928",
    "对照图表或卡片实际输入、数据映射、渲染及定时器入口，核查构建是否引用。 追踪点：animateProgress, animate。当前管理端 JS 产物无此模块的运行时代码。"
  ],
  [
    "DuoYu-ID/admin/src/components/core/cards/art-stats-card/index.vue",
    "a3766b6d381672761acb7d0b1afe912b1a1886f060153ae5e088f0e1dfb6dd3c",
    "对照图表或卡片实际输入、数据映射、渲染及定时器入口，核查构建是否引用。 追踪点：ArtCountTo, ArtSvgIcon。当前管理端 JS 产物无此模块的运行时代码。"
  ],
  [
    "DuoYu-ID/admin/src/components/core/cards/art-timeline-list-card/index.vue",
    "c960a50442b7985b39a4af87a46f5271f41f70094414ec06bb37254d74e26a16",
    "对照图表或卡片实际输入、数据映射、渲染及定时器入口，核查构建是否引用。 追踪点：ElScrollbar, ElTimeline, ElTimelineItem。当前管理端 JS 产物无此模块的运行时代码。"
  ],
  [
    "DuoYu-ID/admin/src/components/core/charts/art-bar-chart/index.vue",
    "236c25e9e6d0e47ef45fe478e3dce114b7cc00d2198fe2d0a1f536b01adfeb4c",
    "对照图表或卡片实际输入、数据映射、渲染及定时器入口，核查构建是否引用。 追踪点：getColor, createGradientColor, getBaseItemStyle, createSeriesItem。当前管理端 JS 产物无此模块的运行时代码。"
  ],
  [
    "DuoYu-ID/admin/src/components/core/charts/art-dual-bar-compare-chart/index.vue",
    "d219471950817183d053f7fc466bf8554ff85549772db986f14ef05dd0ca3a13",
    "对照图表或卡片实际输入、数据映射、渲染及定时器入口，核查构建是否引用。 追踪点：createSeriesConfig。当前管理端 JS 产物无此模块的运行时代码。"
  ],
  [
    "DuoYu-ID/admin/src/components/core/charts/art-h-bar-chart/index.vue",
    "94abae0d3442d7b2cc601717f9367d7f273c4aa5bf9605050ccdcecee24353be",
    "对照图表或卡片实际输入、数据映射、渲染及定时器入口，核查构建是否引用。 追踪点：getColor, createGradientColor, getBaseItemStyle, createSeriesItem。当前管理端 JS 产物无此模块的运行时代码。"
  ],
  [
    "DuoYu-ID/admin/src/components/core/charts/art-k-line-chart/index.vue",
    "16d088c5fa91765280c10700e379772cefeb664d3da9fae968d003d901555208",
    "对照图表或卡片实际输入、数据映射、渲染及定时器入口，核查构建是否引用。 追踪点：getActualColors。当前管理端 JS 产物无此模块的运行时代码。"
  ],
  [
    "DuoYu-ID/admin/src/components/core/charts/art-line-chart/index.vue",
    "5a7fe7155b5c1285618722ef1df3841c4956abf9bf32622f2e1b54601436312f",
    "对照图表或卡片实际输入、数据映射、渲染及定时器入口，核查构建是否引用。 追踪点：clearAnimationTimers, initAnimationData, copyRealData, getColor, generateAreaStyle, generateSingleAreaStyle。当前管理端 JS 产物无此模块的运行时代码。"
  ],
  [
    "DuoYu-ID/admin/src/components/core/charts/art-radar-chart/index.vue",
    "e12246be38c248b6850636b38761d044a73ff9d646af1e58e377dec6bb0385cd",
    "对照图表或卡片实际输入、数据映射、渲染及定时器入口，核查构建是否引用。 追踪点：@/plugins/echarts, @/hooks/core/useChart, @/types/component/chart。当前管理端 JS 产物无此模块的运行时代码。"
  ],
  [
    "DuoYu-ID/admin/src/components/core/charts/art-ring-chart/index.vue",
    "4d9a5348ca5012f3ac7e99b452c4d398d946ba0741f5de240868b744f37539f5",
    "对照图表或卡片实际输入、数据映射、渲染及定时器入口，核查构建是否引用。 追踪点：getCenterPosition。当前管理端 JS 产物无此模块的运行时代码。"
  ],
  [
    "DuoYu-ID/admin/src/components/core/charts/art-scatter-chart/index.vue",
    "08323bed40d36cd3667643df261cd6a96da3605c0b68f7fe3a5dfc7b2eb9e2a7",
    "对照图表或卡片实际输入、数据映射、渲染及定时器入口，核查构建是否引用。 追踪点：@/plugins/echarts, @/utils/ui, @/hooks/core/useChart, @/types/component/chart。当前管理端 JS 产物无此模块的运行时代码。"
  ],
  [
    "DuoYu-ID/admin/src/components/core/forms/art-button-table/index.vue",
    "f32e6860065feec3ac445e488453c05bbbc291248f722d562fc598cdab890171",
    "字段输入到模型、提交/重置、筛选和分页边界；已对字段原型、空数据、并发、缓存容量和防抖作定向复测。 追踪点：handleClick。当前管理端 JS 产物无此模块的运行时代码。"
  ],
  [
    "DuoYu-ID/admin/src/components/core/forms/art-drag-verify/index.vue",
    "b17f58bae7b2609c3cedcd7aa47f6558d05d06728688547f9885a1cf01463329",
    "字段输入到模型、提交/重置、筛选和分页边界；已对字段原型、空数据、并发、缓存容量和防抖作定向复测。 追踪点：onTouchStart, onTouchMove, getNumericWidth, getStyleWidth, dragStart, dragMoving。当前管理端 JS 产物无此模块的运行时代码。"
  ],
  [
    "DuoYu-ID/admin/src/components/core/forms/art-form/index.vue",
    "d2d888aa405ee1fc52454789221e3b7633cab5dedbd80b412f5634aa68d54f57",
    "字段输入到模型、提交/重置、筛选和分页边界；已对字段原型、空数据、并发、缓存容量和防抖作定向复测。 追踪点：cloneModelValue, deepClone, parsePath, getFieldValue, deleteFieldValue, setFieldValue。当前管理端 JS 产物无此模块的运行时代码。"
  ],
  [
    "DuoYu-ID/admin/src/components/core/forms/art-search-bar/index.vue",
    "7bad472e062c578cd98b7a3df59d2d772348f6f9283c7e152ca7bd22e25bb008",
    "字段输入到模型、提交/重置、筛选和分页边界；已对字段原型、空数据、并发、缓存容量和防抖作定向复测。 追踪点：cloneModelValue, deepClone, getProps, getSlots, getColSpan, normalizeFieldValue。当前管理端 JS 产物无此模块的运行时代码。"
  ],
  [
    "DuoYu-ID/admin/src/components/core/forms/art-wang-editor/index.vue",
    "c519b56ca8f1702e3b2c5bae1cb9bfbfa32c8699dc8b3315d3dd798cbb8938cb",
    "字段输入到模型、提交/重置、筛选和分页边界；已对字段原型、空数据、并发、缓存容量和防抖作定向复测。 追踪点：onSuccess, onError, onCreateEditor, applyCustomIcons, tryApplyIcons。当前管理端 JS 产物无此模块的运行时代码。"
  ],
  [
    "DuoYu-ID/admin/src/components/core/layouts/art-breadcrumb/index.vue",
    "6eb39dfddfa93018ffa4dd1876c4b6bff79a20015f070bf08f90ea8370c19e03",
    "动态菜单、隐藏子项、外链和内嵌路径；追踪导航目标到共享跳转函数和生产入口。 追踪点：isWrapperContainer, createBreadcrumbItem, isHomeRoute, isLastItem, isClickable, findFirstValidChild。管理端产物包含此模块。"
  ],
  [
    "DuoYu-ID/admin/src/components/core/layouts/art-chat-window/index.vue",
    "42b4ae20580a7a70ec160882ba2e8585625e26fc82a2d6f4ed7637a1f6525307",
    "追踪该文件的输入、主要操作、返回值或渲染绑定，以及直接副作用和生产构建边界。 追踪点：initializeMessages, formatCurrentTime, scrollToBottom, sendMessage, openChat, closeChat。管理端产物包含此模块。"
  ],
  [
    "DuoYu-ID/admin/src/components/core/layouts/art-fast-enter/index.vue",
    "4ba7ae1c6262430593918a8e6fe769194abb30a943cd8551f3f4bfa70c9fdc8b",
    "动态菜单、隐藏子项、外链和内嵌路径；追踪导航目标到共享跳转函数和生产入口。 追踪点：handleNavigate, handleApplicationClick, handleQuickLinkClick。管理端产物包含此模块。"
  ],
  [
    "DuoYu-ID/admin/src/components/core/layouts/art-fireworks-effect/index.vue",
    "e64b565b8e212fba699f3df795c66ae7cbb684bc9dfbaf26d44aaea5c8094ddc",
    "内容来源、DOM 写入、图片及动画生命周期，区分内置配置与用户输入。 追踪点：initializePool, createParticle, getAvailableParticle, preloadImage, preloadAllImages, createFirework。管理端产物包含此模块。"
  ],
  [
    "DuoYu-ID/admin/src/components/core/layouts/art-global-search/index.vue",
    "be41b4f9b614ffc7910d67b6d6246a6bfd74f42d50a856b417e3eed7e252d37a",
    "动态菜单、隐藏子项、外链和内嵌路径；追踪导航目标到共享跳转函数和生产入口。 追踪点：handleKeydown, focusInput, search, flattenAndFilterMenuItems, flattenAndMatch, highlightPrevious。管理端产物包含此模块。"
  ],
  [
    "DuoYu-ID/admin/src/components/core/layouts/art-header-bar/widget/ArtUserMenu.vue",
    "88b1563a9d6ef47ce4712bd1bf03621ca93d972fbb14a1f57e53ee2cfa52d32d",
    "凭证选择、状态读取、重复提交、卸载、退出和历史持久化边界；凭证操作和退出有专门回归。 追踪点：command。管理端产物包含此模块。"
  ],
  [
    "DuoYu-ID/admin/src/components/core/layouts/art-menus/art-horizontal-menu/index.vue",
    "988cbc741a4522251f5b4f9b519997cfca445d7689be5161eba213b6022539de",
    "动态菜单、隐藏子项、外链和内嵌路径；追踪导航目标到共享跳转函数和生产入口。 追踪点：filterMenuItems。管理端产物包含此模块。"
  ],
  [
    "DuoYu-ID/admin/src/components/core/layouts/art-menus/art-horizontal-menu/widget/HorizontalSubmenu.vue",
    "d107e7cc33dd3b5ba2aa09e9457d844bc5d4986f0b252c8fa246507ed9c65725",
    "动态菜单、隐藏子项、外链和内嵌路径；追踪导航目标到共享跳转函数和生产入口。 追踪点：goPage, closeMenu。管理端产物包含此模块。"
  ],
  [
    "DuoYu-ID/admin/src/components/core/layouts/art-menus/art-mixed-menu/index.vue",
    "a26dd4a437b6e7000859a4724a1be5a7426a714701d3acbecf862e605ff73404",
    "动态菜单、隐藏子项、外链和内嵌路径；追踪导航目标到共享跳转函数和生产入口。 追踪点：isMenuItemActive, handleScrollCore, scroll, handleWheel, initScrollState。管理端产物包含此模块。"
  ],
  [
    "DuoYu-ID/admin/src/components/core/layouts/art-menus/art-sidebar-menu/widget/SidebarSubmenu.vue",
    "a430b929937488f36e9d1afc7ad0979bcc7aaa9cdea4fb4c76f3aeb5e691f7f9",
    "动态菜单、隐藏子项、外链和内嵌路径；追踪导航目标到共享跳转函数和生产入口。 追踪点：goPage, closeMenu, isNavigableRoute, filterRoutes, hasChildren, isExternalLink。管理端产物包含此模块。"
  ],
  [
    "DuoYu-ID/admin/src/components/core/layouts/art-notification/index.vue",
    "6ac7835e7a237cc1f4697501185efb7c49989c3677c75a11c2e859c7c3b41ee7",
    "追踪该文件的输入、主要操作、返回值或渲染绑定，以及直接副作用和生产构建边界。 追踪点：useNotificationData, useNotificationStyles, getNoticeStyle, useNotificationAnimation, showNotice, useTabManagement。管理端产物包含此模块。"
  ],
  [
    "DuoYu-ID/admin/src/components/core/layouts/art-page-content/index.vue",
    "cad63ba5af646fd0449a1e5eebeb5afd07e312ccd8d867c67ed53629f00260f8",
    "追踪该文件的输入、主要操作、返回值或渲染绑定，以及直接副作用和生产构建边界。 追踪点：reload。管理端产物包含此模块。"
  ],
  [
    "DuoYu-ID/admin/src/components/core/layouts/art-settings-panel/composables/useSettingsConfig.ts",
    "ee10a50a880e5eef178ba2a612a127b3b323737192ffefce014481d3184d8ae6",
    "配置输入、显示与持久化边界、响应式更新；按文件追踪设置项、消费组件及监听。 追踪点：useSettingsConfig。管理端产物包含此模块。"
  ],
  [
    "DuoYu-ID/admin/src/components/core/layouts/art-settings-panel/composables/useSettingsHandlers.ts",
    "30f2999afa98e4a78b73bbcd72308e3e59343aa6b5e16c1c4d9162fccb38822d",
    "配置输入、显示与持久化边界、响应式更新；按文件追踪设置项、消费组件及监听。 追踪点：useSettingsHandlers, createToggleHandler, createValueHandler。管理端产物包含此模块。"
  ],
  [
    "DuoYu-ID/admin/src/components/core/layouts/art-settings-panel/composables/useSettingsPanel.ts",
    "2a8d0156315c253c275859b1bf7ebca249e28d475b5888aff0aaa5a0ad835b55",
    "配置输入、显示与持久化边界、响应式更新；按文件追踪设置项、消费组件及监听。 追踪点：useSettingsPanel, getStoredDesktopMenuType, setStoredDesktopMenuType, clearStoredDesktopMenuType, useThemeHandlers, initSystemColor。管理端产物包含此模块。"
  ],
  [
    "DuoYu-ID/admin/src/components/core/layouts/art-settings-panel/composables/useSettingsState.ts",
    "cb3589f790cdd186d9bd24d28d37568d2c62cde32cab0b0dc15a45daa5de5d9e",
    "配置输入、显示与持久化边界、响应式更新；按文件追踪设置项、消费组件及监听。 追踪点：useSettingsState, initColorWeak, switchMenuLayouts。管理端产物包含此模块。"
  ],
  [
    "DuoYu-ID/admin/src/components/core/layouts/art-settings-panel/index.vue",
    "720d7f8f20b3563265be9b38aaa85693c3155625406d256425b7621cf9dd3749",
    "配置输入、显示与持久化边界、响应式更新；按文件追踪设置项、消费组件及监听。 追踪点：BasicSettings, BoxStyleSettings, ColorSettings, ContainerSettings, MenuLayoutSettings。管理端产物包含此模块。"
  ],
  [
    "DuoYu-ID/admin/src/components/core/layouts/art-settings-panel/widget/BasicSettings.vue",
    "b86fc6339159a0af0c73b11df10e99d34fa450eda4230f90becbbb91922de481",
    "配置输入、显示与持久化边界、响应式更新；按文件追踪设置项、消费组件及监听。 追踪点：getSettingValue, handleSettingChange。管理端产物包含此模块。"
  ],
  [
    "DuoYu-ID/admin/src/components/core/layouts/art-settings-panel/widget/BoxStyleSettings.vue",
    "addf50d48c876e44f451786b4129072dffece44be12929e5c83b0196f4821e37",
    "配置输入、显示与持久化边界、响应式更新；按文件追踪设置项、消费组件及监听。 追踪点：isActive。管理端产物包含此模块。"
  ],
  [
    "DuoYu-ID/admin/src/components/core/layouts/art-settings-panel/widget/ColorSettings.vue",
    "f2350f6f932da91b89804b2f9fb63fff96023e5119f77e16e4845b9bfd7c59f7",
    "配置输入、显示与持久化边界、响应式更新；按文件追踪设置项、消费组件及监听。 追踪点：ArtSvgIcon, SectionTitle。管理端产物包含此模块。"
  ],
  [
    "DuoYu-ID/admin/src/components/core/layouts/art-settings-panel/widget/ContainerSettings.vue",
    "7ecc040889c12ff853a2320788c6de913137ab0b09eb0f0606c5e93dea3e797d",
    "配置输入、显示与持久化边界、响应式更新；按文件追踪设置项、消费组件及监听。 追踪点：ArtSvgIcon, SectionTitle。管理端产物包含此模块。"
  ],
  [
    "DuoYu-ID/admin/src/components/core/layouts/art-settings-panel/widget/MenuLayoutSettings.vue",
    "1d855c282724dada77c5248b38fa0bc236acebde36c3f9ea21f04320e1af8751",
    "配置输入、显示与持久化边界、响应式更新；按文件追踪设置项、消费组件及监听。 追踪点：SectionTitle。管理端产物包含此模块。"
  ],
  [
    "DuoYu-ID/admin/src/components/core/layouts/art-settings-panel/widget/MenuStyleSettings.vue",
    "1a0edf8a2115146ece741fcc283d1dff201e5453d9498956b438c5f86e519c43",
    "配置输入、显示与持久化边界、响应式更新；按文件追踪设置项、消费组件及监听。 追踪点：switchMenuStyles。管理端产物包含此模块。"
  ],
  [
    "DuoYu-ID/admin/src/components/core/layouts/art-settings-panel/widget/SettingActions.vue",
    "dd14c27341bcf98f5ab3b61f84b36abf7edd41cef773a953b855d4a07ac235d0",
    "配置输入、显示与持久化边界、响应式更新；按文件追踪设置项、消费组件及监听。 追踪点：valueToCode, generateConfigCode, handleCopyConfig, toggleIfDifferent, handleResetConfig。管理端产物包含此模块。"
  ],
  [
    "DuoYu-ID/admin/src/components/core/layouts/art-settings-panel/widget/SettingDrawer.vue",
    "a7d9af64bdf14372fdee7f820b69746556eef5756561a60d0fc7853b744791c4",
    "配置输入、显示与持久化边界、响应式更新；按文件追踪设置项、消费组件及监听。 追踪点：handleOpen, handleDrawerClose, handleClose。管理端产物包含此模块。"
  ],
  [
    "DuoYu-ID/admin/src/components/core/layouts/art-settings-panel/widget/SettingItem.vue",
    "7f0f35222a8a316b86939540c2fa56146259149fd891ba82d5ebe0d6a81ea273",
    "配置输入、显示与持久化边界、响应式更新；按文件追踪设置项、消费组件及监听。 追踪点：handleChange。管理端产物包含此模块。"
  ],
  [
    "DuoYu-ID/admin/src/components/core/layouts/art-settings-panel/widget/ThemeSettings.vue",
    "28ea07ef4245b8797a6094123019669e1d239a2ec78cdcd04bad0abc68edd3da",
    "配置输入、显示与持久化边界、响应式更新；按文件追踪设置项、消费组件及监听。 追踪点：SectionTitle。管理端产物包含此模块。"
  ],
  [
    "DuoYu-ID/admin/src/components/core/layouts/art-work-tab/index.vue",
    "17803a1d24e38701c48b95a3d70022ee546d802a144089d8ef9c55b66ba80a95",
    "标签/菜单状态及路由派发，核对持久化或组件入口以及构建引用。 追踪点：useContextMenu, getClickedTabInfo, checkTabsFixedStatus, useScrolling, setTransition, getCurrentTabElement。管理端产物包含此模块。"
  ],
  [
    "DuoYu-ID/admin/src/components/core/media/art-cutter-img/index.vue",
    "0667861c19cf6a7a3bb83f586cb28532ecceee23fc4e6c3e75c68da66ef21498",
    "追踪该文件的输入、主要操作、返回值或渲染绑定，以及直接副作用和生产构建边界。 追踪点：preloadImage, initImgCutter, cutterPrintImg, cutDownImg, handleImageLoadComplete, handleImageLoadError。当前管理端 JS 产物无此模块的运行时代码。"
  ],
  [
    "DuoYu-ID/admin/src/components/core/media/art-video-player/index.vue",
    "4749a3442161bd2c14a995fc443b0dfc2af39d40f462e97b27c4bbebbe649c2c",
    "追踪该文件的输入、主要操作、返回值或渲染绑定，以及直接副作用和生产构建边界。 追踪点：Props, VideoPlayerStyle。当前管理端 JS 产物无此模块的运行时代码。"
  ],
  [
    "DuoYu-ID/admin/src/components/core/others/art-menu-right/index.vue",
    "69205f54244e800d79e89df3b79d1230a34883fda850af5520af29bda73d6d05",
    "追踪该文件的输入、主要操作、返回值或渲染绑定，以及直接副作用和生产构建边界。 追踪点：calculateMenuHeight, calculatePosition, addEventListeners, removeEventListeners, handleDocumentClick, handleDocumentContextmenu。管理端产物包含此模块。"
  ],
  [
    "DuoYu-ID/admin/src/components/core/others/art-watermark/index.vue",
    "c96ba05ea73b3c6b6bd47c25941d21461ee50316f37dc0f10e93cadbf5f5cc07",
    "追踪该文件的输入、主要操作、返回值或渲染绑定，以及直接副作用和生产构建边界。 追踪点：ElWatermark。管理端产物包含此模块。"
  ],
  [
    "DuoYu-ID/admin/src/components/core/tables/art-table-header/index.vue",
    "1e142ece514b023777d3a8edc12fa7320870cfb5fed70a06ecdaa6665ec3167d",
    "字段输入到模型、提交/重置、筛选和分页边界；已对字段原型、空数据、并发、缓存容量和防抖作定向复测。 追踪点：getColumnVisibility, updateColumnVisibility, shouldShow, checkColumnMove, search, refresh。当前管理端 JS 产物无此模块的运行时代码。"
  ],
  [
    "DuoYu-ID/admin/src/components/core/tables/art-table/index.vue",
    "32824ec5aaf65983658febb7b8d4a6a431013db7c46f7ee8622d2e39b4349335",
    "字段输入到模型、提交/重置、筛选和分页边界；已对字段原型、空数据、并发、缓存容量和防抖作定向复测。 追踪点：hasExplicitTableProp, shouldRenderSlotScope, cleanColumnProps, handleSizeChange, handleCurrentChange, scrollToTop。当前管理端 JS 产物无此模块的运行时代码。"
  ],
  [
    "DuoYu-ID/admin/src/components/core/text-effect/art-count-to/index.vue",
    "fd466686083a6435c04b563df7d473147c5eccf8189a6f194d1da4d30ae74803",
    "追踪该文件的输入、主要操作、返回值或渲染绑定，以及直接副作用和生产构建边界。 追踪点：validateNumber, clamp, formatNumber, shouldSkipAnimation, resetPauseState, start。当前管理端 JS 产物无此模块的运行时代码。"
  ],
  [
    "DuoYu-ID/admin/src/components/core/text-effect/art-festival-text-scroll/index.vue",
    "5383155c578e7212f19bd5c748f6360e2d7794cc4fccf9a5db6a49b083b6baba",
    "内容来源、DOM 写入、图片及动画生命周期，区分内置配置与用户输入。 追踪点：handleClose。管理端产物包含此模块。"
  ],
  [
    "DuoYu-ID/admin/src/components/core/text-effect/art-text-scroll/index.vue",
    "7a8fa4262898f2d82e98c69762fbd78871043438668cc82d3329d94dac6e1f4d",
    "内容来源、DOM 写入、图片及动画生命周期，区分内置配置与用户输入。 追踪点：handleClose, measureSizes, handleContentClick。管理端产物包含此模块。"
  ],
  [
    "DuoYu-ID/admin/src/components/core/theme/theme-svg/index.vue",
    "4977abfcb54238dca42538770075781537fc511fe0d42dbcb53244c5069d9f3d",
    "内容来源、DOM 写入、图片及动画生命周期，区分内置配置与用户输入。 追踪点：applyThemeToSvg, loadSvgContent。管理端产物包含此模块。"
  ],
  [
    "DuoYu-ID/admin/src/components/core/views/exception/ArtException.vue",
    "79cb79db1126b2bf2d9e01072f0657e377eae6078819c9e3086c2fa4eb7a3ee3",
    "追踪该文件的输入、主要操作、返回值或渲染绑定，以及直接副作用和生产构建边界。 追踪点：backHome。管理端产物包含此模块。"
  ],
  [
    "DuoYu-ID/admin/src/components/core/views/login/AuthTopBar.vue",
    "381f1351a1acde2d2712430716d206586f763dc66b67f281657c6372bdc03650",
    "追踪该文件的输入、主要操作、返回值或渲染绑定，以及直接副作用和生产构建边界。 追踪点：changeLanguage, changeThemeColor。当前管理端 JS 产物无此模块的运行时代码。"
  ],
  [
    "DuoYu-ID/admin/src/components/core/views/login/LoginLeftView.vue",
    "d5dedce9e7c3a79f6ed8a096ba1f5455387cda4eb5762581e5537fc6e4c5a15a",
    "追踪该文件的输入、主要操作、返回值或渲染绑定，以及直接副作用和生产构建边界。 追踪点：ArtLogo, ThemeSvg。当前管理端 JS 产物无此模块的运行时代码。"
  ],
  [
    "DuoYu-ID/admin/src/components/core/views/result/ArtResultPage.vue",
    "ab7c214fa22c6092f040a01e764faa541723dd7b6de1f34322efe4f66efc0d63",
    "追踪该文件的输入、主要操作、返回值或渲染绑定，以及直接副作用和生产构建边界。 追踪点：ArtSvgIcon。当前管理端 JS 产物无此模块的运行时代码。"
  ],
  [
    "DuoYu-ID/admin/src/config/assets/images.ts",
    "38f02948c8fee5098bf73a0cb569bc041119d13b6b9fa440afae849621228157",
    "类型、配置及调用方依赖；结合实际类型检查、模板编译和构建输出。 追踪点：@imgs/settings/theme_styles/light.png, @imgs/settings/theme_styles/dark.png, @imgs/settings/theme_styles/system.png, @imgs/settings/menu_layouts/vertical.png。管理端产物包含此模块。"
  ],
  [
    "DuoYu-ID/admin/src/config/fastEnter.ts",
    "9198d8b030772456863ca2272b1bc94996b9ec510daba9885d2a52597d1bacb7",
    "类型、配置及调用方依赖；结合实际类型检查、模板编译和构建输出。 追踪点：@/utils/constants, @/types/config。当前管理端 JS 产物无此模块的运行时代码。"
  ],
  [
    "DuoYu-ID/admin/src/config/index.ts",
    "c4d18c2b240222b8e5ad1f62d962d4d676a39f255ae740f0afe43425bb7ce03c",
    "类型、配置及调用方依赖；结合实际类型检查、模板编译和构建输出。 追踪点：@/enums/appEnum, @/types/config, ./assets/images, ./modules/fastEnter。管理端产物包含此模块。"
  ],
  [
    "DuoYu-ID/admin/src/config/modules/component.ts",
    "9eda2a35b5bb3b8ca3e378ddf5ecab448392398921555d60c9d02dde406a39b1",
    "类型、配置及调用方依赖；结合实际类型检查、模板编译和构建输出。 追踪点：getEnabledGlobalComponents, getGlobalComponentByKey。管理端产物包含此模块。"
  ],
  [
    "DuoYu-ID/admin/src/config/modules/festival.ts",
    "63e94a3c8657e8d65bab4e26a89faac65b1317f6b1b051902a6e328cbe511adf",
    "内容来源、DOM 写入、图片及动画生命周期，区分内置配置与用户输入。 追踪点：@/types/config, @imgs/ceremony/sd.png, @imgs/ceremony/yd.png。管理端产物包含此模块。"
  ],
  [
    "DuoYu-ID/admin/src/config/setting.ts",
    "de067555825c743cd244d86d64cad4c0f16271c98b2317f994a663df013c0821",
    "配置输入、显示与持久化边界、响应式更新；按文件追踪设置项、消费组件及监听。 追踪点：getSettingDefaults, resetToDefaults。管理端产物包含此模块。"
  ],
  [
    "DuoYu-ID/admin/src/directives/business/highlight.ts",
    "32adbfe606e9ee9fad63c6953ff14e523d9db6ed29aa0320431b92ef93b93043",
    "内容来源、DOM 写入、图片及动画生命周期，区分内置配置与用户输入。 追踪点：highlightCode, insertLineNumbers, addCopyButton, isBlockProcessed, markBlockAsProcessed, processBlock。管理端产物包含此模块。"
  ],
  [
    "DuoYu-ID/admin/src/directives/business/ripple.ts",
    "55ef222df36d88f1623047640062514702323b183d15af6cc73db8670db5343d",
    "追踪该文件的输入、主要操作、返回值或渲染绑定，以及直接副作用和生产构建边界。 追踪点：mounted, setupRippleDirective。管理端产物包含此模块。"
  ],
  [
    "DuoYu-ID/admin/src/enums/appEnum.ts",
    "06ad5e2b6a6fc043d9131c4a91710b7f79edea83f59cf2312758b34e8bcc6bf2",
    "类型、配置及调用方依赖；结合实际类型检查、模板编译和构建输出。 追踪点：MenuTypeEnum, SystemThemeEnum, MenuThemeEnum, MenuWidth, LanguageEnum。管理端产物包含此模块。"
  ],
  [
    "DuoYu-ID/admin/src/env.d.ts",
    "6e20eb6c2f0f8f77d454984b5a286547f18e3bb5a65773fa24f865edc0edc8e9",
    "类型、配置及调用方依赖；结合实际类型检查、模板编译和构建输出。 追踪点：Level, RenderAs, GradientType, ImageSettings, QRCodeProps。当前管理端 JS 产物无此模块的运行时代码。"
  ],
  [
    "DuoYu-ID/admin/src/hooks/core/useCeremony.ts",
    "fe2b05d78f60b7c50fdde22f8609688975526763f80c8d087bff15ac3255faad",
    "内容来源、DOM 写入、图片及动画生命周期，区分内置配置与用户输入。 追踪点：useCeremony, isDateInRange, updateFestivalDate, triggerFirework, showFestivalText, startFireworksLoop。管理端产物包含此模块。"
  ],
  [
    "DuoYu-ID/admin/src/hooks/core/useChart.ts",
    "d342765b6c6a2128fa013d13f6d47b120f0082a8943f375831286c748fc1b7a6",
    "对照图表或卡片实际输入、数据映射、渲染及定时器入口，核查构建是否引用。 追踪点：useChartOps, useChart, clearTimers, requestAnimationResize, debouncedResize, multiDelayResize。当前管理端 JS 产物无此模块的运行时代码。"
  ],
  [
    "DuoYu-ID/admin/src/hooks/core/useCommon.ts",
    "6638a44c9614e7a50db1b76d4bf9ed73525910bfba6262bfd9ed4422d1a08ee1",
    "追踪该文件的输入、主要操作、返回值或渲染绑定，以及直接副作用和生产构建边界。 追踪点：useCommon, refresh, scrollToTop, smoothScrollToTop, scrollTo。管理端产物包含此模块。"
  ],
  [
    "DuoYu-ID/admin/src/hooks/core/useFastEnter.ts",
    "e7efd6b83e519457d2bf3cab2a6373b19b552c053aacbd662ea41b39b5f39c94",
    "追踪该文件的输入、主要操作、返回值或渲染绑定，以及直接副作用和生产构建边界。 追踪点：useFastEnter。管理端产物包含此模块。"
  ],
  [
    "DuoYu-ID/admin/src/hooks/core/useHeaderBar.ts",
    "08f06cc816329eb56e7452625fcab373ec5b96e5de9ed00b987e8f343de2f121",
    "追踪该文件的输入、主要操作、返回值或渲染绑定，以及直接副作用和生产构建边界。 追踪点：useHeaderBar, isFeatureEnabled, getFeatureConfig, isFeatureActive, getFeatureInfo, getEnabledFeatures。管理端产物包含此模块。"
  ],
  [
    "DuoYu-ID/admin/src/hooks/core/useLayoutHeight.ts",
    "55774b2b86bfb66973ffef3e57961feeed7172a9c9816f7d30f2148df2b4921f",
    "配置输入、显示与持久化边界、响应式更新；按文件追踪设置项、消费组件及监听。 追踪点：useLayoutHeight, useAutoLayoutHeight。管理端产物包含此模块。"
  ],
  [
    "DuoYu-ID/admin/src/hooks/core/useTable.ts",
    "dd72eccf50049ca51a6deba9ec9c9b240423dfb982230b1654f47640db1ae9b1",
    "字段输入到模型、提交/重置、筛选和分页边界；已对字段原型、空数据、并发、缓存容量和防抖作定向复测。 追踪点：useTable, useTableImpl, clearCache, fetchData, getData, getDataByPage。当前管理端 JS 产物无此模块的运行时代码。"
  ],
  [
    "DuoYu-ID/admin/src/hooks/core/useTableColumns.ts",
    "64640544aaf3773ecc78ba82ff7370df0a2a2d51e4b069a415a6f0185391a112",
    "字段输入到模型、提交/重置、筛选和分页边界；已对字段原型、空数据、并发、缓存容量和防抖作定向复测。 追踪点：getColumnKey, getColumnVisibility, getColumnChecks, useTableColumns, setDynamicColumns。当前管理端 JS 产物无此模块的运行时代码。"
  ],
  [
    "DuoYu-ID/admin/src/hooks/core/useTableHeight.ts",
    "f8cdebc72ec0d1cee94a98655eca6dad67c6f0a7266c308a0d4d49dc23cf7d20",
    "字段输入到模型、提交/重置、筛选和分页边界；已对字段原型、空数据、并发、缓存容量和防抖作定向复测。 追踪点：calculate, calculateOffset, getHeaderHeight, calculatePaginationOffset, useTableHeight。当前管理端 JS 产物无此模块的运行时代码。"
  ],
  [
    "DuoYu-ID/admin/src/hooks/core/useTheme.ts",
    "3b9bb91bf62613a7437437f12833ee3d924684610af95fbe43c3af16e0abc3b5",
    "配置输入、显示与持久化边界、响应式更新；按文件追踪设置项、消费组件及监听。 追踪点：useTheme, disableTransitions, enableTransitions, setSystemTheme, setSystemAutoTheme, switchThemeStyles。管理端产物包含此模块。"
  ],
  [
    "DuoYu-ID/admin/src/hooks/index.ts",
    "8914f15a511e839f05615872b99c3cf485e5defffa94e181004c97cf6abf4928",
    "类型、配置及调用方依赖；结合实际类型检查、模板编译和构建输出。 追踪点：./core/useCommon, ./core/useAppMode, ./core/useAuth, ./core/useTable。当前管理端 JS 产物无此模块的运行时代码。"
  ],
  [
    "DuoYu-ID/admin/src/locales/index.ts",
    "0de8024c142d1cfc335b17ea8531b822333d05e15fa13f806f7237d0e0a27302",
    "类型、配置及调用方依赖；结合实际类型检查、模板编译和构建输出。 追踪点：getDefaultLanguage。管理端产物包含此模块。"
  ],
  [
    "DuoYu-ID/admin/src/mock/temp/formData.ts",
    "c279a301865e54bb3f05d773666a1239e0a2e3928ff5dfda0ec78005993ec9c7",
    "追踪模板页面的表单/选择/存储与示例数据来源，核对正式路由和打包结果。 追踪点：User, Role。当前管理端 JS 产物无此模块的运行时代码。"
  ],
  [
    "DuoYu-ID/admin/src/plugins/echarts.ts",
    "7a4b18bcf50fecc3a77224d224ae1333871a8161b6a3b8882a5674202f8a43cf",
    "对照图表或卡片实际输入、数据映射、渲染及定时器入口，核查构建是否引用。 追踪点：echarts/core, echarts/charts, echarts/components, echarts/renderers。当前管理端 JS 产物无此模块的运行时代码。"
  ],
  [
    "DuoYu-ID/admin/src/store/index.ts",
    "24ad3bae8da0a7821eff22e2d3019053659527da86df2cd9e23a0cb6ababc0b4",
    "管理端版本键、旧数据和插件初始化次序，检查其读写契约和升级复测。 追踪点：initStore。管理端产物包含此模块。"
  ],
  [
    "DuoYu-ID/admin/src/store/modules/menu.ts",
    "2f174adc619b4dd3233786b7e002b8821d07ee45a07db2e990be119bc50b170a",
    "标签/菜单状态及路由派发，核对持久化或组件入口以及构建引用。 追踪点：setMenuList, getHomePath, setHomePath, addRemoveRouteFns, removeAllDynamicRoutes, clearRemoveRouteFns。管理端产物包含此模块。"
  ],
  [
    "DuoYu-ID/admin/src/store/modules/setting.ts",
    "bb11075350743f827d611108a3467530840e3fe4ce19416c0b9d48db56ae423a",
    "配置输入、显示与持久化边界、响应式更新；按文件追踪设置项、消费组件及监听。 追踪点：switchMenuLayouts, setMenuOpenWidth, setGlopTheme, switchMenuStyles, setElementTheme, setBorderMode。管理端产物包含此模块。"
  ],
  [
    "DuoYu-ID/admin/src/store/modules/table.ts",
    "3b981851017e3f1cb671baa25ee4bb91f781ea03d7738fd5b10128aa127f6284",
    "标签/菜单状态及路由派发，核对持久化或组件入口以及构建引用。 追踪点：setTableSize, setIsZebra, setIsBorder, setIsHeaderBackground, setIsFullScreen。当前管理端 JS 产物无此模块的运行时代码。"
  ],
  [
    "DuoYu-ID/admin/src/store/modules/worktab.ts",
    "14917cc6f75e8ea0fd36bd7e0eec93d4b0e49eca9e09ed7910b976cddc9e7b0c",
    "标签/菜单状态及路由派发，核对持久化或组件入口以及构建引用。 追踪点：findTabIndex, getTab, isTabClosable, safeRouterPush, openTab, findFixedTabInsertIndex。管理端产物包含此模块。"
  ],
  [
    "DuoYu-ID/admin/src/types/common/index.ts",
    "fe655a12ef59c12f004b0ef422b7f3e1583595bbbf0af94b2ff48e6036d7196a",
    "类型、配置及调用方依赖；结合实际类型检查、模板编译和构建输出。 追踪点：Status, Gender, SortOrder, ActionType, Recordable。当前管理端 JS 产物无此模块的运行时代码。"
  ],
  [
    "DuoYu-ID/admin/src/types/component/chart.ts",
    "362ac10f24f5168aea6c9cef7a96c6b469314c3b477b6d2c46be446a5fdba489",
    "类型、配置及调用方依赖；结合实际类型检查、模板编译和构建输出。 追踪点：LegendPosition, SymbolType, ChartThemeConfig, UseChartOptions, BaseChartProps。当前管理端 JS 产物无此模块的运行时代码。"
  ],
  [
    "DuoYu-ID/admin/src/types/component/index.ts",
    "aba6e6e9fde2161a63e4f08cb1eb17e4d9ce8b3fa7eacaff6a8888d64d1e6ade",
    "类型、配置及调用方依赖；结合实际类型检查、模板编译和构建输出。 追踪点：SearchComponentType, SearchChangeParams, ColumnOption, PaginationConfig, FormRule。当前管理端 JS 产物无此模块的运行时代码。"
  ],
  [
    "DuoYu-ID/admin/src/types/config/index.ts",
    "7f644ec0a291856aba83913175794d23a33fa4f521c0c66a36a2ef0db2c0e388",
    "类型、配置及调用方依赖；结合实际类型检查、模板编译和构建输出。 追踪点：ThemeSetting, MenuLayout, FestivalConfig, SystemBasicConfig, FastEnterBaseItem。当前管理端 JS 产物无此模块的运行时代码。"
  ],
  [
    "DuoYu-ID/admin/src/types/store/index.ts",
    "bf3e88f8f52e576c55c029ef2e66914da7733b43848d4b5ab12473b276639972",
    "管理端版本键、旧数据和插件初始化次序，检查其读写契约和升级复测。 追踪点：SystemThemeType, SystemThemeTypes, MenuThemeType, SettingState, WorkTab。当前管理端 JS 产物无此模块的运行时代码。"
  ],
  [
    "DuoYu-ID/admin/src/utils/constants/links.ts",
    "5004cd2a6730a667c5d7d76ec7213a05d8324f4841bfdc9073953d77e089f54a",
    "追踪该文件的输入、主要操作、返回值或渲染绑定，以及直接副作用和生产构建边界。 追踪点：links.ts。当前管理端 JS 产物无此模块的运行时代码。"
  ],
  [
    "DuoYu-ID/admin/src/utils/duoyu-clipboard.ts",
    "d449b6bce67e1bfc173c0c65f1288491877f3eb6dcd4d35d3cf446ebf5a95a5d",
    "追踪该文件的输入、主要操作、返回值或渲染绑定，以及直接副作用和生产构建边界。 追踪点：copyDuoyuText。管理端产物包含此模块。"
  ],
  [
    "DuoYu-ID/admin/src/utils/form/responsive.ts",
    "a00236becc21fba90031e4ff9fd15ea52d3740ebaf864b82f5a04690c87b0d9a",
    "追踪该文件的输入、主要操作、返回值或渲染绑定，以及直接副作用和生产构建边界。 追踪点：calculateResponsiveSpan, createResponsiveSpanCalculator。当前管理端 JS 产物无此模块的运行时代码。"
  ],
  [
    "DuoYu-ID/admin/src/utils/form/validator.ts",
    "9355dc3a0d50c6e7ff6d393b517c8a6d07b47233acd9bb4b8f9bd50bce4be6ef",
    "追踪该文件的输入、主要操作、返回值或渲染绑定，以及直接副作用和生产构建边界。 追踪点：trimSpaces, validatePhone, validateTelPhone, validateAccount, validatePassword, validateStrongPassword。当前管理端 JS 产物无此模块的运行时代码。"
  ],
  [
    "DuoYu-ID/admin/src/utils/http/error.ts",
    "7b2addc42768c477b46aabe0023d3686d77e1cba4fcb5078be2b280fadfcdf41",
    "检查网络/异常入口、鉴权、超时与重试、后台资源及生产可达性。 追踪点：toLogData, getErrorMessage, handleError, showError, showSuccess, isHttpError。管理端产物包含此模块。"
  ],
  [
    "DuoYu-ID/admin/src/utils/http/index.ts",
    "73516fb3ff1422cfb983eebedb0a467f279e743268590bb77e1f0c546df033da",
    "检查网络/异常入口、鉴权、超时与重试、后台资源及生产可达性。 追踪点：createHttpError, handleUnauthorizedError, resetUnauthorizedError, logOut, shouldRetry, retryRequest。管理端产物包含此模块。"
  ],
  [
    "DuoYu-ID/admin/src/utils/navigation/jump.ts",
    "0ad2f41c627f63fefc16281153dc3ed755fc0b22c8815735acdc875cabacbaa5",
    "动态菜单、隐藏子项、外链和内嵌路径；追踪导航目标到共享跳转函数和生产入口。 追踪点：openExternalLink, handleMenuJump, findFirstLeafMenu。管理端产物包含此模块。"
  ],
  [
    "DuoYu-ID/admin/src/utils/navigation/route.ts",
    "71fce0bc4ff5de2f89f2266d40cdb5c5ec2a30cca4d55727f0f9ad41d2833764",
    "动态菜单、隐藏子项、外链和内嵌路径；追踪导航目标到共享跳转函数和生产入口。 追踪点：webNavigationUrl, isIframe, isNavigableMenuItem, normalizePath, getFirstMenuPath。管理端产物包含此模块。"
  ],
  [
    "DuoYu-ID/admin/src/utils/navigation/worktab.ts",
    "6846001c804fbe88bff0a864d4e51d0bdd8ac276884b0ed19ce5aae9af340984",
    "动态菜单、隐藏子项、外链和内嵌路径；追踪导航目标到共享跳转函数和生产入口。 追踪点：setWorktab。管理端产物包含此模块。"
  ],
  [
    "DuoYu-ID/admin/src/utils/router.ts",
    "0c345ec3cecf37d82e8c82ca85579501962df9076c1e523aebe0db704c5c9f42",
    "标签/菜单状态及路由派发，核对持久化或组件入口以及构建引用。 追踪点：configureNProgress, setPageTitle, formatMenuTitle。管理端产物包含此模块。"
  ],
  [
    "DuoYu-ID/admin/src/utils/socket/index.ts",
    "6e3a1b46a54003132911204f1d6ee39999e081994bd1435a81b39f5611e6aee2",
    "检查网络/异常入口、鉴权、超时与重试、后台资源及生产可达性。 追踪点：getInstance, init, connect, handleConnectionTimeout, close, send。当前管理端 JS 产物无此模块的运行时代码。"
  ],
  [
    "DuoYu-ID/admin/src/utils/storage/storage-config.ts",
    "3c5c2c37691e629206f0f1962cf4a10351f0c83eccc025ae4c80c5e038610a40",
    "管理端版本键、旧数据和插件初始化次序，检查其读写契约和升级复测。 追踪点：escapeKey, generateStorageKey, generateLegacyKey, createKeyPattern, createCurrentVersionPattern, createVersionPattern。管理端产物包含此模块。"
  ],
  [
    "DuoYu-ID/admin/src/utils/storage/storage-key-manager.ts",
    "dd7e43e71a0820b63ca02bdc9cff9706d33f622ad08bde647c19fa5a0d105b67",
    "管理端版本键、旧数据和插件初始化次序，检查其读写契约和升级复测。 追踪点：getCurrentVersionKey, hasCurrentVersionData, findExistingKey, migrateData, getStorageKey。管理端产物包含此模块。"
  ],
  [
    "DuoYu-ID/admin/src/utils/storage/storage.ts",
    "92ded3c6fd675b0b9e0dcfec8bba7f4600230cf1312473728630061397a2805e",
    "管理端版本键、旧数据和插件初始化次序，检查其读写契约和升级复测。 追踪点：getSystemVersion, getSystemStorage, hasCurrentVersionStorage, hasAnyVersionStorage, getLegacyStorageData, showStorageError。管理端产物包含此模块。"
  ],
  [
    "DuoYu-ID/admin/src/utils/sys/error-handle.ts",
    "467908eceb5100ae501c49902005be1938cbd1708bf37593de0612546209f25c",
    "检查网络/异常入口、鉴权、超时与重试、后台资源及生产可达性。 追踪点：normalizeErrorMessage, isIgnorableScriptError, vueErrorHandler, scriptErrorHandler, registerPromiseErrorHandler, registerResourceErrorHandler。管理端产物包含此模块。"
  ],
  [
    "DuoYu-ID/admin/src/utils/sys/mittBus.ts",
    "355ed77bed86f938c656f787566d8f52c72bfa8a4e6fb1b2158a35cd9c57a3bb",
    "追踪该文件的输入、主要操作、返回值或渲染绑定，以及直接副作用和生产构建边界。 追踪点：Emitter, Events。管理端产物包含此模块。"
  ],
  [
    "DuoYu-ID/admin/src/utils/sys/upgrade.ts",
    "57b863807d192d60714f677e7d12f8ef9c156007381d3935f041876edc8ebccc",
    "管理端版本键、旧数据和插件初始化次序，检查其读写契约和升级复测。 追踪点：normalizeVersion, getStoredVersion, setStoredVersion, shouldSkipUpgrade, isFirstVisit, isSameVersion。管理端产物包含此模块。"
  ],
  [
    "DuoYu-ID/admin/src/utils/table/tableCache.ts",
    "0b38175af8d38b1dfcfad2241015230673e543f73d0c7db8082a448a70efd933",
    "字段输入到模型、提交/重置、筛选和分页边界；已对字段原型、空数据、并发、缓存容量和防抖作定向复测。 追踪点：log, generateKey, generateTags, evictLRU, set, get。当前管理端 JS 产物无此模块的运行时代码。"
  ],
  [
    "DuoYu-ID/admin/src/utils/table/tableConfig.ts",
    "d2d8f433ac86c9876fe9f02a1897cc485268560b09f444595ac128b39eeae7ef",
    "字段输入到模型、提交/重置、筛选和分页边界；已对字段原型、空数据、并发、缓存容量和防抖作定向复测。 追踪点：tableConfig.ts。当前管理端 JS 产物无此模块的运行时代码。"
  ],
  [
    "DuoYu-ID/admin/src/utils/table/tableUtils.ts",
    "3f96daf12b20478280017e9d76024f4ed7b83b946bfb2c5c476abfe5e3d580c3",
    "字段输入到模型、提交/重置、筛选和分页边界；已对字段原型、空数据、并发、缓存容量和防抖作定向复测。 追踪点：extractRecords, extractTotal, extractPagination, defaultResponseAdapter, extractTableData, updatePaginationFromResponse。当前管理端 JS 产物无此模块的运行时代码。"
  ],
  [
    "DuoYu-ID/admin/src/utils/ui/animation.ts",
    "4eeb61ff58004409ab11f80def5ca8ce322e6631f10360649bd785af159b9c73",
    "配置输入、显示与持久化边界、响应式更新；按文件追踪设置项、消费组件及监听。 追踪点：themeAnimation, toggleTheme, toggleTransition。管理端产物包含此模块。"
  ],
  [
    "DuoYu-ID/admin/src/utils/ui/colors.ts",
    "213a7dd75a7d5294ae7803aed91661d0e7138f4070377c7fba3aad6339ef7596",
    "配置输入、显示与持久化边界、响应式更新；按文件追踪设置项、消费组件及监听。 追踪点：getCssVar, isValidHexColor, isValidRgbValue, isValid, hexToRgba, hexToRgb。管理端产物包含此模块。"
  ],
  [
    "DuoYu-ID/admin/src/utils/ui/emojo.ts",
    "c1c07bfb48cd61c994581bc0170dcc9a288e87cc0a018d3420100b98d0693e9a",
    "追踪该文件的输入、主要操作、返回值或渲染绑定，以及直接副作用和生产构建边界。 追踪点：emojo.ts。当前管理端 JS 产物无此模块的运行时代码。"
  ],
  [
    "DuoYu-ID/admin/src/utils/ui/loading.ts",
    "40330e56934a7310508672e8fef0df2b6983a49c779bfbd8e158cfc8e33dd0d6",
    "追踪该文件的输入、主要操作、返回值或渲染绑定，以及直接副作用和生产构建边界。 追踪点：getLoadingBackground, background, showLoading, hideLoading。管理端产物包含此模块。"
  ],
  [
    "DuoYu-ID/admin/src/utils/ui/tabs.ts",
    "24370de7a7eb8cb44d0de84337ae8d49827de1e5430af68c31bd483af832ebd4",
    "追踪该文件的输入、主要操作、返回值或渲染绑定，以及直接副作用和生产构建边界。 追踪点：getTabConfig。当前管理端 JS 产物无此模块的运行时代码。"
  ],
  [
    "DuoYu-ID/admin/src/views/dashboard/console/index.vue",
    "7d56aedc7a08ff34b0d31c1ae3cb7231abcfee7db237a8030368627bd583e2c1",
    "对照图表或卡片实际输入、数据映射、渲染及定时器入口，核查构建是否引用。 追踪点：AboutProject, ActiveUser, CardList, Dynamic, ElCol。当前管理端 JS 产物无此模块的运行时代码。"
  ],
  [
    "DuoYu-ID/admin/src/views/dashboard/console/modules/about-project.vue",
    "53c8dfaefe09fb275e51359b466e2190c17e40cd758504e34e2486db9858fa5f",
    "对照图表或卡片实际输入、数据映射、渲染及定时器入口，核查构建是否引用。 追踪点：goPage。当前管理端 JS 产物无此模块的运行时代码。"
  ],
  [
    "DuoYu-ID/admin/src/views/dashboard/console/modules/active-user.vue",
    "fc7639af5e2cc2a972c69e1a85ceb1ab1f127dfdb43e5c457fc24ff3fc3b1be1",
    "对照图表或卡片实际输入、数据映射、渲染及定时器入口，核查构建是否引用。 追踪点：ArtBarChart。当前管理端 JS 产物无此模块的运行时代码。"
  ],
  [
    "DuoYu-ID/admin/src/views/dashboard/console/modules/card-list.vue",
    "62a0aa0067a8123b450d65478c764885046893a12d861770291182716952ad3d",
    "对照图表或卡片实际输入、数据映射、渲染及定时器入口，核查构建是否引用。 追踪点：ArtCountTo, ArtSvgIcon, ElCol, ElRow。当前管理端 JS 产物无此模块的运行时代码。"
  ],
  [
    "DuoYu-ID/admin/src/views/dashboard/console/modules/dynamic-stats.vue",
    "ac324b0311208e12e9f80396b6b44b613c895af048952894a841f644b6670832",
    "对照图表或卡片实际输入、数据映射、渲染及定时器入口，核查构建是否引用。 追踪点：ElScrollbar。当前管理端 JS 产物无此模块的运行时代码。"
  ],
  [
    "DuoYu-ID/admin/src/views/dashboard/console/modules/new-user.vue",
    "7bae12193ed3f1746142a060d475d4a6ddf999a8482ba0cdb346fcd19ecd0132",
    "对照图表或卡片实际输入、数据映射、渲染及定时器入口，核查构建是否引用。 追踪点：addAnimation。当前管理端 JS 产物无此模块的运行时代码。"
  ],
  [
    "DuoYu-ID/admin/src/views/dashboard/console/modules/sales-overview.vue",
    "a17861ec1a9ff72f293b2150f9153500d51ec41183b50e49b4f7e45604e0d007",
    "对照图表或卡片实际输入、数据映射、渲染及定时器入口，核查构建是否引用。 追踪点：ArtLineChart。当前管理端 JS 产物无此模块的运行时代码。"
  ],
  [
    "DuoYu-ID/admin/src/views/dashboard/console/modules/todo-list.vue",
    "224611e1653d13784252e6f79bb2b7c0cc3038e9b2e1d0e2c5cfdf5e56149ea2",
    "对照图表或卡片实际输入、数据映射、渲染及定时器入口，核查构建是否引用。 追踪点：ElCheckbox, ElScrollbar。当前管理端 JS 产物无此模块的运行时代码。"
  ],
  [
    "DuoYu-ID/admin/src/views/duoyu/docs/index.vue",
    "fa9302daae41e28327fd91cbd8806931e9402c790e165935a02d8894dabd3e5f",
    "追踪页面权限和 API 入口、刷新/失败反馈与路由切换，结合隔离账号及数据库的管理页面联调。 追踪点：check, copyGuide, download。管理端产物包含此模块。"
  ],
  [
    "DuoYu-ID/admin/src/views/duoyu/health/index.vue",
    "f5c94da0970b5f9dd52b2459f658cfbb0438e7b57c6beb960ceead60f85102d0",
    "追踪页面权限和 API 入口、刷新/失败反馈与路由切换，结合隔离账号及数据库的管理页面联调。 追踪点：loadAttempts, load。管理端产物包含此模块。"
  ],
  [
    "DuoYu-ID/admin/src/views/duoyu/mail/index.vue",
    "b3cf8ffe6177c6ed3333fa459d4a4d22032e5e63056a014473a10d3afff00d98",
    "追踪页面权限和 API 入口、刷新/失败反馈与路由切换，结合隔离账号及数据库的管理页面联调。 追踪点：reset, load。管理端产物包含此模块。"
  ],
  [
    "DuoYu-ID/admin/src/views/duoyu/manage/index.vue",
    "4820454f3c18e6f87f75e43baadafcb2e606293c12cc41aac17928930131cbef",
    "追踪页面权限和 API 入口、刷新/失败反馈与路由切换，结合隔离账号及数据库的管理页面联调。 追踪点：load, create, edit, showDetail, grants, showAppUsers。管理端产物包含此模块。"
  ],
  [
    "DuoYu-ID/admin/src/views/duoyu/overview/index.vue",
    "d3a535f15a736cdbba5b89461863d4e0da2e37af8c667e05d1f8a415a6f01564",
    "追踪页面权限和 API 入口、刷新/失败反馈与路由切换，结合隔离账号及数据库的管理页面联调。 追踪点：load。管理端产物包含此模块。"
  ],
  [
    "DuoYu-ID/admin/src/views/duoyu/profile/AuthenticatorSettings.vue",
    "4b7f3afa13cc1f4fd7dbcbc02cf28a1c35395b5efaae7dd917bfa1b358f53c1e",
    "凭证选择、状态读取、重复提交、卸载、退出和历史持久化边界；凭证操作和退出有专门回归。 追踪点：load, leave, unload, send, submit, downloadCodes。管理端产物包含此模块。"
  ],
  [
    "DuoYu-ID/admin/src/views/duoyu/profile/index.vue",
    "cc0c6ac87eb2cc03161eed5dc8ffd0c6bd0449e65d800a0a19a7a5a7e4e11cb8",
    "凭证选择、状态读取、重复提交、卸载、退出和历史持久化边界；凭证操作和退出有专门回归。 追踪点：leaveSecurity, beforeUnload, clearSecurity, selectPasskey, closeDialog, load。管理端产物包含此模块。"
  ],
  [
    "DuoYu-ID/admin/src/views/duoyu/project-api/index.vue",
    "5783e5154079c8da4ba9480d35c96a063f76083be57fc0ed3bc28e35074a5123",
    "追踪页面权限和 API 入口、刷新/失败反馈与路由切换，结合隔离账号及数据库的管理页面联调。 追踪点：copyURL, copyMCP, defaults, leave, unload, mutationContext。管理端产物包含此模块。"
  ],
  [
    "DuoYu-ID/admin/src/views/duoyu/settings/index.vue",
    "07e92093b732a88fa1b34d787dc03f6439ec398de6d420d529bc831b27cbea7a",
    "追踪页面权限和 API 入口、刷新/失败反馈与路由切换，结合隔离账号及数据库的管理页面联调。 追踪点：preview, save。管理端产物包含此模块。"
  ],
  [
    "DuoYu-ID/admin/src/views/outside/Iframe.vue",
    "78020c63d5edbbd987a5b7edb10274f48ed02b6e643af701b512e0055592ed0d",
    "动态菜单、隐藏子项、外链和内嵌路径；追踪导航目标到共享跳转函数和生产入口。 追踪点：handleIframeLoad。管理端产物包含此模块。"
  ],
  [
    "DuoYu-ID/admin/src/views/result/fail/index.vue",
    "975ecb9b39f4ed61907cd1e58cc302bc348fb476dbdc7d332558bf423d1d2c51",
    "追踪该文件的输入、主要操作、返回值或渲染绑定，以及直接副作用和生产构建边界。 追踪点：ArtResultPage, ArtSvgIcon, ElButton。当前管理端 JS 产物无此模块的运行时代码。"
  ],
  [
    "DuoYu-ID/admin/src/views/result/success/index.vue",
    "2616dbd10a4497fcaccbd0c42323f45efa244d7eef1ad73aac4a2ef27601c53a",
    "追踪该文件的输入、主要操作、返回值或渲染绑定，以及直接副作用和生产构建边界。 追踪点：ArtResultPage, ElButton。当前管理端 JS 产物无此模块的运行时代码。"
  ],
  [
    "DuoYu-ID/admin/src/views/system/menu/index.vue",
    "7ace35f22aa3521ba56d4bc562c812eecfe2d84a81bf5351461362dcb5108f84",
    "追踪模板页面的表单/选择/存储与示例数据来源，核对正式路由和打包结果。 追踪点：getMenuList, getMenuTypeTag, getMenuTypeText, handleReset, handleSearch, handleRefresh。当前管理端 JS 产物无此模块的运行时代码。"
  ],
  [
    "DuoYu-ID/admin/src/views/system/menu/modules/menu-dialog.vue",
    "261eafbb2fd90b5211b9f9fd40a1320e5978cff746f8a957f9c94f32ad1dd6f5",
    "追踪模板页面的表单/选择/存储与示例数据来源，核对正式路由和打包结果。 追踪点：createLabelTooltip, resetForm, loadFormData, handleSubmit, handleCancel, handleClosed。当前管理端 JS 产物无此模块的运行时代码。"
  ],
  [
    "DuoYu-ID/admin/src/views/system/role/index.vue",
    "a3dec22eb9f5b4f1aad489137bf89cdaad38378a527bf59e2a57f989b8fbeada",
    "追踪模板页面的表单/选择/存储与示例数据来源，核对正式路由和打包结果。 追踪点：showDialog, handleSearch, buttonMoreClick, showPermissionDialog, deleteRole。当前管理端 JS 产物无此模块的运行时代码。"
  ],
  [
    "DuoYu-ID/admin/src/views/system/role/modules/role-edit-dialog.vue",
    "908c2ad1dc754f5cfb2c22d9f24635f75765057c52ea0817a1ff3230f4f7eec0",
    "追踪模板页面的表单/选择/存储与示例数据来源，核对正式路由和打包结果。 追踪点：initForm, handleClose, handleSubmit。当前管理端 JS 产物无此模块的运行时代码。"
  ],
  [
    "DuoYu-ID/admin/src/views/system/role/modules/role-permission-dialog.vue",
    "a328691c71bae971f5fd48c346bdeef1bac91b888a9510454e8a23f82d1ae6ba",
    "追踪模板页面的表单/选择/存储与示例数据来源，核对正式路由和打包结果。 追踪点：processNode, handleClose, savePermission, toggleExpandAll, toggleSelectAll, getAllNodeKeys。当前管理端 JS 产物无此模块的运行时代码。"
  ],
  [
    "DuoYu-ID/admin/src/views/system/role/modules/role-search.vue",
    "5bd23a3d12725e80ec0c9fa519a5a89c75fa640aaa020f39aaaeab7353af9443",
    "追踪模板页面的表单/选择/存储与示例数据来源，核对正式路由和打包结果。 追踪点：handleReset, handleSearch。当前管理端 JS 产物无此模块的运行时代码。"
  ],
  [
    "DuoYu-ID/admin/src/views/system/user-center/index.vue",
    "30b12058d3cf1156dacb12e9a62a72a01dceb8ab2c823fd664b8f267bd8bef44",
    "追踪模板页面的表单/选择/存储与示例数据来源，核对正式路由和打包结果。 追踪点：getDate, edit, editPwd。当前管理端 JS 产物无此模块的运行时代码。"
  ],
  [
    "DuoYu-ID/admin/src/views/system/user/index.vue",
    "c16124ba74c726ceb5b87ff394382aed78af0366cb6c1894b543a6b3da12f90d",
    "追踪模板页面的表单/选择/存储与示例数据来源，核对正式路由和打包结果。 追踪点：getUserStatusConfig, handleSearch, showDialog, deleteUser, handleDialogSubmit, handleSelectionChange。当前管理端 JS 产物无此模块的运行时代码。"
  ],
  [
    "DuoYu-ID/admin/src/views/system/user/modules/user-dialog.vue",
    "b348975eb05504cb1d3f225a3367a053425d5b7fd5eb46a0ed099df0c249e2ad",
    "追踪模板页面的表单/选择/存储与示例数据来源，核对正式路由和打包结果。 追踪点：initFormData, handleSubmit。当前管理端 JS 产物无此模块的运行时代码。"
  ],
  [
    "DuoYu-ID/admin/src/views/system/user/modules/user-search.vue",
    "ccf8208d28ec7f1697db117173e10947121712a647dfd6e53f73775fab6cae86",
    "追踪模板页面的表单/选择/存储与示例数据来源，核对正式路由和打包结果。 追踪点：fetchStatusOptions, handleReset, handleSearch。当前管理端 JS 产物无此模块的运行时代码。"
  ],
  [
    "DuoYu-ID/admin/vite.config.ts",
    "675da32cd8fad00b4eba5e166d1f5e60b3790443c5922a7a44c4d0c003c54c6d",
    "类型、配置及调用方依赖；结合实际类型检查、模板编译和构建输出。 追踪点：manualChunks, resolvePath。当前管理端 JS 产物无此模块的运行时代码。"
  ],
  [
    "DuoYu-Extensions/src/features/shortcuts/WallpaperWheel.vue",
    "f5fda809db52861edbe09801e9c693b059643d12c90e6a7df1be20dc6aeeb753",
    "本轮关联变更；链接协议校验、隔离构建快照、账号和升级回归、异步列表竞态，逐项见 P2-REVIEW.md。"
  ],
  [
    "DuoYu-Extensions/src/shared/open-web-tab.ts",
    "4cac76031ae904f075fcaf845e1a8e30dcc33bbdfd049df7152586d717b8235f",
    "本轮关联变更；链接协议校验、隔离构建快照、账号和升级回归、异步列表竞态，逐项见 P2-REVIEW.md。"
  ],
  [
    "DuoYu-Extensions/scripts/account-controls.mjs",
    "be2b5553c128aae844e9554d2c0bd5ff575a99b495b9e348bc60d97ab72b59eb",
    "本轮关联变更；链接协议校验、隔离构建快照、账号和升级回归、异步列表竞态，逐项见 P2-REVIEW.md。"
  ],
  [
    "DuoYu-Extensions/scripts/id-storage-upgrade.mjs",
    "d1999cbe9c7248810dfe3f3f1c38ec9a7dcd75f57ca2ca9e3ce1a878f49a1bb1",
    "本轮关联变更；链接协议校验、隔离构建快照、账号和升级回归、异步列表竞态，逐项见 P2-REVIEW.md。"
  ],
  [
    "DuoYu-Extensions/scripts/fixtures/id-security.mjs",
    "df5e470a3ec2ede7621d03d3770d309c6ad4f17d2c2d177d497b9ea67e60ab17",
    "本轮关联变更；链接协议校验、隔离构建快照、账号和升级回归、异步列表竞态，逐项见 P2-REVIEW.md。"
  ],
  [
    "DuoYu-Extensions/scripts/startup-account-isolation-ui.mjs",
    "137ce9474855deab0d293756aa7b7adc3d0c22b55d14ff207f1fbb93c13281cc",
    "本轮关联变更；链接协议校验、隔离构建快照、账号和升级回归、异步列表竞态，逐项见 P2-REVIEW.md。"
  ],
  [
    "DuoYu-Extensions/scripts/review-regression.mjs",
    "cfd2d0f9f991785d8822856c7ddd5ad6919cb9a5dff8ab851b8ca1fccd9f0be7",
    "本轮关联变更；链接协议校验、隔离构建快照、账号和升级回归、异步列表竞态，逐项见 P2-REVIEW.md。"
  ],
  [
    "DuoYu-Extensions/scripts/auth-isolated.mjs",
    "ce5984e5382d86fd7a26f34cb5d443ea7e0242d86c4e7925ebabfc00fa8f4e83",
    "本轮关联变更；链接协议校验、隔离构建快照、账号和升级回归、异步列表竞态，逐项见 P2-REVIEW.md。"
  ],
  [
    "DuoYu-Extensions/scripts/dock-links.mjs",
    "35429977a6c34c2cd1666c2ac3d4353a4ff634403c1246749645d2c3e78e94b7",
    "本轮关联变更；链接协议校验、隔离构建快照、账号和升级回归、异步列表竞态，逐项见 P2-REVIEW.md。"
  ],
  [
    "DuoYu-Extensions/scripts/library-limits.mjs",
    "86ca12cde2e738c94eb3a02f97a078982b8ad237187a688905530f0cb68378e5",
    "本轮关联变更；链接协议校验、隔离构建快照、账号和升级回归、异步列表竞态，逐项见 P2-REVIEW.md。"
  ],
  [
    "DuoYu-ID/admin/tests/table-races.mjs",
    "aa16de79fa3712ecc74b3d4f235feeb11c23645f3cb092ef4ea1358a41797911",
    "本轮关联变更；链接协议校验、隔离构建快照、账号和升级回归、异步列表竞态，逐项见 P2-REVIEW.md。"
  ],
  [
    "DuoYu-ID/admin/tests/dependency-compat.mjs",
    "2b2aa96d93170d8dfb5f98d72ffa971a65bf124f8e59f90c52aceda737795154",
    "本轮关联变更；链接协议校验、隔离构建快照、账号和升级回归、异步列表竞态，逐项见 P2-REVIEW.md。"
  ]
]) {
  const earlier = reviewed.get(file);
  reviewed.set(file, {reviewedSha256, scope, finding: scope, evidence: [...new Set([...(earlier?.evidence || []), 'P2-REVIEW.md'])]});
}
// Keep the final scope ledger separate: this script also has a review hash.
// A fresh checkout without the evidence retains pending entries.
try {
  const ledger = JSON.parse(await readFile(path.join(out, 'P3-SOURCE-REVIEW.json'), 'utf8'));
  for (const {file, reviewedSha256, scope} of ledger) {
    if (!/^[0-9a-f]{64}$/.test(reviewedSha256)) throw new Error('Invalid review digest');
    reviewed.set(file, {reviewedSha256, scope, finding: scope, evidence: ['P3-REVIEW.md']});
  }
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const files = [],
  omitted = {};
for (const repo of roots) {
  const cwd = path.resolve('..', repo);
  const rootPath = await realpath(cwd);
  const paths = [
    ...new Set(
      execFileSync(
        'git',
        ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
        { cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
      )
        .split('\0')
        .filter(Boolean),
    ),
  ].sort();
  let excluded = 0;
  for (const file of paths) {
    if (
      /(^|\/)(?:work|node_modules|dist|test-results|data|backups|\.git|\.agents|\.codex|\.output|\.wxt)(\/|$)/i.test(
        file,
      ) ||
      (/(^|\/)(?:Key\.txt|\.env(?:\..*)?|.*\.(?:pem|key|p12|pfx))$/i.test(
        file,
      ) &&
        !file.endsWith('.env.example'))
    ) {
      excluded++;
      continue;
    }
    const extension = path.extname(file).toLowerCase();
    const textual =
      /\.(?:[cm]?js|jsx|tsx?|vue|go|css|scss|sass|less|html|json|ya?ml|toml|py|service|timer|sql|md|ps1|sh|conf|lock|mod|sum|txt|example)$/.test(
        extension,
      ) ||
      /(^|\/)(?:Dockerfile|Makefile|\.gitignore|\.dockerignore|\.editorconfig|\.npmrc|\.gitattributes|\.prettierrc|\.stylelintignore|\.prettierignore)$/.test(
        file,
      ) || /(?:^|\/)\.husky\/(commit-msg|pre-commit)$/.test(file);
    if (!textual) {
      excluded++;
      continue;
    }
    const absolute = path.join(cwd, file);
    let info;
    try {
      info = await lstat(absolute);
    } catch (e) {
      if (e.code === 'ENOENT') {
        files.push({ repo, file, status: 'deleted_from_worktree' });
        continue;
      }
      throw e;
    }
    if (!info.isFile()) {
      excluded++;
      continue;
    }
    const canonical = await realpath(absolute);
    if (path.resolve(rootPath, file) !== canonical) {
      excluded++;
      continue;
    }
    const bytes = await readFile(canonical);
    const entry = reviewed.get(repo + '/' + file);
    let category = 'source';
    if (/\.(md|txt)$/.test(file)) category = 'documentation';
    else if (/(^|\/)(test|tests|scripts)(\/|$)|[._]test\./.test(file))
      category = 'test_or_operations';
    else if (/^(?:package(?:-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|go\.(?:mod|sum))$/.test(path.basename(file)))
      category = 'dependencies';
    else if (
      /\.(json|ya?ml|toml|conf|example)$/.test(file) ||
      /Dockerfile|\.gitignore|\.editorconfig/.test(file)
    )
      category = 'configuration';
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    files.push({
      repo,
      file,
      category,
      bytes: bytes.length,
      sha256,
      status:
        entry?.reviewedSha256 === sha256
          ? 'review_recorded_for_scope'
          : entry
            ? 'changed_since_review'
            : 'pending_traceable_review',
      ...entry,
    });
  }
  omitted[repo] = excluded;
}
const summary = roots.map((repo) => ({
  repo,
  files: files.filter((f) => f.repo === repo).length,
  recorded: files.filter(
    (f) => f.repo === repo && f.status === 'review_recorded_for_scope',
  ).length,
  omitted: omitted[repo],
}));
await writeFile(
  path.join(out, 'SOURCE-REVIEW.json'),
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      meaning:
        'Hashes identify the inventoried bytes only. Pending means missing complete traceable review, not a claim that no previous reading/tests occurred. Focused review is not complete feature coverage.',
      excluded:
        'Secrets, runtime/generated/dependency directories and non-text assets. Environment templates are included. No secret file content is read.',
      summary,
      files,
    },
    null,
    2,
  ),
);
console.log(JSON.stringify(summary));
