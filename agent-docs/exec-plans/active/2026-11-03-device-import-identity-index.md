# Device import identity lookup without repeated history rebuilds

Status: active — implementation plan only; no implementation authorized by this task.
Created: 2026-11-02
Source baseline: `7ebfff430b8bb5b74153c72a7848e13edec19c37`

## Outcome and recommendation

Keep device import identity, revisions, evidence ownership, member edits and repair
decisions identical while removing repeated whole-ledger parsing, validation and
fingerprinting from ordinary imports. Foreground reply completion must remain
responsive during both warm imports and initial index construction.

Recommend **option C: one core-owned, rebuildable identity lookup projection**,
updated from committed import writes and fenced against other ledger mutations.
Use existing runtime-state SQLite primitives, not query.sqlite or a new dependency.
Query only incoming identity dependencies and their complete historical owners.
Use option A's raw-field filtering for bounded recovery/alias-history reads and
option D's existing preparation abort/retry mechanism for foreground protection.
Do not introduce another queue, service, canonical generation file or scheduler.

A raw filter alone is smaller, but still parses every historical JSON row on every
cache miss; it cannot pass the unrelated-record-visitation regression below.
Calendar shard restriction is incorrect without an identity-to-shard lookup.
A serialized copy of the entire in-memory index also retains O(history) decode
cost; indexed lookup, rather than simply persistence, is the necessary property.

The main risk is an incomplete or stale dependency closure silently authorizing
dedupe, revision repair or alias consolidation. The ledger remains authoritative;
missing, stale, incompatible or corrupt derived state must rebuild, never mean
"no owner." Do not weaken existing refusal paths to obtain a performance result.

## Evidence and current ownership

- The supplied E5 investigation attributes the dominant import cost and competing
  foreground persistence delay to event identity indexing. Its synthetic overlap
  experiment supports the mechanism, not an exact production latency prediction.
  The supplied weekly aggregate is roughly nineteen thousand imports and fourteen
  import-execution hours. No production queries were repeated for this plan.
- `packages/core/src/mutations.ts:7268` requires the canonical write lock;
  `:7306` prepares the batch before identity lookup; `:7325` requests context for
  events **or authoritative sets**, including an empty authoritative snapshot.
  `:3602` lists all event shards; `:2341` validates every row and `:2394`
  fingerprints every device row with an external reference.
- The premise "every import rebuilds" has an exception: `:7332` reuses a
  drain-local baseline if the ledger fingerprint and dependency-disjointness
  checks pass. `:3388` fingerprints shard metadata, and `:8285` records changed
  dependencies after publication. Overlap, another writer, a new drain or a
  failure loses reuse. `packages/device-syncd/README.md:305` owns that contract.
- `packages/core/src/mutations.ts:8240` makes publication non-interruptible once
  started. The existing canonical batch, receipt replay and write lock retain
  authority; index updates cannot turn a committed write into apparent failure.
- `packages/query/README.md:3` owns query.sqlite as a read projection;
  `packages/query/package.json:73` already depends on core. Core importing query
  would reverse that dependency. `packages/runtime-state/src/sqlite.ts:43` exposes
  the existing lower-level SQLite opener and migration boundary.

## Every EventExternalRefIndex field and its decisions

The type is at `packages/core/src/mutations.ts:2277`. References in this table are
to that file. Keep the existing comparator and tie/order behavior, including
physical paths; do not substitute maximum provider timestamp for spine ordering.

