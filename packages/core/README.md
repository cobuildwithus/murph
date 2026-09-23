# `@murphai/core`

Workspace-private canonical mutation owner for vault initialization, filesystem primitives, audit emission, domain mutation APIs, and current-format vault validation. No other package may mutate canonical vault data directly.

Device imports reuse their prepared persistence plan under the canonical lock
when delivery history inspection is unchanged. Expanding a bounded
inspection to full history still rebuilds the plan before publication, preserving
exact-delivery replay and evidence-repair checks.

See [the Docker CPU benchmark](bench/README.md) for synthetic import profiling
and one-/two-vCPU comparisons without production credentials.

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
