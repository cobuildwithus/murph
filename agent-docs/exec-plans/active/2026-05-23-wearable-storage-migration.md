# Wearable Storage Migration

Status: active planning
Created: 2026-05-23
Updated: 2026-05-23

## Goal

Cut wearable provider vault storage by roughly 90% in affected workspaces while
preserving product-visible health facts, raw evidence needed for
trust/debugging, and simple long-term architecture.

The observed blowup came from a Garmin account imported through Junction, but
the migration must be provider-agnostic. Junction/Garmin is the first proof
target, not the storage boundary.

Success means:

- Existing bloated vaults can be repaired by a dry-run/apply operator path.
- Future imports do not recreate payload-bearing receipts, persisted canonical
  record artifacts, dense provider sample ledgers, or duplicate rolling
  timeseries transforms.
- Query, browser-vault, and assistant default reads stay unchanged except for
  storage size.
- The architecture remains small: core-owned repairs, importer guardrails,
  device-sync idempotency, and no generic maintenance framework.

## Underlying Issue

The failure mode is not ordinary user notes or product state. The large vaults
are storing dense provider telemetry in several hot durable forms at once:

- Raw device-provider timeseries resources under `raw/integrations/**`.
- Legacy raw ingest envelopes/receipts that may carry payload bodies in old
  vaults.
- Legacy derived canonical wearable-record raw artifacts, often named like
  `03-*-canonical-wearable-records-*.json`.
- Expanded generic sample-debug ledgers under `ledger/samples/**`, especially
  heart-rate JSONL shards.
- Repeated rolling sync windows that can import the same dense timeseries days
  many times.

The product usually needs compact facts: daily summaries, sessions, workouts,
resting heart rate, min/max/average/coverage, source/provenance, and display
grade metric points. It usually does not need every provider sample point hot
forever, and it should not keep derived records as large raw evidence.

## Current Repo Facts

The current codebase already fixed several future-write problems:

- `packages/importers/src/device-providers/raw-ingest-receipt.ts` builds
  `wearable.raw_ingest_receipt.v1` receipts with `payloadHash`,
  `rawArtifactRoles`, and `rawArtifactCount`, but without a stored `payload`.
- `packages/importers/src/device-providers/import-device-provider-snapshot.ts`
  still computes `canonicalWearableRecords` in memory, but current tests assert
  that no `wearable-canonical-records:*` raw artifact is emitted.
- Importer tests across current wearable providers assert dense provider
  timeseries generally emit raw artifacts and compact events, not generic sample
  rows.
- `ARCHITECTURE.md` and `docs/device-provider-compatibility-matrix.md` already
  say dense provider telemetry must stay out of default query/read/browser
  state.
- `packages/core/src/wearable-receipts.ts` already has a narrow legacy receipt
  compactor that rewrites only proven payload-bearing wearable envelopes,
  updates raw manifests, and emits metadata-only audit.

The current codebase still has two important gaps:

- Existing vaults can still contain old bulky artifacts and debug ledgers.
- Provider sync must be cursor/idempotency based for dense timeseries. The
  current concrete gap is Junction: scheduled sync is bounded, but it uses a
  rolling reconcile window and a dedupe key that includes the current `now`, so
  repeated runs can fetch overlapping recent days and write new raw transform
  artifacts.

## Storage Policy

Use four storage classes. Every wearable artifact should clearly fit one.

| Class | Examples | Hot retention |
| --- | --- | --- |
| Product facts | daily summaries, sessions, workouts, body metrics, display-grade metric points | Forever |
| Raw provider evidence | provider summary snapshots, small receipts, source metadata | Bounded by policy |
| Dense debug telemetry | high-frequency HR, HRV, respiratory, SpO2, step timeseries | Short retention only |
| Derived artifacts | canonical wearable-record files, expanded transform intermediates | Do not persist hot |

The simple rule:

Keep what Murph means. Do not keep every provider point forever just because the
provider sent it.

## Non-Goals

Do not add:

- A generic maintenance queue.
- A content-addressed raw artifact store.
- A broad raw deletion API.
- A second hosted runtime maintenance scheduler.
- New hosted DB fields for cleanup.
- Summary derivation inside cleanup.
- Query/browser-vault schema rewrites.
- Provider-specific one-off reconstruction logic.
- AI/model participation in repair.
- Dense raw timeseries tombstoning in v1.