| Field | Meaning and consuming decision |
| --- | --- |
| `aliasRepairContaminatedEventIds` | IDs recovered from schema-rejected rows (`:2343`); `:3960` refuses automatic alias repair if either owner has rejected history. |
| `aliasRepairContaminatedRefKeys` | Recoverable references on rejected rows (`:2348`); `:3961` refuses repair even if the rejected row has another/missing ID. |
| `aliasRepairHistoryById` | Lazily loaded, bounded full revision entries (`:2497`, `:3624`); `:4053` proves complete, unique, contiguous history; `:4211` compares initial owners and subsequent evolution before merging overlays. The loader currently validates unrelated rows before testing the ID (`:2510`). |
| `liveOwnerIdsByRefKey` | All non-deleted owners after global per-ID collapse (`:2457`); `:3873` and `:3916` require exactly one owner per alias and two distinct owners, rather than trusting a single winning row. |
| `junctionSparseDayHistoryById` | Highest and preceding distinct spine revisions' days (`:2364`); `:2026` adds the immediately displaced day to calendar refresh targets, including exact delivery replay at `:7610`. |
| `deviceOwnerRevisionsByRefKeyAndFingerprint` | Historical ref → content fingerprint → owner → revision set (`:2390`); `:4561` proves historical delivery ownership after identity moves; `:4438` finds WHOOP's earliest provider baseline, including pre-sleep-type fallback, to preserve member edits. |
| `junctionNoIdProfilePredecessorsByScope` | Indexed provider predecessors grouped by Junction source scope (`:2479`); `:3519` reserves an implicit predecessor and rejects ambiguous/equal-version conflicting claims, even when the incoming ref differs. |
| `latestByRefKey` | Winning current owner plus its provider baseline and physical path (`:2437`, `:2472`); `:4475` resolves primary/legacy identity, `:3492` reserves legacy refs, `:4961` retracts omitted authoritative facets, and `:5280` onward reconciles replay/rescore conflicts. |
| `latestById` | Globally latest row, including member edits without a ref and tombstones (`:2435`); `:4604` detects physical prepared-ID occupancy, `:4616` handles ref-less input, `:4633` resolves historical owners. |
| `maxRevisionById` | Maximum valid spine revision (`:2356`); `:3693` and `:4058` check completeness; `:4350`, `:5002`, `:5300` allocate revisions above every existing revision, including ref-less edits. |
| `revisionsById` | Actual set of valid revision numbers (`:2360`); `:3694` and `:4059` reject gaps, while `:7879` refuses repair into an occupied revision. It cannot be replaced by a row count. |

`legacyReservations` is outside the index (`:3211`): `:3447` builds it across the
whole incoming batch; `:3458` rejects competing incoming claims, and `:4477`
prevents another primary entry stealing a reserved legacy identity. Keep it
batch-local and rebuild it after floating-time resolution (`:7369`).

The same full index builder also serves ordinary event imports (`:5572`), whose
source-parent/facet operations at `:5474`, `:5502`, `:5524` have different
dependency scopes. Do not silently give those callers a device-scoped index.

## Shards and the necessary lookup closure

`packages/core/src/domains/events/ledger.ts:342` selects the month from
`occurredAt`; `packages/core/src/jsonl.ts:16` normalizes the timestamp and uses
its UTC year/month. This is neither import/write time nor necessarily `dayKey`.
Floating Junction resolution can change the destination month after identity
resolution (`packages/core/src/mutations.ts:3022`). Provider revisions append at
the incoming path (`:5791`); preserved member overlays can retain another path
(`:4736`). Tombstones can use the existing owner's path (`:5019`).

Consequently one event ID can span months, and two live IDs claiming a reference
can occupy different months. Existing evidence includes
`packages/core/test/device-import.test.ts:9244` (member edit moves shards),
`:9936` (repair missing earlier month), and `:12437` (cross-month duplicate owners).
No invariant restricts a corrected provider event to the incoming month or a
fixed lookback window. Date bounds would miss late corrections and tombstones.

Start lookup from prepared IDs, primary and explicit legacy ref keys, Junction
no-ID profile scopes and authoritative resource/facet-prefix scopes. Reuse the
dependency semantics at `packages/core/src/mutations.ts:3242` and `:3269`.
Ref keys deliberately omit version (`:1933`); facet and source scope remain
significant. Include omitted authoritative facets, not just supplied events.

Resolve all historical owners of those references/scopes, then complete history
for each owner ID across every shard. Include moved references, no-ref member
revisions, deleted owners, historical content owners, rejected-row contamination
and competing current owners of discovered relevant refs. Expand until closure;
newly discovered owners cannot be assumed complete after one forward pass.
Preserve input order and in-batch transitive alias migration. Resolve floating
timestamps only after finding the accepted provider baseline.

The **semantics** require complete history for this closure; they do not require
revalidating all unrelated event identities. Global discovery currently needs all
shards only because no durable locator exists. Alias repair needs bounded full
rows for its two owners; sparse refresh needs two historical days; ordinary
dedupe needs current/baseline rows plus historical ownership proof. Initial
projection construction and unrestricted whole-vault dedupe remain global work.

## Cold-storage finding

The brief's "old event months are lazy cold" premise conflates two ledgers.
`packages/runtime-state/src/hosted-media-references.ts:27` recognizes cold paths
only under `ledger/integration-ingests/`. Event/audit months are locally
compressed archives, as documented at `ARCHITECTURE.md:2778`.

The identity call chain is `mutations.ts:3602` →
`packages/core/src/event-ledger-storage.ts:17` →
`packages/core/src/jsonl-shard-storage.ts:133` / `:336`. It enumerates local
files, reads/decompresses shard bytes and parses each row (`:349`, `:367`).
It does **not** call `materializeIntegrationIngestHistory`. Thus it repeatedly
decodes local archived event history, but does not by itself download every
cold integration-ingest month or detach cold references.

