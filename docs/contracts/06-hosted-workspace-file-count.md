# Hosted Workspace File Count

Status: frozen current contract

## Why This Exists

Hosted execution restores a local workspace from an encrypted snapshot, runs the
normal Murph runtime, then publishes the next encrypted workspace checkpoint.
That checkpoint path has to enumerate files, classify paths, stream a tar
archive, compress it, encrypt it, upload it, and later reverse that process on
restore.

Many tiny files are expensive even when the total byte count is modest. They
increase filesystem metadata work, broad directory walks, tar header overhead,
cleanup cost, and restore latency. They also make it harder to reason about what
state is portable, what is private, and what should be excluded from hosted
snapshots.

File count is therefore a hosted-runtime budget. New features should treat it
the same way they treat payload size, foreground latency, and secret exposure.

## Invariant

Routine hosted work must not create an unbounded number of files inside the
restored workspace. A new file family is acceptable only when it is one of these
things:

- canonical product truth owned by the vault contract
- durable operational continuity that must survive restore
- a bounded derived materialization with a documented rebuild or retention story
- temporary scratch state under an excluded cache or tmp path

If a side effect can happen once per message, turn, retry, token chunk, provider
sample, attachment part, log line, status update, or diagnostic event, it must
not map directly to one durable workspace file without a hard cap and cleanup
policy.

## Design Rules

- Prefer existing append-only JSONL shards, compact status documents, owner
  manifests, or SQLite stores over loose per-event files.
- Shard by coarse owner or time window, not by every observed event. Monthly or
  owner-scoped files are usually easier to snapshot than thousands of sibling
  event files.
- Batch, append, aggregate, sample, or coalesce logs and diagnostics. Logging is
  not a reason to create a new file for every runtime milestone.
- Keep generated and derived artifacts under an owner directory with a manifest
  and a bounded artifact count. Do not create open-ended sidecar trees.
- Put ephemeral intermediates under `.runtime/cache/**` or `.runtime/tmp/**`,
  and make their hosted snapshot exclusion and cleanup explicit.
- When many small facts need queryability, use a projection or store with a
  migration/compaction seam instead of loose files.
- When a file family must be durable, define its maximum expected file count per
  run, per user, or per retention window. Also define rotation, pruning, or
  compaction before the feature lands.
- Keep exact manifests or indexes where possible so snapshot planning can avoid
  broad discovery work.
- Do not use a separate artifact object or checkpoint sidecar for each raw file
  unless a concrete product or reliability requirement proves the single
  encrypted workspace snapshot is insufficient.

## Review Gate

Before adding any new write path under the restored workspace, answer these
questions in the implementation notes, docs, tests, or code comments near the
owner:

- What state class is this: canonical, durable operational, rebuildable
  projection, or ephemeral scratch?
- Is this path included in hosted workspace snapshots? If not, where is the
  exclusion enforced?
- How many files can one ordinary user action create?
- How many files can a heavy but expected user or provider history create?
- What bounds the file count over time: shard rotation, retention, compaction,
  cleanup, or a hard product limit?
- Can the same information fit in an existing shard, manifest, projection, or
  owner document?
- Does the verification prove the steady-state file count, not only the happy
  path bytes?

If the answer is "this may create many files, but checkpointing can handle it,"
the design is not complete. The checkpoint path is the reason this invariant
exists, not the place to hide unbounded write shapes.

## Preferred Shapes

Use these shapes first:

- one append-only JSONL shard for many small chronological facts
- one compact status JSON for latest-state operational facts
- one SQLite store for queryable rebuildable projections or explicitly owned
  durable operational state
- one owner directory with a small manifest and bounded artifacts
- one generated bundle or archive when the output is consumed as a unit

Avoid these shapes in routine hosted execution:

- one file per log line or telemetry event
- one file per mailbox row after the row already has durable hosted storage
- one file per provider sample, polling page, retry attempt, or cursor tick
- one sidecar file per token, chunk, small attachment part, or model event
- unbounded per-turn directories that are never compacted or pruned