## Phase 1: Prevention First

Ship prevention before mutating old workspaces.

### 1. Keep Payload-Free Receipts

Current behavior is correct. Preserve it with hard tests:

- New `wearable.raw_ingest_receipt.v1` receipts must not contain `payload`.
- Receipts may keep `payloadHash`, role list, role count, import window, and
  provenance metadata.
- Provider payload bytes belong only in raw provider artifacts, not in the
  receipt.

### 2. Never Persist Derived Canonical Records As Raw Artifacts

Current behavior is correct. Keep `canonicalWearableRecords` as an in-memory
normalization/output bridge only.

Hard invariant:

- No future device-provider import may write raw artifacts whose role starts
  with `wearable-canonical-records:`.
- No future device-provider transform should emit large derived canonical-record
  files such as `03-*-canonical-wearable-records-*.json`.

### 3. Keep Dense Provider Timeseries Out Of Generic Samples

Dense provider streams should remain raw/debug evidence by default, not durable
`ledger/samples/**` rows.

Rules:

- Device-provider high-frequency HR, HRV, respiratory rate, SpO2, and step
  timeseries may be raw artifacts.
- Importers may emit compact product facts where the provider supplies summary
  semantics.
- Importers must not emit generic sample rows for provider firehoses unless an
  explicit debug mode is set.

Add a core guard inside `importDeviceBatch` after normalized input parsing, so
one bad adapter cannot recreate the blowup. Do not rely on a caller-provided
`source` string as the only gate:

```ts
if (
  isDeviceProviderImport(payload) &&
  (payload.samples?.length ?? 0) > MAX_DEVICE_PROVIDER_SAMPLE_ROWS_DEFAULT &&
  options.denseSamplePolicy?.allowDenseDebugSamples !== true
) {
  throw new VaultError(
    "VAULT_DENSE_DEVICE_SAMPLES_NOT_ALLOWED",
    "Device provider imports must keep dense timeseries as raw evidence and emit compact product facts.",
  );
}
```

The escape hatch should be explicit operation metadata, not persisted sample-row
contract shape:

```ts
options: {
  allowDenseDebugSamples: true,
  retention: "debug_temporary",
}
```

Require both `allowDenseDebugSamples: true` and
`retention: "debug_temporary"`.

### 4. Make Provider Dense Timeseries Idempotent

Current Junction sync does not appear to import a whole month by default, but it
does repeatedly reconcile overlapping recent windows. Treat that as the first
implementation target for a provider-agnostic primitive: dense timeseries sync
must be resource/day idempotent for every wearable provider.

Keep the design small:

- Leave summary reconcile windows reasonably broad, because summaries are small.
- Reduce dense timeseries scheduled reconcile to the smallest useful lookback,
  such as 1-2 days, independent of summary reconcile.
- Split dense timeseries fetch/import by provider resource and stable day key.
- Classify dense resources through provider-owned resource/capability metadata,
  not core hardcoded provider names.
- Bucket dense chunks by provider-native day/date when the resource supplies one.
  Otherwise use UTC half-open windows `[dayStart, nextDayStart)`.
- Persist `dayKey`, `dayKeyBasis`, `coverageStart`, and `coverageEnd` as
  metadata. Product/query day assignment remains separate from sync bucketing
  and must not depend on the sync machine's local timezone.
- Compute dense idempotency fingerprints from canonicalized provider resource
  content only: provider, connection id, source provider/source instance,
  resource, day bucket, and stable payload body.
- Strip fetch/import metadata such as `importedAt`, scheduler `now`, request
  window wrappers, pagination cursors, and volatile provider request metadata
  before hashing.
- Before writing a dense timeseries raw artifact, check whether the same
  connection/resource/day fingerprint was already imported.
- If already imported, skip the raw artifact/write batch and record only a
  metadata-only sync observation if needed.
- Prefer closed resource/day windows after a provider-specific freshness lag.
  For mutable recent days, keep at most one retained vault artifact per
  connection/resource/day, or treat current-day fetches as runtime observations
  until the day is closed. A changed content hash for the same dense day must
  not create unbounded retained artifacts.
