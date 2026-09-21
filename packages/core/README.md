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