`packages/core/src/integration-ingest-cold-storage.ts:28` verifies/downloads
requested receipt archives. `packages/assistant-runtime/src/hosted-runtime.ts:1445`
provides its invocation-local materializer; it is a capability, not eager thaw.
Full receipt enumeration at `packages/core/src/integration-ingests.ts:2311`
does materialize all cold receipt months. Ordinary identity import instead uses
target-month receipt inspection (`:693`, `:700`); even its `fullScan: true`
fallback at `packages/core/src/mutations.ts:7625` expands the target receipt
shard scan, not the month set. Actual append thaw/detach is separately owned at
`packages/core/src/integration-ingest-cold-storage.ts:55`.

Keep this distinction in measurements: event archive bytes decoded, receipt
materialization bytes and receipt reference detachments are different operations.
No cold-storage protocol or rollback-floor change is needed for identity lookup.

## Options and tradeoffs

### A. Filter raw objects before contract validation and fingerprinting

Perform cheap structural ID/ref/scope checks before `safeParseContract`; retain
rejected-row identity handling. A discovery pass finds owners, followed by
complete-ID passes. A one-pass incoming-ref filter is incorrect: a later row can
remove/change the ref, and the owner may first be discovered after its relevant
row was already visited. A fixed-point scan or retained lightweight locator is
needed for complete closure. No substring match can safely replace JSON field
parsing: escaping, nested values and malformed records matter.

Crash/retry/restore naturally recompute from the ledger under the existing lock;
no persisted schema or deployment skew is added. Old/new runners and snapshots
remain compatible within today's cold-storage floor. It still decompresses and
JSON-parses all event history, possibly several times; validation/fingerprinting
becomes proportional to matched history. Cold receipts are unchanged. Complexity
is modest for a prefilter, materially larger for correct discovery closure.
Useful fallback optimization, insufficient for the full visitation target.

### B. Restrict reads to incoming date shards

Unsafe for the counterexamples above. Crash or replay can then mint duplicates,
reuse revisions or erase member overlays; later imports need not converge back.
No deploy ordering fixes missing historical authority. It saves I/O and local
archive decoding and adds little code, but fails correctness. Restricting reads
using a verified identity locator is safe; that is a consequence of C, not a
calendar-window shortcut. Cold receipt behavior otherwise remains unchanged.

### C. Persist a derived identity lookup, updated on write

Use a single proposed `.runtime/projections/device-event-identity.sqlite`, owned
by core, with `PRAGMA user_version` and a semantic reducer/fingerprint version.
Use existing runtime-state SQLite APIs. Keep canonical truth in the event ledger.
Do not make device import depend on query.sqlite freshness, projection rebuilds
or query's core dependency. A monolithic JSON map loses on whole-file decode and
rewrite cost even when logically "cached."

The projection needs indexed per-shard contributions and ID/ref/scope locators:
latest overall/external/device-baseline entries with physical ordering; revision
membership; historical fingerprint/owner/revision membership; sparse-day history;
invalid-row contamination; and bounded alias-history locators. Preserve duplicate
revision multiplicity for alias refusal. Keep full historical bodies in the
ledger, except the current/baseline rows required by reconciliation. Load alias
rows only for proven candidates, with the existing revision cap plus an overflow
sentinel; compressed reads may still decode the candidate shard. Index queries
must serve closure lookups without loading all summaries into JavaScript.

Under the existing canonical lock, compare the complete shard inventory and the
local stat tuple already used at `mutations.ts:3388`. Generation/version and
completed-inventory metadata must agree before serving decisions. Include new,
deleted, replaced, truncated and re-archived shards. Record content fingerprints
when building changed contributions; do not hash every unchanged shard per import.
Filesystem metadata is a local invalidation fence, not portable content proof.

For successful imports, update contributions from **actual committed append
entries**, including repairs, tombstones and member overlays; publish their new
fence in one short SQLite transaction after ledger publication. Canonical failure
or index-update failure invalidates reuse. A post-commit cache failure does not
fail the successful canonical result. Other canonical writers and old binaries
may omit this fast update: the next stat/inventory comparison rebuilds changed
shard contributions and recomputes all affected owner/ref aggregates, including
removing obsolete maxima, contamination and revisions. Never merely append to a
stale summary or stamp the whole inventory fresh after an unproved write.

