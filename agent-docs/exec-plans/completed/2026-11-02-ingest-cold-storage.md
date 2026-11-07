# Lazy closed-month integration ingest storage

Status: completed
Updated: 2026-11-02

## Result and design

Implemented in the requested checkout on `codex/ingest-cold-storage`, based on
`52dbc85e8274`. No commits, pushes, PRs, deployments or other checkout changes.
All source and test changes remain in the working tree.

The existing `hosted-media-refs.json` inventory, media upload fences, member-scoped
hashed object keys, encrypted media store, kind-bound AAD, verified materializer,
and deletion prefix sweep now support `integration-ingest`. There is no second
artifact store, new bucket, background uploader, query projection or data rewrite.
The v2 snapshot format and existing inline snapshots remain readable.

Only canonical `ledger/integration-ingests/YYYY/YYYY-MM.jsonl.br` files older than
the current UTC month qualify. Conflicting plain/gzip/zip siblings keep the month
inline. The next checkpoint uploads eligible months before excluding them from the
archive. Current-month files stay inline; idle maintenance no longer compresses
the current month. Sparse checkpoints retain cold references, including after a
reader downloads the file. Registered, unretired cold objects have no expiry.
Incomplete uploads and explicitly retired rows retain existing cleanup semantics.

Core resolves the inventory before whole-history or selected-month reads, verifies
size and SHA-256, and uses an invocation-scoped host materializer when needed.
Missing, corrupt or unavailable cold history raises
`HOSTED_COLD_HISTORY_UNAVAILABLE` with `retryable: true`. Repair, novelty selection
and vault validation cannot swallow this error as empty history. Missing catalogue
files mean old inline snapshots; malformed catalogues fail closed. The scoped
callback checks the exact vault root and does not cache member authority globally.

Hosted writes admit only the invocation clock's current month. Referenced cold
months are immutable in all core write paths, including unbound local use. Legacy
local operations on unreferenced inline historical files retain their existing
behavior. Rollback may cross the month boundary but cannot mutate a cold object.
Existing receipt recovery is unchanged: it resolves required preimages only;
ordinary restore does not enumerate or download cold history. A checkpoint already
replaces the prior receipt log, so historical receipts are not replayed against its
new cold references.

Integration ingests already have `querySource: "none"` in the canonical family
registry. No query source signature, query schema or query.sqlite file is changed.
The regression test removes the ingest bytes after building a projection and proves
that freshness, generation and query.sqlite bytes remain unchanged after a query.

Raw provider content is retained. Active core history reads, HR-zone repair,
wearable migration and validation still consume this evidence; deleting
`parts[].content` is not justified by the available code evidence.

## Restore bytes

Using the supplied founder-shape measurements, approximately **8.7 MB** of already
Brotli-compressed monthly history leaves the restore archive, about **35%** of the
24.9 MB compressed vault. The archive would be approximately **16.2 MB**, plus a
small reference inventory and archive/encryption overhead. This is an estimate,
not a measured production checkpoint. It assumes the supplied 8.7 MB is eligible
closed history; any current-month or conflicting representation stays inline.

The 16 closed months retain roughly 230 MB of logical evidence. Broad historical
reads still pay the download, verification and decompression cost when requested.
This change moves that cost off ordinary restore; it does not delete those bytes.

## Export, erasure and retention

- The existing Settings export remains its documented dashboard JSON export; it
  did not contain raw integration history before this change. Its tests pass.
- Complete v2 workspace archive planning requires every cold reference to have
  local, size/hash-verified bytes unless the checkpoint publisher explicitly
  excludes it. Missing history fails retryably. An exporter must invoke the scoped
  materializer first; no new raw-history export endpoint was added.
- Account erasure removes cold objects through the existing member media prefix
  sweep and upload-drain fence. It does not need to download or decrypt them. The
  regression test proves another member's object remains and no cold GET occurs.