- Local device-sync may use `.runtime/operations/device-sync/**` for
  scheduling cursors, high-water marks, and rebuildable indexes. The durable
  "already imported" check must be derivable from existing raw
  receipts/manifests.
- Hosted device-sync must not rely on local-only runtime state for this fence.
  If hosted imports dense provider data, persist only sparse metadata
  fingerprints in the web-owned device-sync control plane, or prove idempotency
  from existing vault raw receipts/manifests before writing. Never store raw
  payloads, samples, or health facts in hosted control-plane state.

Avoid a global content-addressed raw store. The required primitive is only:

```text
provider connection + source + resource + stable day key + canonicalized content hash -> already imported?
```

Webhook resource jobs enqueue bounded resource/day rechecks. Duplicate webhook
deliveries, recovery sweeps, and scheduled reconcile overlap may all request the
same day; only the dense import fingerprint decides whether a new raw transform
is written. If a webhook includes a provider object id or revision, include it
in the recheck hint, but still hash fetched resource content before import.
Delete and deauthorize events remain separate job kinds and must not be
suppressed by dense sample idempotency.

### 5. Bound Backfills

Backfills may need historical data, but they should be chunked and predictable:

- Summary backfill can stay day/week chunked.
- Dense timeseries backfill should be day chunked.
- Backfill jobs should not repeatedly write already imported dense days.
- Do not mark dense days permanently sealed on first success. Recent mutable
  days stay eligible for scheduled or webhook-triggered recheck; if the stable
  resource/day content hash changes, import the correction as a bounded new
  version rather than appending unbounded artifacts.
- Older days may stop routine polling only after an explicit provider/resource
  retention or immutability window.
- Failed days should retry by day/resource, not by reimporting a large rolling
  window.

## Phase 2: Existing Workspace Cleanup

Add one core-owned repair surface:

```ts
export async function detectWearableStorageMigrationCandidates(input: {
  vaultRoot: string;
  maxScanBytes?: number;
}): Promise<WearableStorageMigrationDetection>;

export async function runWearableStorageMigrationPass(input: {
  vaultRoot: string;
  maxFiles?: number;
  maxBytes?: number;
  deadlineMs?: number;
  now?: Date;
  validateAfter?: boolean;
}): Promise<WearableStorageMigrationResult>;
```

The implementation should be a fixed ordered pass, not a generic registry:

1. Compact legacy wearable receipt envelopes.
2. Replace legacy derived canonical-record raw artifacts with tiny tombstones.
3. Delete proven provider-generated dense sample-debug ledgers.

V1 has exactly those three mutating steps. Dense raw timeseries retention is a
separate future decision after measurement, with its own plan and durable docs
update.

Layering rule:

- Core repair eligibility is limited to file, manifest, hash, provenance,
  preimage, and raw-reference proofs.
- Core must not import query or browser-vault code.
- Read-model equivalence is verified outside core by `vault-usecases`, the CLI,
  or tests that compose core plus query/browser-vault.
- Query equivalence means product-visible families are unchanged. Metadata-only
  `vault_repair` audit rows are the only allowed query-visible delta.
- Browser-vault equivalence compares normalized user-visible replica rows after
  ignoring generated timestamps, bundle hashes, and data-version metadata.

Repair exception rule:

- Raw tombstone rewrites run through the same repair mode as legacy wearable
  receipt compaction: under the canonical write lock, without emitting hosted
  canonical write receipts for the raw rewrite.
- Hosted propagation, if ever enabled, must use a full workspace checkpoint or
  a separately designed guarded raw compare-and-replace mode.
- Append-only JSONL shard deletion is a repair-only exception, not a general
  delete primitive.
- Any new tombstone/delete repair exception must update `ARCHITECTURE.md` and
  `docs/contracts/00-invariants.md`. The default contract remains immutable raw
  artifacts and append-only ledgers.

Privacy/output rule:

- Audits, tombstones, logs, dry-run/apply output, sync observations, broad
  result DTOs, and test failures must stay metadata-only: artifact class,
  action, counts, byte totals, bounded status, and reason.
- Do not include account/user/connection ids, provider ids, raw payloads, sample
  values, provider bodies, raw snippets, local paths, or per-row data.
- Content hashes and exact vault-relative paths are allowed only inside the
  local repair implementation or internal proof report when needed for proof;
  they must not be emitted to hosted logs, tombstones, audits, or broad
  user-facing output.