Build replacement contributions off the active generation, check source stability
and commit only complete generations. A crash before/after either publication,
receipt rollback, archive replacement or corruption causes reconciliation from
ledger bytes on the next access. Aborted incomplete work cannot authorize absence.
Malformed JSON/archive errors must retain today's failure behavior; a corrupt
unrelated shard cannot disappear because no incoming key selected it.

Initially classify this as machine-local, disposable projection state, explicitly
exclude DB/WAL/SHM from portable snapshots and reset it on workspace replacement.
Register its lifecycle with runtime-state; do not assume the special query paths
at `packages/runtime-state/src/hosted-bundles.ts:55` cover a new file. A cold restore
therefore pays one rebuild, then imports across drains reuse it. This consciously
does not promise zero cold-start history cost. Old runner + new snapshot sees
unchanged canonical shapes; new runner + old snapshot rebuilds. An old writer
against a warm workspace invalidates the new cache through shard metadata.
Keep the existing cold-ingest reader floor; this adds no canonical rollback floor.

Cost: initial O(history), steady O(shard metadata + touched identity closure +
new committed rows), and recovery O(changed shard rows + affected summaries).
Alias repair can decode its bounded set of candidate archives. Storage grows
with identities/revisions/fingerprints, not with new files per event. Measure and
set a byte budget before shipping; over-budget caches are disposable and fall
back to canonical work with foreground preemption, never truncate identity proof.
No history TTL may remove facts still needed for replay. Local private-data and
account-deletion rules apply; no cache records or identifiers enter telemetry.

Net complexity is higher than A but addresses the actual repeated-scan cost.
Reuse one reducer/comparator rather than implementing a second reconciliation
policy. Replace the drain-local WeakMap/dependency-change cache once equivalence
is established, including obsolete session plumbing in core/importers/device-syncd;
do not retain two competing caches. Retain a full-ledger builder for recovery
and unrestricted callers, not a second business-rules implementation.

### D. Cooperatively pause/resume import work during foreground turns

Complement only: this changes scheduling, not O(history) work or weekly CPU cost.
Extend the existing import-preparation admission lifecycle through post-model
finalization where necessary (`hosted-runtime.ts:4519` currently closes it at
provider start; `:2428` applies a 30-second admission limit). Use cancellation and
the existing retained-snapshot retry path described in
`packages/device-syncd/README.md:313`; never park a paused importer holding the
canonical lock while foreground tools need it. Resume by reacquiring the lock and
checking ledger/index freshness. Do not replay a committed publication.

Yield/check before and between bounded parse/reduce/SQLite batches; measure large
archive decode as well as row callbacks. Preserve atomic publication and existing
durable job acknowledgment. Crashes retry canonical work; partial cache builds
remain unusable. No persisted protocol change means old/new snapshot combinations
stay valid, although old warm runners retain their latency until converged.
Cold rebuilds benefit from preemption; receipt thaw still follows its current
owner. Sustained foreground traffic can delay imports, so retain explicit bounded
wait/fairness policy and test eventual drain. This adds modest lifecycle complexity
if existing hooks suffice; reject a second foreground scheduler.

## Ordered implementation and proof plan

1. Establish deterministic synthetic fixtures and counters against this exact
   baseline before changing production code. Use 1k, 10k and 100k unrelated event
   rows, both within the same month and across many months, while holding incoming
   events and relevant owner history constant. Exercise no session, new drain,
   overlapping import, exact replay, authoritative-empty input and cold restore.
   Count rows visited, JSON parsed, contract validated, fingerprinted, archive
   bytes decoded, shard stats, lookup rows returned and rebuild/cache hits.
   Today ordinary cache misses scale with all historical records; that is the
   failing regression. Keep diagnostics numeric and synthetic.
2. Compare every relevant index field and resulting import decisions against the
   existing builder, including reversed row/month order, same-revision duplicates,
   missing shards, ref removal/movement, conflicting historical owners, rejected
   rows, legacy reservations, source-instance profiles and omitted facets. Preserve
   output evidence/receipt mappings and atomic refusal, not just final row counts.
3. Implement the core-owned projection and lifecycle exclusion, then incremental
   updates and changed-shard recovery. Preserve unrestricted event-import callers.
   Require warm fixed-input tests to visit/validate/fingerprint **zero unrelated
   event records**, including after a preceding import changes the current month.
   Shard-stat work may grow with month count; expose that separately. Recovery and
   alias archive decode costs are explicit exceptions, never hidden cache hits.
4. Inject crashes before/after ledger publication, during index publication and
   after receipt rollback; delete/corrupt the projection, change schema versions,
   restore an older snapshot and run an old writer followed by a new reader.
   Compare all outcomes to a fresh full rebuild. Prove no private projection file
   enters snapshots, exports or logs, and deletion removes the local file.