- The SQL constraint allows the new media kind, protects active registered history
  against expiry, and permits unfinished-upload and explicit-retirement cleanup.
- The checked-in bucket lifecycle configuration has no expiry rule for the hosted
  media prefix. No lifecycle configuration changes were made or applied. R2 rules
  are prefix-scoped: [Cloudflare object lifecycle documentation](https://developers.cloudflare.com/r2/buckets/object-lifecycles/).
  Live bucket policy was not inspected.

## Deployment order and version skew

1. Apply `20261102120000_hosted_cold_ingest_media` to expand the media constraints.
2. Deploy Web with the compatible shared hosted-execution media parser. Older
   Web rejects the new kind; newer Web still accepts image/video descriptors.
3. Deploy the compatible Cloudflare Worker and runner together. Drain older
   runner images before admitting producers that publish cold references. The
   new runner must not send the new kind through an older Worker or Web.
4. Allow the next ordinary checkpoint to externalize eligible closed months.

After the first sparse checkpoint, the compatible runner is a rollback floor.
Older readers can ignore the new catalogue kind and incorrectly see partial
history; do not route sparse workspaces to them. Use a forward fix or an explicitly
coordinated, fully hydrated checkpoint before downgrading. No rollout toggle or
snapshot backfill is introduced. Nothing was deployed in this task.

## Verification commands and outcomes

Commands below ran from this checkout. Output was piped through a home-path
redactor with `set -o pipefail`; commands are shown without that output-only pipe.
Packages were built before their Vitest runs. These are focused affected suites,
not a claim that every repository test or hosted CI lane ran.

### Builds and typechecks

```sh
pnpm --filter @murphai/assistant-runtime build
pnpm --filter @murphai/runtime-state build
pnpm --filter @murphai/core build
pnpm --filter @murphai/hosted-execution build
pnpm --filter @murphai/runtime-state --filter @murphai/core --filter @murphai/query --filter @murphai/hosted-execution --filter @murphai/assistant-runtime --filter @murphai/cloudflare-runner build
```

PASS. An intermediate assistant-runtime build failed because a canonical media
receipt converter still accepted the widened union; it now explicitly rejects
cold-history descriptors as raw media receipts, and the build passes.
Runtime-state and core were rebuilt after the final validator/write-guard changes.

```sh
pnpm --filter @murphai/runtime-state --filter @murphai/core --filter @murphai/query --filter @murphai/hosted-execution --filter @murphai/assistant-runtime --filter @murphai/cloudflare-runner typecheck
pnpm --filter @murphai/assistant-runtime typecheck
pnpm --filter @murphai/hosted-web typecheck
pnpm --filter @murphai/cloudflare-runner typecheck
pnpm --filter @murphai/runtime-state --filter @murphai/core typecheck
```

All six affected packages and Web ultimately PASS. The first grouped run passed
runtime-state/core/query/hosted-execution, then failed assistant-runtime because
existing test store stubs still narrowed media to images/videos; those stubs were
updated and its standalone check passed. Cloudflare initially failed on missing
generated Web Prisma types. The normal Web typecheck generated its Prisma client
and passed; Cloudflare then passed. This matches the existing Frog entry
`20261023155420-cloudflare-app-typecheck`; no duplicate friction entry was created.
The final runtime-state/core checks passed after the final source edits.

### Runtime state and protocol

```sh
pnpm --filter @murphai/runtime-state exec vitest run test/hosted-media-references.test.ts test/hosted-workspace-snapshot-interruption.test.ts test/hosted-codex-native-memory.test.ts --no-coverage
pnpm --filter @murphai/hosted-execution exec vitest run test/runtime-media.test.ts --no-coverage
```

PASS: 15 runtime-state tests and 7 protocol tests. Includes absent/invalid inventory,
non-expiring cold descriptors, old snapshots and interrupted snapshot behavior.

### Core and query

```sh
pnpm --filter @murphai/core exec vitest run test/integration-ingest-cold-storage.test.ts test/wearable-storage-migration.test.ts test/device-import.test.ts --no-coverage
pnpm --filter @murphai/core exec vitest run test/integration-ingest-cold-storage.test.ts test/integration-ingests.test.ts --no-coverage
pnpm --filter @murphai/query exec vitest run test/query-projection-storage.test.ts --no-coverage
```

PASS: 247 tests across cold storage/migration/device imports; final cold storage and
integration-ingest run 44 tests; query projection storage 10 tests. Counts overlap.
The final core run includes vault validation failing retryably on missing history.

Earlier command:

```sh
pnpm --filter @murphai/core exec vitest run test/integration-ingest-cold-storage.test.ts test/integration-ingests.test.ts test/integration-ingest-migration.test.ts test/junction-hr-zone-repair.test.ts --no-coverage
```

FAIL: two newly authored tests used the wrong append API call shape. Fixed those
fixtures. The last two filenames did not exist, so their actual coverage was run
through `wearable-storage-migration.test.ts` and `device-import.test.ts` above.

### Assistant runtime

```sh
pnpm --filter @murphai/assistant-runtime exec vitest run test/hosted-runtime-cold-ingests.test.ts test/hosted-runtime-artifacts.test.ts test/hosted-runtime-idle-maintenance.test.ts --no-coverage
pnpm --filter @murphai/assistant-runtime exec vitest run test/hosted-runtime-workspace-runner.test.ts test/hosted-runtime-workspace-entrypoint-restore.test.ts test/hosted-runtime-workspace-entrypoint-receipts.test.ts --no-coverage
pnpm --filter @murphai/assistant-runtime exec vitest run test/hosted-runtime-workspace-runner.test.ts --no-coverage
```

PASS: first group 78 tests, restore/receipt files 55 tests, final runner rerun 161
tests. The initial runner group failed three historical device-import fixtures:
the new write guard used wall time instead of the invocation's existing clock.
It now uses `input.now`; all runner tests pass. The first standalone new cold test
run also failed four fixtures with invalid synthetic ingest IDs; fixtures were
corrected to the contract's `xfm_` namespace.

Coverage includes exclusion of closed months/current-month inclusion, sparse
re-checkpoint, no eager idle download, missing/hash/size failures, repairing corrupt
local bytes, successful lazy reads, complete archive validation and old inline
history without a catalogue.

### Cloudflare and privacy

```sh
pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/runtime-media-upload.test.ts apps/cloudflare/test/runner-user-data-cleanup.test.ts apps/cloudflare/test/user-data-delete-r2-drain.test.ts apps/cloudflare/test/workspace-snapshot-local.test.ts apps/cloudflare/test/container-workspace-restore-preparation.test.ts --no-coverage
pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/runtime-media-upload.test.ts apps/cloudflare/test/runner-user-data-cleanup.test.ts apps/cloudflare/test/workspace-snapshot-local.test.ts --no-coverage
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/murph_test MURPH_TEST_POSTGRES_CONCURRENCY=1 pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/hosted-cold-ingest-migration.test.ts apps/web/test/browser-vault-export.test.ts apps/web/test/hosted-account-deletion-cleanup.test.ts --no-coverage
```

Final PASS: 56 tests in the three rerun Cloudflare files, plus 6 in the other two
files from the original run; Web 27 tests. The first Cloudflare run failed one new
assertion that prohibited every GET, including the pre-existing secret-absence
probe. It now specifically asserts no cold-object GET; the deletion test passes.

The Cloudflare suite includes an actual encrypted tar.zstd sparse snapshot restore
followed by a verified lazy read; encrypted media roundtrip rejects wrong kind,
hash, size and member. The PostgreSQL test applies the actual migration to a
session-local temporary shadow table and verifies all expiry states. It does not
alter the shared database's persistent tables or use production credentials.

### Final static checks

```sh
pnpm complexity:diff
git diff --check
```

PASS. 18 changed source files, no new complexity debt. Privacy review checked the
added diff and new files for personal identifiers and home paths. No real member
payloads, screenshots or transcripts were copied into fixtures. No production
benchmark, hosted rollout, full CI or ReviewGPT was run: this task explicitly
prohibits pushing or opening a PR.

## Files changed and source size

36 files total: 18 source files, 11 test files, one SQL migration and six docs.
Source-only diff: **+245 / -34, net +211 lines**, including new untracked source
files; excludes tests, SQL and documentation.

Source:

- `apps/cloudflare/src/bundle-store.ts`
- `apps/cloudflare/src/runner-outbound.ts`
- `packages/assistant-runtime/src/hosted-runtime/canonical-write-media.ts`
- `packages/assistant-runtime/src/hosted-runtime/idle-maintenance.ts`
- `packages/assistant-runtime/src/hosted-runtime/media-references.ts`
- `packages/assistant-runtime/src/hosted-runtime/platform.ts`
- `packages/assistant-runtime/src/hosted-runtime/workspace-runner.ts`
- `packages/core/src/index.ts`
- `packages/core/src/integration-ingest-cold-storage.ts`
- `packages/core/src/integration-ingests.ts`
- `packages/core/src/junction-hr-zone-repair.ts`
- `packages/core/src/vault.ts`
- `packages/core/src/write-policy.ts`
- `packages/hosted-execution/src/runtime-media.ts`
- `packages/runtime-state/src/assistant-local-state-descriptors.ts`
- `packages/runtime-state/src/hosted-bundles.ts`
- `packages/runtime-state/src/hosted-media-references.ts`
- `packages/runtime-state/src/node/index.ts`

Tests:

- `apps/cloudflare/test/runner-user-data-cleanup.test.ts`
- `apps/cloudflare/test/runtime-media-upload.test.ts`
- `apps/cloudflare/test/workspace-snapshot-local.test.ts`
- `apps/web/test/hosted-cold-ingest-migration.test.ts`
- `packages/assistant-runtime/test/hosted-runtime-artifacts.test.ts`
- `packages/assistant-runtime/test/hosted-runtime-cold-ingests.test.ts`
- `packages/assistant-runtime/test/hosted-runtime-idle-maintenance.test.ts`
- `packages/core/test/integration-ingest-cold-storage.test.ts`
- `packages/hosted-execution/test/runtime-media.test.ts`
- `packages/query/test/query-projection-storage.test.ts`
- `packages/runtime-state/test/hosted-media-references.test.ts`

Migration and docs:

- `apps/web/prisma/migrations/20261102120000_hosted_cold_ingest_media/migration.sql`
- `ARCHITECTURE.md`
- `agent-docs/RELIABILITY.md`
- `agent-docs/SECURITY.md`
- `agent-docs/index.md`
- `docs/hosted-account-data-deletion-export.md`
- This implementation report.

## Residual risks and operating limits

- Rollout must exclude older readers after publication; there is no dual-format
  fallback. Existing inline snapshots need no migration.
- Only unambiguous Brotli monthly files externalize. Other representations stay
  inline until existing idle maintenance converts them within its normal budget.
- A broad historical repair/migration can download all closed months. It runs
  lazily, but is not a metadata-only historical query optimization.
- Unbound local readers of sparse workspaces fail retryably until a caller supplies
  the scoped materializer or restores verified files. No local secret-dependent
  download path was introduced.
- Cold history is durable member data. Account deletion covers it, but ordinary
  image/video expiry does not reclaim it. Storage savings are on restore transfer,
  not total retained ciphertext.
- Full raw-history account export remains an operator/library workflow; Settings
  continues to export its existing dashboard contract. A missing cold object cannot
  produce a purportedly complete v2 archive.
- No changes to query.sqlite, projection rebuild policy, dependency manifests,
  lockfile, production object lifecycle configuration or member-facing prompts.
Completed: 2026-11-02