### Step 1: Compact Legacy Receipt Payloads

Use the existing compactor. Do not broaden it.

Eligibility remains strict:

- Artifact is a legacy wearable raw envelope.
- It has a top-level `payload`.
- Manifest state and file bytes match.
- The same manifest set proves duplicate provider evidence by exact payload
  hash.
- Raw provider evidence, canonical product records, ledgers, metric samples, and
  product-visible read-model behavior are preserved.

Expected win: useful for old payload-bearing envelopes, but not enough by
itself for the 90% goal.

### Step 2: Tombstone Legacy Canonical-Record Raw Artifacts

Target legacy derived artifacts:

- Roles beginning with `wearable-canonical-records:`.
- Legacy transform files like `03-*-canonical-wearable-records-*.json` as
  scanner hints only.

Mutation:

- Do not hard-delete raw artifacts.
- Replace the file at the same path with a tiny JSON tombstone.
- Generate tombstone content as deterministic UTF-8 JSON with stable key order
  and one trailing newline.
- Update every raw manifest artifact entry that references the rewritten path,
  recomputing `byteSize` and `sha256` from the exact tombstone bytes.
- Emit metadata-only `vault_repair` audit.

Reason:

- Raw delete is intentionally not part of normal write-batch policy.
- Same-path raw rewrite already exists as a narrow repair primitive.
- Keeping the path avoids broken incidental raw references.
- The artifact is derived, not provider source evidence.

Tombstone shape:

```json
{
  "schemaVersion": "wearable.legacy_canonical_records_pruned.v1",
  "artifactClass": "derived_canonical_records",
  "reason": "derived_duplicate_not_canonical_evidence",
  "originalByteSize": 17400000,
  "prunedAt": "2026-05-23T00:00:00.000Z"
}
```

Eligibility:

- File exists.
- Actual byte size and SHA match the raw manifest before rewrite.
- A strict raw-manifest checksum verifier passes over every touched
  manifest/artifact entry before and after rewrite. Treat `validateVault` as
  structural validation only; it does not prove raw digest integrity.
- Filename patterns are discovery hints only. Eligibility requires a manifest
  role beginning `wearable-canonical-records:` or a parsed legacy schema marker
  proving the artifact is derived.
- Provider raw evidence for the same import still exists.
- Wearable raw receipt/envelope for the same import still exists.
- No event/sample raw reference depends on this file as sole provider evidence.
- Every manifest reference to the path agrees on preimage role, byte size, and
  SHA. If references disagree, skip.
- Product-visible read-model output is unchanged before and after, verified
  outside core.

If any proof is missing, skip.

### Step 3: Delete Proven Dense Provider Sample-Debug Ledgers

Candidate paths:

- `ledger/samples/heart_rate/**`
- `ledger/samples/respiratory_rate/**`
- `ledger/samples/hrv/**`
- `ledger/samples/steps/**`
- `ledger/samples/spo2/**`

These paths are candidates only. Eligibility comes from row and provenance
proof, not the path alone. Use a small shared dense-telemetry classification,
not provider names or an ad hoc path list. Initial `debug_dense` streams may
include HR, HRV, respiratory rate, SpO2, steps, sleep stage, and temperature.
Exclude glucose/CGM from deletion unless a separate product decision classifies
a specific provider/resource as debug-only.

These are not default product state. Query should read product facts from
canonical events and display-grade `ledger/metric-samples/**`, not generic
debug sample ledgers.

Important simplification:

- Cleanup must not derive new summaries.
- If product facts are missing, skip the shard and fix the importer separately.

Mutation:

- Delete only provider-generated debug JSONL shards.
- Use `stageDelete(path, { allowAppendOnlyJsonl: true })` only for whole-shard
  repair deletion under `ledger/samples/<dense-stream>/`.
- Emit metadata-only `vault_repair` audit.
- Do not add a new retention ledger in v1.
- Capture preimage `{ sha256, byteSize, rowCount, firstRecordedAt,
  lastRecordedAt }` in the local pass result or metadata-only repair report.
  Do not store detailed proof in ad hoc audit fields.

Eligibility:

- Path is under a known dense provider debug stream.
- Every row parses as the sample record schema and matches the path stream.
- Every valid row is proven provider-generated device debug telemetry by row
  source, provider/device provenance through `externalRef` or `dataOrigin`,
  import manifest/audit provenance, and raw integration ownership.
- No row is `manual`, `import`, `derived`, missing provenance, mixed provenance,
  or tied to `raw/samples/**` CSV source artifacts.
- No supported export, operator, or debug surface depends on the shard.
- Product-visible read-model output is unchanged before and after, verified
  outside core.
- Do not rewrite or filter rows in v1.

Skip mixed-provenance shards.

### Future Decision: Dense Raw Timeseries Retention

After Steps 1-3, measure actual reduction. If the vault is still far above the
target, the remaining bulk is likely raw provider timeseries artifacts.

Do not include raw provider timeseries tombstoning in v1. Reopen it only with a
separate plan, a documented retention policy, and an exact legacy role/schema
allowlist.

Target role classes, with provider-specific names treated as examples:

- heart-rate timeseries, such as `junction-timeseries-heartrate`.
- respiratory-rate timeseries, such as `junction-timeseries-respiratory-rate`.
- HRV timeseries, such as `junction-timeseries-hrv`.
- blood-oxygen timeseries, such as `junction-timeseries-blood-oxygen`.
- step timeseries, such as `junction-timeseries-steps`.

Any future mutation should mirror Step 2:

- Replace eligible raw files with tiny tombstones.
- Update raw manifests.
- Preserve summaries, sessions, workouts, metric samples, receipts, and audit.

Eligibility should be even stricter:

- The artifact is a known dense debug timeseries role.
- The artifact is older than the chosen retention window.
- It is not a sole raw reference for any durable product fact.
- The corresponding receipt/import metadata remains.
- Compact facts cover the same provider/resource/day and preserve the product
  semantics that the raw artifact uniquely supplied: coverage window, sample
  count, min/max/avg where applicable, threshold/run summaries where applicable,
  and session/workout/sleep links.
- Days overlapping active experiments or user-requested raw/sample inspection
  periods are skipped.
- Product-visible read-model output is unchanged.

Raw provider evidence has higher trust/debug value than derived canonical files
or debug ledgers. This future lever is appropriate only if the 90% target still
requires it after v1 cleanup and prevention.

## Phase 3: Operator Path

Start with an explicit local/operator repair command, not automatic hosted
cleanup or a generic maintenance surface.

```text
murph vault repair wearable-storage --dry-run
murph vault repair wearable-storage --apply
```

The command should be a thin wrapper over core only.

Dry-run output should show counts and byte estimates:

```text
Wearable storage cleanup candidates:
- legacy receipt payloads: 143 files, 180 MB candidate
- legacy canonical record artifacts: 36 files, 620 MB candidate
- dense provider sample-debug ledgers: 5 files, 252 MB candidate
Estimated v1 hot-vault reduction: 552 MB
```

Apply should run bounded passes:

```text
Pass complete:
- compacted receipts: 5
- tombstoned canonical artifacts: 5
- deleted sample-debug shards: 1
- bytesBefore: ...
- bytesAfter: ...
- hasMore: true
```

## Phase 4: Hosted Path, Out Of V1

Hosted cleanup is out of v1. Do not immediately reintroduce hosted automatic
maintenance. A prior hosted compaction path was intentionally retired after the
one-shot did not find compactable legacy envelopes.

Reopen hosted cleanup only with a separate plan after operator dry-run/apply
proves candidate classes, byte savings, bounded runtime, idempotent resume,
metadata-only observability, fresh-input preemption, and checkpoint behavior.
If that future plan proves hosted cleanup is necessary, add one narrow wake:

```ts
export const HOSTED_WEARABLE_STORAGE_HOUSEKEEPING_WAKE_REASON =
  "wearable-storage-housekeeping-v1";
```

Rules:

- Fresh conversation input always wins.
- The wake runs before assistant hydration.
- It calls only the bounded core pass.
- It marks runtime dirty if mutated.
- It relies on the existing idle checkpoint path.
- It does not call the assistant/model.
- It does not add hosted DB fields, cron tables, or a generic job queue.
- Fresh input is checked at dispatch and before each bounded mutation/checkpoint.
- Cleanup demand is acknowledged only after the idle checkpoint succeeds.
  Checkpoint failure leaves cleanup retryable.