5. Reproduce E5's real importer plus finalizer overlap using synthetic history and
   real persistence. Include cold construction and changed compressed shards.
   Start foreground work while indexing is actually active, not after completion.
   Assert preparation releases the canonical lock on preemption; foreground tools
   can write; resume/revalidation converges without duplicate publication. Use a
   deterministic maximum-work-between-yields assertion plus container-equivalent
   timings. Proposed timing gate: p95 added direct-reply finalization latency at
   most 100 ms across the history sweep, with hardware/baseline recorded. This is
   an acceptance target, not a result already obtained. Exclude intentional group
   draft grace and provider/network latency from the persistence-tail comparison.
   If it fails, refine existing D hooks before claiming completion.
6. Update core/device-sync owner docs, architecture and runtime-state lifecycle
   registration with the implemented contract; retire redundant session state.
   Perform focused tests/typechecks and required exact-head CI/review for the
   eventual implementation PR. This planning task creates no PR or deployment.

### Existing suites that must remain green

- Core: `device-import.test.ts`, `device-import-session.test.ts`,
  `device-import-preparation.test.ts`, `device-import-preemption.test.ts`,
  `import-device-batch-validation.test.ts`, `import-event-batch.test.ts`,
  `import-event-source-facets.test.ts`, `event-ledger-storage.test.ts`,
  `event-ledger-interruptible.test.ts`, `compressed-ledger-storage.test.ts`,
  `integration-ingest-cold-storage.test.ts`, `integration-ingests.test.ts`,
  `canonical-write-lock.test.ts`, under `packages/core/test/`.
  Replace cache-implementation-specific expectations only when the underlying
  no-rescan/visibility/refusal behavior is proved by the new tests.
- Provider alias proof: `packages/importers/test/device-providers.test.ts:2299`
  through `:3152` covers consolidation, disjoint/reciprocal plans, member overlays,
  evidence, malformed-history refusal and atomicity. Core sparse-day cases start
  at `packages/core/test/device-import.test.ts:7771`; cross-month and complete-spine
  recovery cases listed above must retain full coverage.
- Runtime: `hosted-runtime-concurrent-device-import.integration.test.ts`,
  `hosted-runtime-device-single-snapshot.test.ts`,
  `hosted-runtime-device-import-admission.test.ts`,
  `hosted-runtime-cold-ingests.test.ts`,
  `hosted-runtime-cold-ingest-system-mailbox.test.ts` under
  `packages/assistant-runtime/test/`, plus
  `packages/assistant-engine/test/turn-finalizer-persistence-timing.test.ts`.
  Add runtime-state lifecycle/snapshot proof for the proposed projection.

Run named suites using `pnpm --filter @murphai/<package> exec vitest run --config
vitest.config.ts --no-coverage <test paths>` and typecheck each changed package
with `pnpm --filter @murphai/<package> typecheck`. Prepare compiled runtime-worker
dependencies as documented in `packages/assistant-runtime/README.md` before its
integration suites. Consult the current testing map for implementation CI and
the assistant verification skill if foreground behavior changes. No runtime test
or typecheck result is claimed by this plan-only task.

### Post-deploy acceptance, for a separately authorized implementation

Compare matched seven-day windows by release/provider/resource, batch size and
warm/cold/cache-rebuild state. For each of the three privately specified cohorts
in the task brief, report `importExecutionMs` p50/p90 and identity-index elapsed
time; retain the cohort mapping only in authorized private diagnostics. Also
report total weekly import hours and hours per thousand imports so traffic changes
cannot masquerade as speedups. Keep member identifiers out of repository content.

Measure post-model persistence/finalization tails with and without concurrent
imports, separately from intentional group-draft grace. Track cache-hit rate,
rebuild reasons, unrelated rows processed, archive bytes, cold receipt download
bytes, failed/retried imports, revision/alias refusal rates and queue-drain lag.
Require lower matched-cohort p50/p90 and aggregate normalized CPU cost, bounded
overlap tails and unchanged correctness/error outcomes; no numerical production
speedup is promised before measurement. Check after warm-runner convergence and
again after cold restores. Recovery regressions block rollout even if speed wins.

## Planning-task completion

Only this plan is to be written and locally committed, as explicitly requested.
It stays active for future implementation; do not archive it or modify the docs
index in this one-file task. No source/config changes, push, PR or deployment.
Review citations, privacy and whitespace, then run applicable documentation
checks. The skill-referenced coordination ledger is absent in this checkout;
no implementation coordination or source-edit workaround is being attempted.
