# Device import identity lookup without repeated history rebuilds

Status: active — step 1 locally verified, PR pending; steps 2 and 3 are separate follow-ups.
Created: 2026-11-02
Source baseline: `7ebfff430b8bb5b74153c72a7848e13edec19c37`

## Outcome and recommendation

Keep device import identity, revisions, evidence ownership, member edits and repair
decisions identical while removing repeated whole-ledger parsing, validation and
fingerprinting from ordinary imports. Foreground reply completion must remain
responsive during both warm imports and initial index construction.

Implement three separately reviewable changes in this order:

1. **Foreground protection through finalization and dispatch (in progress).**
   Re-arm the existing admission predicate at provider return, use the existing
   preparation abort/retained-snapshot retry path, and bound per-snapshot deferral.
2. **Core-owned warm in-memory identity cache across drains.** Replace the
   session/dependency-change plumbing. Maintain the cache from actual committed
   append-plan rows using one shared reducer; retain the full builder for cold
   construction and conservative invalidation.
3. **A2 two-pass locator/closure for the first import of an invocation.** Discover
   complete relevant history before semantic reduction, preserving contamination
   and physical ordering. Measure parsing, validation, hashing and copies separately.

**C is deferred.** The SQLite projection is excluded from hosted snapshots;
invocations restore fresh workspaces, so it would not avoid first-import rebuilds.
Warm reuse can be fixed in memory without a persisted schema or recovery protocol.
Do not add a scheduler, queue, feature flag or configuration knob.

The main risk is an incomplete or stale dependency closure silently authorizing
dedupe, revision repair or alias consolidation. The ledger remains authoritative;
missing, stale, incompatible or corrupt derived state must rebuild, never mean
"no owner." Do not weaken existing refusal paths to obtain a performance result.

## Evidence and current ownership

- Supplied three-day production aggregate: identity rebuilds taking at least
  two seconds cost **2.02 hours on the first import of an invocation** and
  **2.48 hours on later imports**. Fresh restored workspaces explain the cold
  component; drain-session misses explain repeated warm work. These are supplied
  aggregate facts, not new queries or a promised production speedup.
- E7's supplied local profile of a 69,584-row ledger: decompression **4%**,
  JSON parsing **11%**, schema validation **34%**, fingerprinting **26%**,
  bookkeeping **25%**. A2 addresses first-import validation/hashing; warm cache
  ownership addresses later imports. Step 1 protects reply latency only.

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

### C. Persist a derived identity lookup — deferred

A core-owned `.runtime/projections/device-event-identity.sqlite` could use the
existing runtime-state SQLite primitives, but this rebuildable subtree is already
excluded from hosted snapshots. It cannot remove first-import construction in a
fresh restored invocation. The smaller warm-cache change is preferred first.

If measurements later justify C, preserve the correctness obligations above:
complete inventory/stat fences, physical ordering and duplicate revisions,
rejected-row contamination, complete owner closure, actual committed append-row
reduction, atomic complete generations, and conservative invalidation after
unknown writers, failed updates, deletion/replacement, corruption or restore.
Canonical publication success must survive a failed cache update. The ledger
remains authoritative; missing derived state never means absent history.

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

### Step 1: foreground protection (in progress)

Outcome: keep reply finalization and dispatch responsive during identity rebuilds.
Reaches: ordinary and over-30-second provider turns, repeated conversation input,
pre-publication retries, and already-started atomic publication.
Proof: first add a regression on `9361875e83` with 32,000 synthetic historical rows.
Return the provider result while the real importer is indexing; run actual
transcript, turn-event and session persistence and dispatch through the hosted
outbox. Require at most 400 ms wall time between return and dispatch, allowing
bounded identity work before the existing abort poll. Prove canonical-lock
release, retained-snapshot retry, one publication, correct
acknowledgment, and an empty queue. Exercise sustained foreground traffic and
preserve publication-after-abort behavior.

Reuse the accepted-input release callback, which runs at provider return before
finalization, to re-arm the existing 30-second runtime window. Keep provider-start
and phase cleanup closure. Reuse the existing 100-ms service polling abort and
per-row signal checks, with an event-loop yield every 256 rows. No synchronous
preparation callback is needed across service, importers and core. Publication
keeps its original signal check immediately after the final preparation yield.

Fairness belongs to the existing retained-snapshot retry loop: at most 30 seconds
from its first deferral, then allow that snapshot's preparation through despite
new foreground windows. The deadline survives retries and is not renewed by new
conversation sequences. Ordinary job cancellation still applies. Publication is
never interrupted once started. This bounds admission delay, not total import
execution or synchronous archive-decode latency.

Run the brief's named runtime/core/finalizer suites, affected service/importer
proof, touched-package typechecks, and `pnpm complexity:diff --base origin/main`.
Review locally and commit via `scripts/committer`; no push, PR or deployment.
The overall plan stays active for steps 2 and 3.