The retired `legacy-wearable-receipt-compaction-v1` wake should remain retired.
If a legacy wake is still persisted, runtime demand should ignore it rather
than treating it as a valid run reason. Retired legacy wakes are acknowledged or
cleared without assistant hydration, vault mutation, or clobbering unrelated
demand.

## Tests

### Prevention Tests

- Raw receipt has no `payload`.
- No raw artifact role starts with `wearable-canonical-records:`.
- Every wearable provider's dense HR/HRV/respiratory/SpO2/steps timeseries
  produce raw artifacts and zero generic sample rows by default.
- Core rejects large device-provider sample arrays without explicit
  `allowDenseDebugSamples`.
- Dense debug escape hatch requires explicit temporary retention and is not
  persisted onto sample rows.
- The provider-agnostic dense timeseries reconciler does not write a second
  artifact for an already imported connection/resource/day/content hash.
- Overlapping scheduled reconcile, recovery, and webhook dense sync import each
  connection/resource/day at most once unless the stable resource-day content
  hash changes within the bounded mutable window.
- Junction has a focused regression test because it is the first observed
  rolling-window offender.
- Dense import fingerprints strip volatile wrapper metadata and are stable
  across equivalent provider resource content.
- Day bucketing covers provider-native day keys, UTC fallback windows, and
  cross-midnight resources without using machine-local time.
- Webhook rechecks pass through the same dense import fingerprint fence, while
  delete/deauthorize jobs remain separate.
- Backfill retries one failed dense day/resource without reimporting completed
  days.

### Cleanup Tests

- Legacy receipt compaction remains idempotent.
- Legacy canonical-record artifact becomes a tiny tombstone and manifest
  SHA/size update exactly.
- Raw tombstones are deterministic bytes with stable key order and a trailing
  newline.
- Filename patterns are scanner hints only; role/schema proof decides
  eligibility.
- Provider raw evidence is untouched.
- Dense provider sample shard is deleted only when product-visible read-model
  output is unchanged.
- Explicit user CSV sample shard is skipped.
- Mixed-provenance sample shard is skipped.
- Missing provider/device provenance, malformed sample rows, `raw/samples/**`
  CSV ownership, or export/operator/debug dependencies skip the shard.
- Append-only JSONL delete allowance is never used for `audit/**`,
  `ledger/events/**`, `ledger/metric-samples/**`, or mixed shards.
- No audit entry contains raw health payloads, sample arrays, provider bodies,
  local paths, secrets, or direct identifiers.
- `validateVault` passes.
- A strict raw manifest helper recomputes size/SHA for every touched raw file.
- Dry-run performs no writes, and apply uses the same eligibility set.
- Every mutating cleanup step validates before/after product-visible read-model
  equivalence outside core.

### Budget And Runtime Tests

- Cleanup pass respects `maxFiles`.
- Cleanup pass respects `maxBytes`.
- Cleanup pass respects `deadlineMs`.
- `hasMore` remains true when bounded work remains.
- Fresh hosted conversation input skips hosted cleanup if hosted cleanup is
  added later.
- Non-maintenance wakes are not clobbered.

## Rollout Order

1. Land prevention tests and any missing guards.
2. Make dense provider timeseries day/resource idempotent, proving the shared
   primitive with Junction first.
3. Add dry-run scanner.
4. Run scanner against the affected workspace and record only metadata counts
   and byte totals.
5. Apply Step 1 and Step 2 in small bounded passes.
6. Apply Step 3 only where product-visible read-model equivalence is proven
   outside core.
7. Re-measure. If the vault is still too large, decide whether a separate dense
   raw timeseries retention plan is warranted.
8. Consider hosted cleanup only after a separate operator-proven plan justifies
   it.

## Architecture End State

Product facts stay hot and durable.

Raw provider evidence stays available but bounded by explicit policy.

Dense provider telemetry is debug evidence, not default product state.

Derived canonical wearable records are rebuildable and not persisted as large
raw artifacts.

Device sync imports bounded, idempotent resource/day windows instead of
rewriting overlapping dense windows every reconcile.

Core owns repair authority. Importers prevent bad writes. Device-sync prevents
duplicate windows. Query remains read-only. Hosted runtime stays out unless an
operator-proven cleanup pass genuinely needs a single narrow wake.