## Relationship To Existing Contracts

This rule does not weaken canonical storage rules. Canonical vault truth still
belongs in the vault contract, and immutable raw evidence remains immutable when
the product needs it. The point is narrower: new runtime side effects, logs,
diagnostics, projections, generated files, and convenience artifacts must not
inflate the restored workspace into a large file tree that every hosted turn has
to walk, compress, encrypt, upload, download, decrypt, and extract.

## Write Family Lifecycle Decisions

This section records the explicit retention/compaction posture for write
families introduced after this contract froze. The 00-invariants rule
requires every new write family to document retention or compaction before
landing; record the chosen posture here so the decision is reviewable.

- `ledger/inbox-attachment-retention/YYYY/YYYY-MM.jsonl`
  (`murph.inbox-attachment-retention.v1`) is append-only and monthly-sharded,
  with no compaction. Each record is a small tombstone (~200 bytes) describing
  the deleted raw inbox attachment path, sha256, purge time, reason, and
  retained parser derivative. A heavy user adding roughly ten attachments per
  day produces about 3,650 records per year, well under one megabyte
  (~730 KB/year). This puts the family firmly in the "accepted unbounded-tiny"
  bucket: the monthly shard count is also bounded by elapsed wall-clock
  months. Snapshot/restore cost remains negligible at the projected steady
  state, so no rotation or compaction seam is planned.

- `derived/vault-share/projections.json`
  (`murph.shared-vault-projections.v1`) is the destination-side materialization
  for consented HostedVaultShare records. It is one compact JSON document per
  workspace, not one file per shared record. Each grantor/projection entry keeps
  only the latest `HOSTED_VAULT_SHARE_DELIVER_MAX_RECORDS` records, and a
  `vault-share.revoke` mailbox wake removes the grantor/projection entry when
  permission is revoked. If the final entry is removed, the compact document is
  deleted. Group join grants also cap active grantors per destination/projection
  through `HOSTED_GROUP_VAULT_SHARE_DESTINATION_LIMIT_PER_PROJECTION`, so the
  single-file read/write cost is bounded on the growing destination side. This
  derived path is included in hosted workspace snapshots while keeping `raw/`
  reserved for immutable imported originals. The file count stays hard-bounded
  at one file for the shared projection family and keeps normal import work
  bounded despite delivery retries or night count.

- `assistant-state/hosted-provider-cleanup.json`
  (`murph.hosted-provider-cleanup.v1`) is compact durable operational-continuity
  state included in hosted snapshots. It is the single owner of the queued
  provider-visible Linq message ids awaiting deletion and of the next cleanup
  wake. It is exactly one bounded file per workspace: queueing, deferral
  re-arms, and retry checkpoints overwrite the same document, and a successful
  drain deletes it. The id list is deduplicated and drains to empty on every
  successful cleanup pass, so steady state is zero or one small file regardless
  of message volume.

- `assistant-state/hosted-provider-cleanup-recovery.json`
  (`murph.hosted-provider-cleanup-recovery.v1`) is temporary migration state,
  bounded to one file per workspace. It marks that the one-shot legacy
  terminal-evidence recovery has completed so steady-state wakes never scan the
  evidence directory again. It is deleted together with the prescribed
  migration/recovery/bootstrap code in provider-cleanup.ts and the
  snapshot-bridge pruning guard once production vaults have all written the
  marker. The steady-state file bound for the provider-cleanup family is
  asserted by the provider-cleanup unit tests.

- `assistant-state/auto-reply/answered-coverage.json`
  (`murph.assistant-auto-reply-answered-coverage.v1`) is compact durable
  operational-continuity state included in hosted snapshots. It is one
  overwritten projection per workspace, not one file per input, turn, delivery,
  or retry. Auto-reply terminal evidence advances the contiguous hosted mailbox
  conversation coverage in place and keeps at most 500 future lane sequence
  numbers while waiting for gaps to close. The file is absent until hosted
  mailbox auto-reply terminal evidence exists, and steady state remains zero or
  one small file regardless of message volume.
