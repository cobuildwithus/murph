# Source-list wearable projection reuse

Status: implementation handoff; independent parent validation remains required.
Base context: `5b4f8ac08d11afb546bd224f276fe85db02f10fe` plus the attached
uncommitted candidate and two attested fixture corrections. This revision is an
incremental patch against that attachment, not against pristine base. Parent owns
Git, PR/evidence, runtime execution and final acceptance. No historical plan is
modified. The attachment omitted the active-plan file referenced by the index;
this file supplies the current design at that existing indexed path.

## Outcome and cause

Source status must preserve exact public coverage/freshness/diagnostic semantics
while avoiding unnecessary global work and repeated provider reconstruction.
Parent measurements rejected request-local reconstruction: cold improved but
repeated calls and the 15-call cumulative workload regressed. No speedup is
claimed for this revision before independent execution.

## Final design

Use only the existing query SQLite owner and `query_wearable_summaries` table.
The exact complete canonical source manifest is encoded in one existing
`query_meta` entry, `wearable_source_manifest`. This is independently checked,
transactional derived metadata; no new table family/cache/database/service,
background work, dependency, ledger or canonical truth is introduced.

Source reads hold core's existing reentrant cross-process lock through manifest
capture, strict canonical reading when stale, provider derivation/encoding,
transactional row+manifest publication and stored-row capture. Subsequent reads
reuse stored rows. Global metadata/tables are untouched by partial publication.
Global freshness requires its own completed build and matching full manifest as
well as current wearables; even an empty manifest cannot certify unfinished
global work. Full rebuilds reuse an already-current wearable portion. SQLite
version 28 enforces the existing reset seam for older/newer rebuilders; builtAt
is not generation identity. A new partial store omits global tables, making an
older in-flight reader fail its existing global-table guard after a reset. Full
schema promotion and publication share one transaction. Transaction failures
roll back global DDL as well as rows and metadata;
strict errors and canonical commit/rollback visibility remain unchanged.

The failed uncached route and its shared generator/export are removed. Existing
stored codecs/composition remain the sole output path. The sourceHealthOnly
optimization and removal of discarded preliminary health work retain ordinary
stored-path parity tests. The attested lowercase `sourceKind: "observation"`
fixture correction and 18 projected/16 raw HRV assertions remain intact. The
public benchmark retains `fields.metric: "total-sleep-minutes"` for sleep import.

## Verification and product replay

Authored proof covers missing/stale/fresh/empty/legacy/future/unreadable stores,
missing/corrupt metadata, corrupt activity evidence, provider/date/limit filters,
corrections/deletions, exact ordinary stored output, no unrelated global work,
reuse counts, lock-held publication, concurrent/reentrant readers, canonical
commit/rollback, encoding/transaction failures and both read orders across writes.
Focused commands and the final benchmark contract are in
`packages/vault-usecases/bench/wearable-sources.md`.

The public benchmark retains two warmup plus seven alternating measured pairs,
15 primary source-only calls across no-write/unrelated-write/source-write,
fresh-index and invalidated-existing-index cases, complete response hashes/bytes
and cardinality. It adds fresh-process source->global and global->source cases,
each including writes/repeats, and times the accelerator's public global read.
Acceptance includes cold, repeated and complete composed/cumulative workflows;
repeated regressions are not accepted. No global warmup or moved work is hidden.

Member-facing changelog copy describes less waiting and unchanged source facts,
not index machinery. Public schemas, routing, provider/date/limit behavior,
ordering, provenance and staleness semantics are unchanged. Parent must replay
cold/repeated status, new sleep data, corrections/deletions, provider/date scopes
and switching between source status and other wearable reads before acceptance.

## Handoff limits

Supported-runtime tests, semantic typechecks, paired performance, web changelog
and authoritative complexity validation await the parent. Local checks passed
13-file TS syntax/transpilation, 28 actual schema/freshness/SQLite assertions and
14 PR changelog-validator tests; they do not establish public runtime parity. This container has Node 22.16.0 and no
workspace dependencies/lockfile; Frog is unavailable. No installation or external
communication is authorized. Local syntax/structural/patch-integrity checks do
not establish runtime parity or performance. Deliver the complete incremental
patch, SHA256 for the patch and resulting files, and inline gzip/base64 transport.
Keep this plan active until parent-owned independent validation and completion.
