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
- Keep generated and derived artifacts under an owner directory as one
  versioned bundle, or with a manifest and a bounded artifact count. Do not
  create open-ended sidecar trees.
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

- `bank/assistant-preference-mutations.json`
  (`murph.assistant-preference-mutations.v1`) is one canonical companion
  document per vault. It contains only the fixed tone, voice, Humor, Push, and
  Detail applied-sequence fields, is included in hosted snapshots, and is
  rewritten atomically with affected preference values by the canonical owner.
  It never grows per turn, mailbox row, replay, or user action, so its steady
  state is exactly one bounded file with no rotation or compaction lifecycle.

- `raw/clinical/fhir/<connectionId>/<retrievalJobId>/manifest.json` plus
  `raw/clinical/fhir/<connectionId>/<retrievalJobId>/<resourceType>/...`
  (`murph.clinical-raw-manifest.v1`) is immutable imported raw clinical
  evidence. When written inside a hosted workspace it is included in hosted
  snapshots, because candidates and unsupported-resource rows point back to
  these raw refs for auditability. The v1 schema bounds one retrieval job to one
  manifest plus at most `CLINICAL_RAW_MANIFEST_MAX_RESOURCE_FILES` resource
  files, at most `CLINICAL_RAW_MANIFEST_MAX_TOTAL_RESOURCES` resources, at most
  `CLINICAL_RAW_MANIFEST_MAX_BYTES` for the manifest, and at most
  `CLINICAL_RAW_RESOURCE_FILE_MAX_BYTES` per resource file, with at most
  `CLINICAL_RAW_RESOURCE_FILES_MAX_TOTAL_BYTES` across resource files. This PR
  defines the contract and importer only; it does not add a production hosted
  writer that can accumulate repeated retrieval-job directories. Before any
  production writer enables repeated retrievals, it must keep the family bounded
  over time by reusing/deduping retrieval identity, pruning superseded job
  directories after canonical import, or documenting an explicit indefinite raw
  evidence retention envelope with file-count tests.

- `assistant-state/hosted-mailbox-input-items/*.json` is runtime coupling state:
  each mapping exists only to relate one hosted mailbox row to its persisted
  assistant input event. Runtime-residue pruning inventories both owner trees,
  fails closed on malformed or symlinked entries, removes eligible input events
  first, then removes every mapping whose input no longer survives. Mappings do
  not have an independent retention window.

- `ledger/inbox-captures/YYYY/YYYY-MM.jsonl` is the sole committed inbox
  metadata owner. Current v2 writes can add attachment bytes but add no
  per-capture metadata file under `raw/inbox/**`. The bounded, dry-run-first
  legacy repair appends an equivalent v2 record and receipt-guard deletes the
  redundant v1 envelope; mismatches or active operations block the pass.

- `derived/inbox/<captureId>/attachments/<attachmentId>/attempts/<attempt>/result.json`
  is one rebuildable, versioned parser result consumed as a unit. One attempt
  creates one file rather than manifest, chunks, Markdown, plain-text, and
  tables sidecars. Legacy attempts compact only after exact semantic validation,
  in apply passes bounded to 100 attempts; malformed, conflicting, symlinked,
  incomplete, or unexpected entries are retained and counted.

- The repo-owned portable ZIP omits explicit directory entries and continues to
  exclude `.runtime/**`, including rebuildable projections. This changes only
  download packaging, not live vault state or the separate hosted tar snapshot
  classifier.

- Flat assistant delivery residue under
  `.runtime/operations/assistant/generated-deliveries/<filename>` is therefore
  excluded from portable ZIPs but included in encrypted hosted checkpoints.
  Files under the previously proposed `exports/assistant-deliveries/**` prefix
  remain ordinary checkpointed vault data and receive no path-specific
  portable-package exclusion. Existing global archive-file exclusions still
  apply there as they do everywhere else. Phase one adds no production writer
  or cleanup lifecycle; writer activation must add bounded file-count and
  terminal-cleanup proof before it can produce this runtime residue.

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

- `derived/captures/generated-image-lookups.json`
  (`murph.capture-lookup.v1`) is a compact derived index for generated-image
  retry identity. It is included in hosted workspace snapshots because replay
  after restore must know whether a stable generated-image tool identity already
  saved a capture or was later deleted. One ordinary generated-image request can
  add at most one small map entry; retries of the same tool identity update no
  file count and either reuse the saved capture or return the deleted outcome.
  The index is one file per workspace, not one sidecar per image. Lookup-backed
  generated-image capture events are immutable after creation except for
  `deleteEvent`, so each entry can store the original event shard and primary raw
  media ref without scanning the event ledger. The map grows with user-created
  generated-image captures, matching the product-owned raw capture history, and
  deletion intentionally keeps the entry so a retry cannot resurrect deleted
  media. No rotation is planned while the file stays a single compact owner
  document; future retention for generated captures must prune the capture event,
  raw media, and matching lookup entry in one core-owned repair flow.

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

- `bank/habitat/*.md` (`murph.frontmatter.habitat.v1`) is canonical product
  truth included in hosted workspace snapshots. It stores one optional Markdown
  document per versioned habitat catalog aspect, and a habitat save creates at
  most one aspect file before later saves overwrite that same document. File
  count is bounded by the catalog rather than user actions, messages, retries,
  or provider history. No separate retention or compaction is planned while the
  aspect catalog is additive; any future catalog deprecation must define the
  delete/archive posture in the same change.
