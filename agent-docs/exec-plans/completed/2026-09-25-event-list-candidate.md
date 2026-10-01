# Event-list family-local implementation

Status: completed
exact-head CI are tracked in [PR #3728](https://github.com/cobuildwithus/murph/pull/3728).
Runtime base: `9da96b607e7ec04925abbc8a1fbb787a7bf7b880`
Parent-validated implementation head: `b0e51318d1b1fb0d81935a0868551fb015a0fba7`

This record supersedes the [baseline investigation](../completed/2026-09-25-event-list-baseline.md),
which remains immutable historical evidence. Validation and measurements below
are parent-reported. Final review/CI passes, merge and deployment are not claimed.

## Outcome and root cause

Previously, CLI `event list` reached integrated `query.listEvents`, then
`listEventRecords` and `listCanonicalEntities`; a missing/stale shared projection
forced unrelated global metrics, wearable summaries, search and SQLite publication.
The query-owned `listCanonicalEventEntities` now reuses a fresh index or rechecks
freshness under the existing reentrant canonical write lock and reads the strict
canonical event family. No new cache, schema, table, dependency or instrumentation
is added, and no other endpoint changes.

Selection/order, lifecycle collapse, default visibility, post-filter limits,
canonical commit/rollback exclusion and complete clean-vault outputs are preserved.
Malformed event JSONL retains `VAULT_INVALID_JSONL`; malformed unrelated goal
frontmatter is isolated while explicit global reads retain `QUERY_SOURCE_INVALID`.
Manifest/filesystem failures may still block a read. Production prompts and tool
schemas are unchanged.

The supplied production aggregates cover 2026-09-23T00:00Z–2026-09-26T00:00Z:
90 successful reported event-list calls totalled 273.6 s, maximum 22.7 s. The
preceding 72 hours had 160 successes totalling 244.4 s, maximum 24.9 s, and four
reported errors. The latest 32 full rebuild samples totalled 162.0 s. Four slow
single-command profiles totalled 56.4 s, including 51.2 s rebuilding and only
23.7 ms waiting for the lock. Their six typed subphases reported metrics 18.997 s,
source 8.732 s, wearable summary 8.934 s, dataset 4.997 s, publication 9.120 s and
search 0.189 s. Inclusive phases must not be summed with their parents.
Completed timing reports are not a census of unfinished attempts. No raw member
data or identifiers were queried.

## Verified implementation and assistant outcome

Parent validation passed 13 event-contract tests, 20 focused query tests including
cross-process cold/fresh commit and rollback, 19 CLI regressions, six benchmark
driver tests and 10 production changelog archive-render tests. Semantic typechecks
passed for query, usecases, the benchmark at both revisions and assistant-engine.
The CLI dependency-closure build passed: `pnpm --filter @murphai/murph... build`.
The complexity guard passed with zero source hotspots; reported maxima were 14
for query-projection and 15 for provider-event.

The focused journey `event-list isolation recalls two saved facts despite malformed
goal frontmatter` passed on `gpt-6-sol` / local subscription with production
assembled instructions and the generated CLI contract. It made exactly one
meaningful successful event-list read with kind/from/to/tag filters, no invalid
or unrelated calls, no canonical writes, no outbox and no query database. Parent
inspection confirmed a concise, truthful reply containing both synthetic facts
and no repair claims: UX **Ready**. The owner README retains the exact rerun
command and deterministic contract checks.

## Accepted isolated synthetic measurements

Node 24.14.1 / pnpm 10.33.0; the production public integrated service, with the
same immutable synthetic canonical vault and identical worker SHA256 at base/head:
`1e820f99a5f286ed3d0b043d5619b6e37b0151b52abdcd829d358334f2bae956`.
The fixture has three providers, 365 days, 8,760 observations and 365 notes.
Two warmup pairs precede seven alternating measured pairs. Each of the seven
scenarios has its own sequential subprocess at both revisions; only reads within
that scenario share module/JIT state. First workload imports and factory setup
are timed; process startup, seeding, DB removal and serialization/hashing are not.
Cold means absent query DB, not cold OS file cache. Warm-global setup remains in
the whole-sequence total; the three warm reads also have a separate subtotal.

All 702 complete envelopes matched in SHA256, UTF-8 bytes and count; the cold
sample contained 40 items / 25,057 bytes. Same-version isolated control scenarios
had median paired ratios 0.9901–1.0035. The following isolated results supersede
all earlier single-process scenario comparisons confounded by asymmetric global
projector warmup. Ranges are observed minima/maxima over seven measured trials
per revision, not confidence intervals. Ratios are medians of paired head/base
totals, not ratios of the marginal medians. All wall times below are milliseconds.

| Scenario | Base median [range] | Head median [range] | Paired ratio |
| --- | --- | --- | --- |
| Cold / 1 event read | 1479.76 [1453.04–1492.50] | 361.25 [351.84–397.77] | 0.24528 |
| 2 event reads | 1484.21 [1461.26–1517.12] | 417.56 [410.82–439.10] | 0.28304 |
| 3 event reads | 1477.92 [1476.73–1494.59] | 470.06 [455.99–495.34] | 0.31806 |
| 20 event reads (stress) | 1543.67 [1520.46–1557.65] | 1258.24 [1248.48–1299.48] | 0.81953 |
| Event/global/event/global | 1490.03 [1475.36–1556.62] | 1544.09 [1526.60–1554.04] | 1.03536 |
| Global then 4 event reads | 1504.34 [1484.88–1564.71] | 1499.18 [1481.90–1524.02] | 0.99401 |
| Global setup + 3 warm reads | 1481.63 [1466.18–1508.94] | 1517.70 [1476.76–1543.53] | 1.02052 |

All head event-only samples omitted global rebuild, metric projection, wearable
summary, search and publication phases. Mixed order adds 54.06 ms in the
whole-sequence median, consistent with an extra event read before the explicitly
requested global rebuild. Warm-global's three-read subtotal is 13.54 → 13.64 ms;
the table retains the full setup cost and its variation, not a zero-overhead claim.

## Acceptance and limits

The supplied initial-provider histogram has 60 one-call, nine two-call and four
three-call profiles. Only eight of these 73 also contain a named global reader;
cooccurrence establishes neither ordering nor shared intent. Parent accepts the
large synthetic 1–3-read improvement with the small measured mixed cost and
preserved warm reuse, without speculative caching.

Each stale read scans the event ledger again: scan work grows with ledger length
and repeats with call count. Enough repetition can amortize the old global
rebuild; the eventual crossover was not measured. The 20-read stress still wins
in this fixture but is not a bound for larger ledgers or longer sequences. These
are synthetic computation measurements, not production latency, model round-trip
or deployment speedup claims. Reproducible methods and commands remain in
`packages/vault-usecases/README.md`; final ReviewGPT and exact-head CI remain PR
completion gates separate from the accepted local proof.
Updated: 2026-09-28
Completed: 2026-09-28