### Step 2: core-owned warm memory cache

Retain the existing complete builder and per-ID reduction state. Update from
accepted append-plan rows after successful canonical publication through one
shared reducer. Remove drain/session tokens and changed-dependency bookkeeping.
Bound retention; conservatively evict on unknown writers, unexplained shard
changes, workspace replacement, failed updates or capacity limits.

Prove fresh-rebuild equivalence across drains, overlapping corrections, replay,
authoritative-empty imports, overlays, alias/historical repairs, equal revisions,
appends to earlier months, and invalidation/restart. Count identity work separately
from append-plan target-shard parsing and full-map context copies. A warm identity
hit must avoid unrelated identity validation/fingerprinting; do not claim that it
eliminates unrelated raw-ID reads by append preparation.

### Step 3: A2 cold locator/closure

Sweep 1k/10k/100k unrelated history with fixed relevant owners. Discover raw IDs,
references, Junction scopes, authoritative facets and contamination conservatively;
close over full owner histories before reducing in original traversal order.
Compare every relevant index field, public result, refusal code, receipt/evidence
mapping and atomicity against the full builder. Preserve malformed unrelated
JSON/archive failures and rejected reference recovery. Explicitly measure retained
bodies/buffers versus second-pass reads, archive decode, parsing, validation,
fingerprinting, reduction, copies and append planning.

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
  No projection lifecycle change is part of step 1.

Run named suites using `pnpm --filter @murphai/<package> exec vitest run --config
vitest.config.ts --no-coverage <test paths>` and typecheck each changed package
with `pnpm --filter @murphai/<package> typecheck`. Prepare compiled runtime-worker
dependencies as documented in `packages/assistant-runtime/README.md` before its
integration suites. Consult the current testing map for implementation CI and
the assistant verification skill for model-dependent behavior. Step 1 changes
only deterministic scheduling, with unchanged prompts, tools and reply content.

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

## Local implementation progress

Step 1 simplified regression evidence (E8b): both ordinary and 31-second
provider-result cases fail with the production sources restored to `9361875e83`.
The 32,000-row history, seeded through four bounded canonical imports, produces
680 ms and 656 ms provider-return-to-dispatch tails against the 400 ms bound (raised from 250 ms after a 246 ms pass on a loaded host).
The original E8 proof also showed both sustained-deferral service cases failing
past 30 seconds. No cache ownership or cold-locator implementation is included.

E8b removes the synchronous preparation callback throughout service, importers
and core, restoring core's original signal check before atomic publication.
The existing polling abort satisfies the measured latency requirement. Source
changes are net -31 lines versus E8, leaving net +16 lines versus `9361875e83`:
only provider-return re-arming and the retained-snapshot fairness deadline.

Step 1 local evidence after simplification:
- Runtime admission, concurrent import and single-snapshot suites: 49 passed.
- Core preparation, preemption and session suites: 11 passed, including
  non-interruptible publication after cancellation.
- Finalizer persistence timing: 2 passed; device-sync service: 202 passed.
- Importer validation and device-provider suite: 81 passed. Total: 345 tests.
- Core, importers, device-syncd, assistant-engine and assistant-runtime typechecks
  pass. `pnpm complexity:diff --base origin/main` passes, with no increase in
  runtime or service complexity debt. Existing hotspots need no new abstraction
  for these two scheduling changes.
- The focused overlap run and full runtime suites (four cases) record 121–171 ms
  from provider return to dispatch for ordinary and 31-second provider phases.
  This total tail also bounds the added import delay. The existing poll permits
  6,400–8,192 identity rows before cancellation; zero-row preemption is unnecessary.
  Timing assertions run outside the delivery stub so failures report directly.
  These synthetic local measurements are not production percentiles.
  The fixture keeps its invocation alive until the retained import reaches
  recording, then advances its fake idle clock. Exact publication,
  acknowledgment and empty-queue assertions remain unchanged.
- Both cases abort preparation, observe an unlocked canonical lock, persist real
  transcripts/turn events/sessions, dispatch once, retry the identical snapshot,
  publish once, acknowledge revision 7 and its exact payload, and drain the queue.
- Sustained real conversation sequences in default and system-mailbox modes keep
  runtime admission open while the retained import completes after its service
  fairness deadline. Separate service cases cover initially gated and interrupted
  snapshots and keep the fairness retry un-aborted during continued foreground work.
- Product UX: Ready for the tested deterministic timing/recovery paths. No model,
  prompt, tools or reply-content changes; no stochastic journey is needed here.
- Parent review covers the complete diff, publication boundary, deadline lifetime,
  removal of the optional callback, polling cancellation and privacy. No new
  Frog-worthy friction arose.
- Local-only candidate per brief: no push, PR, CI, external final review or deploy.
  The same implementation PR must add its member-facing changelog entry when
  prepared for shipping. This plan remains active for the sequenced work.
