# `@murphai/core`

Workspace-private canonical mutation owner for vault initialization, filesystem primitives, audit emission, domain mutation APIs, and current-format vault validation. No other package may mutate canonical vault data directly.

`@murphai/core/event-read` is the semantic canonical event-read surface. It
exports only the existing `readEvent` and `readOwnedEvent` functions and their
input/result types. Both are the same implementations exported by the root;
ledger scanning, validation, ownership, lifecycle and freshness stay at their
existing owner. The entry deliberately bypasses the root and events barrels,
without splitting the ledger or introducing another reader. See
[the assembled CLI experiment](bench/README.md#cold-cli-event-read-import-experiment)
for the measured-work acceptance boundary.

Reads by exact event id, and by meal or document owner id, parse a closed-month
archive only where a row's text holds the id. Archives are parsed in full before
they are written, so rows that cannot match are skipped unparsed. The plain
current-month shard is always parsed in full. An id outside `[0-9A-Za-z_-]`, or
an archive that holds a `\u` escape, falls back to the full parse, and a
malformed row that holds the id still fails the read with its line number.

Device imports cache ID/evidence byte offsets for one resident plain ingest month.
The canonical lock, vault identity and shard inode/size/mtime/ctime fence reuse.
Committed appends advance it; other changes, restore, failed publication, month/archive changes or capacity overflow invalidate it.
Duplicate IDs, malformed/archived histories and invalid selected rows use the slow path; offset reads validate candidates.
`ingestInspectionElapsedMs` measures inspection plus evidence and late-ID lookups.
`ingestInventoryCacheHit` reports complete inventory reuse through importer, sync and hosted diagnostics.

Core retains one event-identity index across drains in the same process, under
the existing canonical write lock. Vault identity and shard metadata fence reuse;
committed append payloads are replayed on the next cache use through the same row
reducer used by a cold build.
Unobserved writes, replacement, import failure, reducer failure, or more than
100,000 ledger rows evict the cache. Alias repair histories remain request-local,
and returned event records cannot mutate resident state. There is no persisted
index or caller session token.

The session suite's opt-in `MURPH_IDENTITY_BENCH=1` case measures two imports
over 70,000 valid synthetic rows.

See [the Docker CPU benchmark](bench/README.md) for synthetic import profiling
and one-/two-vCPU comparisons without production credentials.

Scheduled meals inherit a saved food's title when it satisfies the meal-name
contract. Older food titles that do not satisfy that contract retain the default
meal name and the full food title in the note, so existing schedules still run.

## Device publication receipts

Automatic `importDeviceBatch` publication writes the ingest, events and samples
atomically without a second `device_import` success audit. Applied results retain
`ingestId`/`ingestShardPath` and return `auditPath: null`. Historical audits and
explicit user mutation/repair audits remain unchanged. The optional outer ingest
`publication` field retains skipped-duplicate, superseded and retracted counts;
it is not provenance, delivery identity, or ordinary receipt outputs. Old receipts
without this field remain valid and authorize exact no-op retries. Inspect a
receipt through `vault-cli audit receipt <xfm_id>`, using the existing validated,
archive-aware core reader without globally indexing retained evidence.

Deploy the contract reader and writer together in the runtime bundle before any
new receipt is written. Earlier strict readers cannot read the new optional field;
a workspace containing it must stay on this reader version or newer, including
restore and rollback. Old snapshots and old-producer receipts remain readable by
the new bundle. Historical audits are not rewritten or reclaimed by this change.

## Interrupted append recovery

A prepared JSONL append may have written a prefix even when its filesystem call
rejects before the action becomes applied. Rollback includes that prepared state,
checks the durable base receipt and the staged payload prefix, then restores the
original size (or removes a newly created shard). Unexpected content or a failed
restore leaves the operation failed with its staged recovery evidence intact.

## Audit shard storage

Closed audit months use verified Brotli `.jsonl.br` archives through the same
core-owned JSONL storage implementation as event ledgers. Logical paths and audit
records do not change. Readers enumerate archive sources, and canonical late
appends, rollback and hosted receipt replay use decompressed content receipts.
Independent audit replay still reconciles exact record identities when a restored
history differs from the original append base. Conflicts and corrupt archives
fail closed; maintenance removes interrupted duplicate copies only after exact
byte verification. Current and future months remain plain.

Hosted idle maintenance archives event, audit and integration-ingest shards under
one existing time budget and yields to foreground work. The archive-aware readers
and writer ship together; once audit archives exist, restoring into an older
plain-only reader is unsupported. Query SQLite stays included in restore, and
audit-only physical changes remain outside its source freshness manifest.

`findEventsByExternalRefs` resolves a caller-bounded batch with two ledger scans,
reusing single-reference latest-record, moved-identity and deletion semantics.
Callers that couple this read to mutation hold the canonical write lock across both.

### Clinical raw evidence validation

Whole-vault validation recognizes the clinical manifest contract for FHIR
snapshots. It checks connection/retrieval path identity and the immutable hashes
of declared resource pages, downloaded documents, and batch predecessors. Nested
pages belong to their snapshot manifest; unbound files remain validation errors.
Clinical interpretation, patient binding, and pagination remain importer-owned.

## Write-operation journal retention

A successful `WriteBatch.commit` removes its staging tree and journal after
canonical actions, configured guard/hosted receipts, and configured hosted
persistence finish. A successful rollback does the same after persisting its
terminal state. Deletion removes the staging tree first and the journal last;
cleanup failure leaves terminal metadata for a later checkpoint cleanup.
Guard receipts, hosted receipts and hosted content-addressed payloads have
separate owners and are not removed by this cleanup.

The existing checkpoint pruner removes validated committed and rolled-back
records older than the previous successful checkpoint, including terminal records
with diagnostic errors. Its default history count and time retention are zero.
Staged, committing, failed, malformed and uncheckpointed records remain untouched.
Recovery still needs their action state, staged payloads, append baselines and
backups; terminal operations are explicitly excluded by inbox recovery. A missing
checkpoint leaves pruning inert. New successful local writes retire immediately
even without hosted checkpoints.

## Saved experiment outcomes

The exact `outcomeRef` and its immutable artifact own saved-result identity.
Readers verify the artifact path, experiment identity, timestamp and protocol
lineage; duplicated `outcome.latestOutcomeId` and `finalAnalysisStatus` are not
read authority. Missing or stale tracking does not invalidate a valid artifact.

Writers still publish those tracking fields for older supported readers. Remove
them only after every supported runner and rollback target accepts reference-only
documents. This reader-first change preserves old snapshots and does not rewrite
existing vaults or relax missing-artifact, revision or lineage checks.
