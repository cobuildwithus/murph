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

Add a core guard so one bad adapter cannot recreate the blowup:

```ts
if (
  payload.source === "device" &&
  (payload.samples?.length ?? 0) > MAX_DEVICE_PROVIDER_SAMPLE_ROWS_DEFAULT &&
  payload.provenance?.allowDenseDebugSamples !== true
) {
  throw new VaultError(
    "VAULT_DENSE_DEVICE_SAMPLES_NOT_ALLOWED",
    "Device provider imports must keep dense timeseries as raw evidence and emit compact product facts.",
  );
}
```

The escape hatch should be explicit and retention-bound:

```ts
provenance: {
  allowDenseDebugSamples: true,
  retention: "debug_temporary",
}
```

### 4. Make Provider Dense Timeseries Idempotent

Current Junction sync does not appear to import a whole month by default, but it
does repeatedly reconcile overlapping recent windows. Treat that as the first
implementation target for a provider-agnostic primitive: dense timeseries sync
must be resource/day idempotent for every wearable provider.

Keep the design small:

- Leave summary reconcile windows reasonably broad, because summaries are small.
- Reduce dense timeseries scheduled reconcile to the smallest useful lookback,
  such as 1-2 days, independent of summary reconcile.
- Split dense timeseries fetch/import by provider resource and UTC day.
- Classify dense resources through provider-owned resource/capability metadata,
  not core hardcoded provider names.
- Before writing a dense timeseries raw artifact, check whether the same
  connection/resource/day/payload hash was already imported.
- If already imported, skip the raw artifact/write batch and record only a
  metadata-only sync observation if needed.
- Use existing device-sync operational state under
  `.runtime/operations/device-sync/**` for machine-local cursors/high-water
  marks. Do not put OAuth/webhook/reconcile cursors in the canonical vault.

Avoid a global content-addressed raw store. The required primitive is only:

```text
provider connection + resource + day + payload hash -> already imported?
```

### 5. Bound Backfills

Backfills may need historical data, but they should be chunked and predictable:

- Summary backfill can stay day/week chunked.
- Dense timeseries backfill should be day chunked.
- Backfill jobs should not repeatedly refetch already completed dense days.
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
4. Optionally, after measurement, tombstone old dense raw timeseries artifacts
   that are not needed as sole product evidence.

### Step 1: Compact Legacy Receipt Payloads

Use the existing compactor. Do not broaden it.

Eligibility remains strict:

- Artifact is a legacy wearable raw envelope.
- It has a top-level `payload`.
- Manifest state and file bytes match.
- The same manifest set proves duplicate provider evidence by exact payload
  hash.
- Raw provider evidence, canonical records, ledgers, metric samples, and
  query/browser-vault behavior are preserved.

Expected win: useful for old payload-bearing envelopes, but not enough by
itself for the 90% goal.

### Step 2: Tombstone Legacy Canonical-Record Raw Artifacts

Target legacy derived artifacts:

- Roles beginning with `wearable-canonical-records:`.
- Legacy transform files like `03-*-canonical-wearable-records-*.json`.

Mutation:

- Do not hard-delete raw artifacts.
- Replace the file at the same path with a tiny JSON tombstone.
- Update the raw manifest `byteSize` and `sha256`.
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
  "reason": "derived_duplicate_not_canonical_evidence",
  "originalByteSize": 17400000,
  "originalSha256": "old-sha",
  "prunedAt": "2026-05-23T00:00:00.000Z"
}
```

Eligibility:

- File exists.
- Actual byte size and SHA match the raw manifest before rewrite.
- Provider raw evidence for the same import still exists.
- Wearable raw receipt/envelope for the same import still exists.
- No event/sample raw reference depends on this file as sole provider evidence.
- Query/browser-vault output is unchanged before and after.

If any proof is missing, skip.

### Step 3: Delete Proven Dense Provider Sample-Debug Ledgers

Target:

- `ledger/samples/heart_rate/**`
- `ledger/samples/respiratory_rate/**`
- `ledger/samples/hrv/**`
- `ledger/samples/steps/**`
- `ledger/samples/spo2/**`

These are not default product state. Query should read product facts from
canonical events and display-grade `ledger/metric-samples/**`, not generic
debug sample ledgers.

Important simplification:

- Cleanup must not derive new summaries.
- If product facts are missing, skip the shard and fix the importer separately.

Mutation:

- Delete only provider-generated debug JSONL shards.
- Use normal core delete with the existing append-only JSONL repair allowance.
- Emit metadata-only `vault_repair` audit.
- Do not add a new retention ledger in v1.

Eligibility:

- Path is under a known dense provider stream.
- Rows are provider/device generated, not explicit user CSV imports.
- Shard is not used by default query/read/browser-vault output.
- Query/browser-vault output is identical before and after.
- Audit contains only metadata: path, bytes, row count, hash, reason.

Skip mixed-provenance shards.

### Step 4: Measure Dense Raw Timeseries Retention Need

After Steps 1-3, measure actual reduction. If the vault is still far above the
target, the remaining bulk is likely raw provider timeseries artifacts.

Only then add a fourth repair step for old dense raw timeseries artifacts.

Target role classes, with provider-specific names treated as examples:

- heart-rate timeseries, such as `junction-timeseries-heartrate`.
- respiratory-rate timeseries, such as `junction-timeseries-respiratory-rate`.
- HRV timeseries, such as `junction-timeseries-hrv`.
- blood-oxygen timeseries, such as `junction-timeseries-blood-oxygen`.
- step timeseries, such as `junction-timeseries-steps`.

Mutation should mirror Step 2:

- Replace eligible raw files with tiny tombstones.
- Update raw manifests.
- Preserve summaries, sessions, workouts, metric samples, receipts, and audit.

Eligibility should be even stricter:

- The artifact is a known dense debug timeseries role.
- The artifact is older than the chosen retention window.
- It is not a sole raw reference for any durable product fact.
- The corresponding receipt/import metadata remains.
- Compact product facts for the covered days already exist.
- Query/browser-vault output is unchanged.

This step is deliberately optional because raw provider evidence has higher
trust/debug value than derived canonical files or debug ledgers. It is the right
lever only if the 90% target requires it.

## Phase 3: Operator Path

Start with an explicit local/operator command, not automatic hosted cleanup.

```text
murph vault maintenance wearable-storage --dry-run
murph vault maintenance wearable-storage --apply
```

The command should be a thin wrapper over core only.

Dry-run output should show counts and byte estimates:

```text
Wearable storage cleanup candidates:
- legacy receipt payloads: 143 files, 180 MB candidate
- legacy canonical record artifacts: 36 files, 620 MB candidate
- dense provider sample-debug ledgers: 5 files, 252 MB candidate
- dense raw timeseries older than retention: 42 files, 300 MB candidate
Estimated hot-vault reduction: 850 MB
```

Apply should run bounded passes:

```text
Pass complete:
- compacted receipts: 5
- tombstoned canonical artifacts: 5
- deleted sample-debug shards: 1
- tombstoned dense raw timeseries: 0
- bytesBefore: ...
- bytesAfter: ...
- hasMore: true
```

## Phase 4: Hosted Path, Only If Needed

Do not immediately reintroduce hosted automatic maintenance. A prior hosted
compaction path was intentionally retired after the one-shot did not find
compactable legacy envelopes.

If hosted cleanup becomes necessary after operator dry-runs prove the candidate
classes and byte savings, add one narrow wake:

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

The retired `legacy-wearable-receipt-compaction-v1` wake should remain retired.
If a legacy wake is still persisted, runtime demand should ignore it rather
than treating it as a valid run reason.

## Tests

### Prevention Tests

- Raw receipt has no `payload`.
- No raw artifact role starts with `wearable-canonical-records:`.
- Every wearable provider's dense HR/HRV/respiratory/SpO2/steps timeseries
  produce raw artifacts and zero generic sample rows by default.
- Core rejects large device-provider sample arrays without explicit
  `allowDenseDebugSamples`.
- The provider-agnostic dense timeseries reconciler does not write a second
  artifact for an already imported connection/resource/day/payload hash.
- Junction has a focused regression test because it is the first observed
  rolling-window offender.
- Backfill retries one failed dense day/resource without reimporting completed
  days.

### Cleanup Tests

- Legacy receipt compaction remains idempotent.
- Legacy canonical-record artifact becomes a tiny tombstone and manifest
  SHA/size update exactly.
- Provider raw evidence is untouched.
- Dense provider sample shard is deleted only when query/browser-vault output
  is unchanged.
- Explicit user CSV sample shard is skipped.
- Mixed-provenance sample shard is skipped.
- Optional dense raw timeseries tombstoning skips artifacts still used as sole
  evidence.
- No audit entry contains raw health payloads, sample arrays, provider bodies,
  local paths, secrets, or direct identifiers.
- `validateVault` passes.
- A strict raw manifest helper recomputes size/SHA for every touched raw file.

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
6. Apply Step 3 only where query/browser-vault equivalence is proven.
7. Re-measure. If the vault is still too large, decide and document the dense
   raw timeseries retention window before enabling Step 4.
8. Consider hosted cleanup only after operator dry-run/apply behavior is proven.

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
