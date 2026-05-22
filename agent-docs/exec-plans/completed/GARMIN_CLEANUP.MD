# Final migration guide: simplest clean architecture

After stress-testing this against the repo, I would implement **one narrow hosted housekeeping lane** and **one narrow core vault repair**.

Do **not** build a generic maintenance framework yet.

The maximally simple end-state is:

```text
hosted runtime
  owns: cheap detection, wake scheduling, budget, dirty-state/checkpoint orchestration

vault-usecases
  owns: thin composed service wrapper only, if assistant-runtime should not import core directly

core
  owns: receipt compaction, raw manifest rewrite, audit append, validation/integrity checks

importers
  continue producing modern payload-free wearable raw envelopes

query/browser-vault
  unchanged
```

The job is:

```text
legacy-wearable-receipt-compaction-v1
```

It is not “Garmin cleanup,” “WHOOP cleanup,” “raw artifact cleanup,” or “snapshot GC.” It is exactly:

> Remove only legacy top-level `payload` from `wearable-raw-envelope:*` receipt artifacts, only when exact duplicate provider evidence is proven, while preserving all raw artifact paths, roles, canonical records, ledgers, metric samples, and query-visible evidence.

---

# Why this is the right simplification

The repo already has the right architectural separation:

* `packages/core` is the canonical mutation owner and also owns raw attachments/manifests. `ARCHITECTURE.md:23`
* `packages/importers` normalize provider snapshots and delegate writes to core. `ARCHITECTURE.md:24`
* `packages/query` owns read/query projections and must not mutate vault data. `packages/query/README.md:3`
* Hosted runtime keeps dirty state local until the runtime-owned `idle_shutdown` checkpoint publishes it. `ARCHITECTURE.md:40`, `packages/assistant-runtime/src/hosted-runtime.ts:878-887`, `packages/assistant-runtime/src/hosted-runtime.ts:1546-1550`

The current wearable raw envelope is already receipt-only. It has `payloadHash`, `rawArtifactRoles`, and `rawArtifactCount`, but no `payload` field. `packages/importers/src/device-providers/raw-ingest-envelope.ts:18-40`, `packages/importers/src/device-providers/raw-ingest-envelope.ts:63-102`

So the migration is not a semantic redesign. It is a legacy receipt-shape repair.

---

# Target architecture

## 1. One hosted housekeeping lane, not a generic job framework

Add one small non-AI lane outside assistant execution:

```text
packages/assistant-runtime/src/hosted-runtime/workspace-housekeeping.ts
```

This lane should recognize exactly one wake reason:

```ts
export const HOSTED_LEGACY_WEARABLE_RECEIPT_COMPACTION_WAKE_REASON =
  "legacy-wearable-receipt-compaction-v1";
```

Do **not** add:

```text
MaintenanceJob
MaintenanceQueue
WorkspaceMaintenanceRecord
durable cursors
provider cleanup registry
raw artifact retention policies
generic raw rewrite API
generic raw delete API
```

The current hosted workspace already has:

```text
nextWakeAt
nextWakeReason
```

in the workspace row/state. `apps/web/src/lib/hosted-workspace/store.ts:109-128`, `apps/web/src/lib/hosted-workspace/store.ts:270-277`

Use that single wake slot. Do not add a second one.

The lane should do only this:

```text
if workspace.nextWakeReason === legacy-wearable-receipt-compaction-v1
and workspace.nextWakeAt is due
and there is no fresh conversation input
then run the bounded compaction usecase
else do nothing
```

Important: do **not** key this off `request.reason === "alarm"`. The web runtime-demand path invokes due workspace wakes as `reason: "nudge"` with `source: "workspace_wake"`. `apps/web/src/lib/hosted-orchestration/runtime-demand.ts:390-398`

Also, non-assistant workspace wake reasons are not AI-gated. Only `"assistant"` and `"assistant_due"` are model-capable in the current web demand logic. `apps/web/src/lib/hosted-orchestration/runtime-demand.ts:288-305`, `apps/web/src/lib/hosted-orchestration/runtime-demand.ts:547-550`

## 2. Do not route this through `runHostedWorkspaceAssistantPhase`

The existing assistant phase is the wrong abstraction for this job.

It hydrates the assistant execution context before it reaches the timer lane. `packages/assistant-runtime/src/hosted-runtime/workspace-assistant-phase.ts:237-292`

It treats due workspace wakes as `alarm`-only. `packages/assistant-runtime/src/hosted-runtime/workspace-assistant-phase.ts:1567-1590`

It filters exposed next-wake reasons down to device-sync reconcile. `packages/assistant-runtime/src/hosted-runtime/workspace-assistant-phase.ts:2340-2355`

That would make a non-AI maintenance job both heavier and more fragile than necessary.

The new housekeeping lane should run before assistant hydration when the workspace wake is clearly a housekeeping wake.

---

# Core migration

## 1. Extract one shared wearable payload hash helper

Current importer code computes the wearable raw envelope `payloadHash` using stable JSON normalization/stringification. `packages/importers/src/device-providers/raw-ingest-envelope.ts:63-69`, `packages/importers/src/device-providers/raw-ingest-envelope.ts:122-150`

Core needs the same algorithm to prove that legacy envelope payloads duplicate provider evidence. Core should not import importers.

Add a small helper in core:

```text
packages/core/src/wearable-raw-payload-hash.ts
```

Suggested exports:

```ts
export function stableStringifyWearableRawPayload(value: unknown): string;
export function hashWearableRawPayload(value: unknown): string;
```

Then update:

```text
packages/importers/src/device-providers/raw-ingest-envelope.ts
```

to use the core helper.

This avoids duplicating a hash algorithm and avoids a core → importers dependency cycle. It is a small, stable, behavior-level core export, not a new framework.

## 2. Add one core usecase

Add:

```text
packages/core/src/legacy-wearable-receipt-compaction.ts
```

or, even cleaner:

```text
packages/core/src/wearable-receipts.ts
```

Recommended public functions:

```ts
export function detectLegacyWearableReceiptCompaction(input: {
  vaultRoot: string;
  maxManifestBytes?: number;
}): Promise<{
  hasWork: boolean;
  suspectedCount: number;
  largestSuspectByteSize?: number;
}>;

export function compactLegacyWearableReceiptEnvelopes(input: {
  vaultRoot: string;
  maxEnvelopes?: number;
  maxCandidateBytes?: number;
  deadlineMs?: number;
  now?: Date;
}): Promise<{
  mutated: boolean;
  compactedCount: number;
  skippedCount: number;
  bytesBefore: number;
  bytesAfter: number;
  hasMore: boolean;
  touchedPaths: string[];
}>;
```

Keep all helper types private unless tests need them.

## 3. The detector must be cheap

The fresh-message path should not parse huge legacy envelope payloads.

The detector should:

```text
scan raw manifests
find artifacts whose role starts with wearable-raw-envelope:
look at manifest byteSize
optionally read a small prefix only
return hasWork/suspectedCount
```

It may false-positive. That is fine.

It should not:

```text
parse giant envelope JSON
read provider raw artifacts
mutate the vault
validate the vault
emit audit
```

## 4. The compactor must be conservative

The compactor may read and parse legacy candidates because it runs only in the non-AI maintenance wake and is bounded.

A candidate is eligible only when all of these are true:

```text
1. The manifest artifact role starts with wearable-raw-envelope:.

2. The envelope file exists.

3. The envelope file is a JSON object.

4. The envelope has an own top-level payload field.

5. The envelope has a string payloadHash.

6. hashWearableRawPayload(envelope.payload) === envelope.payloadHash.

7. The manifest entry for the old envelope matches the actual current envelope file:
   actual byteSize === manifest byteSize
   actual sha256   === manifest sha256

8. Every evidence role listed in envelope.rawArtifactRoles exists in the same raw import manifest set.

9. Every evidence file used for proof exists and its actual sha256 matches the manifest sha256.

10. At least one non-envelope, non-canonical evidence artifact gives exact duplicate proof:
    hashWearableRawPayload(parsedEvidenceJsonOrText) === envelope.payloadHash
    or a future trusted metadata field explicitly records the same payloadHash.
```

The critical point:

> Manifest-listed roles plus checksums prove evidence existence and integrity. They do **not** prove that the legacy envelope payload is duplicated.

So v1 must not compact merely because `rawArtifactRoles` exist.

False negatives are acceptable. False positives are not.

## 5. Exact duplicate proof should stay generic

Use generic proof, not provider branches.

Good generic proof:

```text
role is listed in envelope.rawArtifactRoles
role is listed in manifest
file exists
file sha256 matches manifest
file parses as JSON or is raw text
hashWearableRawPayload(fileValue) equals envelope.payloadHash
```

Do not add:

```text
if provider === "garmin" reconstruct payload from epoch summaries
if provider === "junction" reconstruct timeseries
if provider === "whoop" reconstruct cycles/recoveries/workouts
```

Garmin epoch-summary artifacts, Junction timeseries artifacts, and WHOOP raw artifacts are provider evidence. They are not generic proof that an old top-level envelope payload is duplicated.

## 6. The mutation is a narrow raw-rewrite exception

Raw artifacts are normally immutable. The write policy blocks raw text writes unless `allowRaw` is explicitly set. `packages/core/src/write-policy.ts:83-139`

Raw copy staging is immutable/create-or-reuse. `packages/core/src/write-policy.ts:214-249`, `packages/core/src/operations/write-batch.ts:1269-1393`

So this needs to be documented as the one narrow exception:

> Legacy `wearable-raw-envelope:*` files are receipt artifacts. They may be rewritten in-place from payload-bearing legacy shape to receipt-only modern shape after exact duplicate evidence proof.

Use the existing canonical write machinery for locking/rollback mechanics, but do not expose a generic raw rewrite API.

Recommended implementation:

```ts
await runCanonicalWrite({
  vaultRoot,
  operationType: "legacy_wearable_receipt_compaction",
  summary: "Compact legacy wearable raw envelope receipts",
  hostedCanonicalWritePort: null,
  hostedCanonicalWriteReceiptDirectory: null,
  mutate: async ({ batch }) => {
    await batch.stageTextWrite(envelopePath, compactedEnvelopeJson, {
      allowRaw: true,
      overwrite: true,
    });

    await batch.stageTextWrite(manifestPath, rewrittenManifestJson, {
      allowRaw: true,
      overwrite: true,
    });

    await emitAuditRecord({
      vaultRoot,
      batch,
      action: "vault_repair",
      commandName: "core.compactLegacyWearableReceiptEnvelopes",
      summary: "...metadata only...",
      changes: [...]
    });
  },
});
```

Why explicitly pass `hostedCanonicalWritePort: null` and `hostedCanonicalWriteReceiptDirectory: null`?

Because hosted canonical replay has a raw conflict guard for existing raw bytes. Replaying a raw `text_upsert` against a workspace that already has the old raw envelope bytes can throw `HOSTED_CANONICAL_WRITE_RAW_CONFLICT`. `packages/core/src/operations/write-batch.ts:572-593`

For this job, the published hosted snapshot is the durable result. The runtime can mark the workspace dirty from the returned `mutated` flag. Do not rely on hosted canonical write receipts for the raw rewrite.

## 7. Update raw manifests exactly

The raw manifest builder stores `byteSize` and `sha256` for each raw artifact. `packages/core/src/operations/raw-manifests.ts:88-101`

The vault validator checks manifest shape, ownership, directory constraints, and file existence. It does **not** recompute artifact `byteSize` and `sha256`. `packages/core/src/vault.ts:818-847`

Therefore the compactor must include its own strict integrity helper:

```ts
assertManifestArtifactMatchesFile(vaultRoot, artifact)
```

Use it before proof and after rewrite.

After compacting an envelope:

```text
same envelope relativePath
same manifest artifact role
new byteSize
new sha256
same rawDirectory
same manifest owner
same provider raw artifact paths
same canonical wearable records paths
same event/sample ledgers
```

## 8. Handle multiple manifests without cleverness

The repo accepts both:

```text
manifest.json
manifest.*.json
```

as raw manifest files. `packages/core/src/operations/raw-manifests.ts:70-75`

For v1:

```text
if exactly one manifest lists the envelope:
  update that manifest

if multiple manifests list the envelope and they agree on old byteSize/sha256:
  update all of them

if multiple manifests disagree:
  skip the candidate
```

Do not partially update.

## 9. Audit with the existing schema

The audit schema is strict and has only:

```text
action
status
occurredAt
actor
commandName
summary
targetIds
errorCode
changes
```

`packages/contracts/src/zod.ts:1023-1048`

There is no free-form metadata object.

Use existing action:

```text
vault_repair
```

because it already exists in `AUDIT_ACTIONS`. `packages/contracts/src/constants.ts:185-238`

Do not add a new audit action in v1 unless you specifically need analytics segmentation.

Audit summary should be metadata-only, for example:

```text
Compacted 3 legacy wearable raw envelope receipt(s);
bytesBefore=42183492;
bytesAfter=8421;
proof=payload_hash_match;
job=legacy-wearable-receipt-compaction-v1.
```

Do not put payloads, provider bodies, sample arrays, timeseries bodies, or canonical record bodies in audit/logs.

---

# Hosted runtime migration

## 1. Add a housekeeping hook before assistant hydration

Add an optional hook to the hosted runner:

```ts
runHousekeepingPhase?: (input: HostedWorkspaceHousekeepingPhaseInput) =>
  Promise<HostedWorkspaceHousekeepingPhaseResult>
```

Call it in `runHostedWorkspaceUntilIdleOrBudget` after the initial mailbox import has been recorded, but before assistant phase hydration.

The current runner already records initial mailbox import and dirty state before assistant execution. `packages/assistant-runtime/src/hosted-runtime/workspace-runner.ts:318-358`

The new flow should be:

```text
restore workspace
import mailbox as today
record mailbox import
if due housekeeping wake and no fresh conversation input:
  run housekeeping
  mark runtime dirty if mutated or wake metadata changed
  return without assistant phase
else:
  continue existing assistant path
```

This ensures fresh user messages win over maintenance.

## 2. Housekeeping wake detection must ignore request reason

Do not copy the current assistant-phase due-wake logic, because it checks `request.reason === "alarm"`. `packages/assistant-runtime/src/hosted-runtime/workspace-assistant-phase.ts:1567-1590`

Use:

```ts
function isDueLegacyWearableReceiptCompactionWake(input) {
  return (
    input.workspace?.nextWakeReason === HOSTED_LEGACY_WEARABLE_RECEIPT_COMPACTION_WAKE_REASON &&
    input.workspace.nextWakeAt !== null &&
    Date.parse(input.workspace.nextWakeAt) <= nowMs
  );
}
```

Do not require:

```ts
input.request.reason === "alarm"
```

The web demand layer will usually invoke it as `nudge`.

## 3. Fresh message scheduling must not create a pre-checkpoint race

The hosted runtime has a dirty loop that can service projected wakes before the idle checkpoint. `packages/assistant-runtime/src/hosted-runtime.ts:820-856`

The default idle checkpoint delay is 180 seconds. `packages/assistant-runtime/src/hosted-runtime.ts:1213`, `packages/assistant-runtime/src/hosted-runtime.ts:1375-1380`

Therefore, do not schedule a maintenance wake as “due now” from a dirty foreground message pass. It can run before the reply snapshot is checkpointed.

Use this invariant:

```text
A maintenance wake scheduled from a dirty foreground invocation must not become due
before the current idle checkpoint window can publish the foreground reply state.
```

Simplest implementation:

```ts
maintenanceWakeAt = now + idleCheckpointDelayMs + 5_000;
```

Only the outer hosted runtime knows `idleCheckpointDelayMs`, so the outer runtime should merge this, not core and not assistant phase.

## 4. Do not clobber existing non-maintenance wakes

This is the biggest composability trap.

The hosted workspace has a single `nextWakeAt`/`nextWakeReason`. The wake selector chooses the earliest wake and has only a small device-sync priority rule. `packages/assistant-runtime/src/hosted-runtime/wake-candidates.ts:19-67`

So do not overwrite assistant/device-sync/mailbox wakes with maintenance.

Fresh detection rule:

```text
if projected next wake is absent:
  schedule legacy-wearable-receipt-compaction-v1 after idle checkpoint window

if projected next wake is already legacy-wearable-receipt-compaction-v1:
  keep/update it

if projected next wake is any other reason:
  do not schedule maintenance
```

This makes the compaction opportunistic rather than guaranteed. That is the right tradeoff for v1. Guaranteeing independent maintenance scheduling requires either a second wake slot or a real queue, which is exactly the complexity we are avoiding.

## 5. Maintenance wake result rules

When the maintenance wake runs:

```text
compactor mutated and hasMore=false:
  clear nextWakeAt/nextWakeReason
  mark runtime dirty

compactor mutated and hasMore=true:
  schedule same maintenance wake after current dirty checkpoint window
  mark runtime dirty

compactor found no work:
  clear stale maintenance wake
  mark runtime dirty only if wake metadata changed

fresh conversation input appeared:
  do not compact
  let assistant foreground path win
  later fresh-detection can opportunistically reschedule if wake slot is free
```

The actual snapshot publication remains the existing `idle_shutdown` checkpoint. `packages/assistant-runtime/src/hosted-runtime.ts:1546-1550`

Do not add a new checkpoint reason unless the product needs it for observability. Existing checkpoint reasons are finite and typed. `packages/hosted-execution/src/runtime-control.ts:606-620`

For dirty-state logging, reuse existing runtime dirty/checkpoint mechanics rather than extending the control-plane contract.

---

# Query/browser-vault migration

No query changes.

No browser-vault schema changes.

No `readVault()` changes.

No `query_metric_points` changes.

Why: query already treats dense provider telemetry as raw/debug evidence and metric rows as compact projections. `packages/query/README.md:7`

Metric points are stored/read through `query_metric_points`. `packages/query/src/query-projection.ts:357-380`, `packages/query/src/query-projection.ts:712-722`

Browser-vault metric rows are derived from `MetricPoint[]`, and hosted browser-vault refresh reads `readVault()` plus `listMetricPoints()`. `packages/query/src/browser-replica/metric-points.ts:25-40`, `packages/assistant-runtime/src/hosted-runtime/browser-vault-replica.ts:122-135`

Compacting a raw receipt may change source hashes and cause a refresh, but the metric row contents should remain identical.

---

# Exact invariant checklist

These should become comments/tests around the implementation.

## Raw/evidence invariants

```text
Provider raw artifacts are never deleted.
Provider raw artifacts are never rewritten.
Canonical wearable records artifacts are never deleted.
Canonical wearable records artifacts are never rewritten.
Garmin epoch-summary artifacts are preserved.
Junction timeseries artifacts are preserved.
WHOOP raw artifacts are preserved.
Only wearable-raw-envelope:* files may be rewritten.
Only the top-level payload field may be removed from those files.
```

## Path/reference invariants

```text
Envelope relativePath is unchanged.
Manifest artifact role is unchanged.
Manifest rawDirectory is unchanged.
Event rawRefs are unchanged.
Sample ledgers are unchanged.
Event ledgers are unchanged.
Canonical event ids are unchanged.
```

This matters because device event IDs include `rawArtifactRoles` in their deterministic ID basis. `packages/core/src/mutations.ts:1105-1162`

Event `rawRefs` are resolved from raw artifact roles into raw file paths during import. `packages/core/src/mutations.ts:1384-1417`

## Manifest invariants

```text
Every touched manifest remains valid JSON.
Every touched manifest still parses as RawImportManifest.
Every touched artifact remains inside the manifest rawDirectory.
Every touched artifact exists.
Every touched artifact actual byteSize equals manifest byteSize.
Every touched artifact actual sha256 equals manifest sha256.
```

The last two are not guaranteed by existing `validateVault()` and must be enforced by the compactor.

## Ledger invariants

```text
Do not rewrite append-only JSONL ledgers.
Only append an audit record.
Audit is metadata-only.
```

The architecture describes machine truth as append-only JSONL ledgers. `ARCHITECTURE.md:53`

## Hosted runtime invariants

```text
Fresh conversation input wins over maintenance.
Maintenance does not hydrate assistant context.
Maintenance does not call the model.
Maintenance does not run device sync.
Maintenance does not checkpoint directly.
Maintenance marks runtime dirty; outer runtime publishes via idle_shutdown.
Maintenance wake detection does not require request.reason === "alarm".
Maintenance scheduling never clobbers a non-maintenance wake.
```

---

# Explicitly out of scope for v1

Keep this list in the PR description.

```text
No provider raw artifact deletion.
No canonical wearable records deletion.
No Garmin/Junction/WHOOP provider-specific cleanup.
No provider-specific payload reconstruction.
No raw artifact garbage collection.
No raw tombstones.
No rawRefs rewrite.
No event ledger rewrite.
No sample ledger rewrite.
No metric_sample rewrite.
No query projection schema change.
No browser-vault schema change.
No generic hosted maintenance queue.
No durable maintenance cursor.
No new workspace DB fields.
No global scan of all hosted workspaces.
No AI/model call.
No user-facing progress UI.
No new checkpoint reason unless observability absolutely requires it.
No new audit action unless analytics absolutely requires it.
```

I would recommend **no deletion** in v1.

Deleting provider raw artifacts or canonical records would require a much larger model:

```text
prove no historical rawRefs point to the file
rewrite or tombstone manifest entries
define validation semantics for tombstoned raw evidence
define append-only ledger semantics for missing evidence
decide how hosted canonical receipts replay deletes
extend raw path deletion policy
guard query/browser-vault against missing historical evidence
```

The current write batch API does not allow raw deletion through normal staged delete. `packages/core/src/operations/write-batch.ts:1456-1479`

So deletion is the wrong first migration.

---

# Minimal test suite

## Core tests

### 1. Happy path compaction

Fixture:

```text
raw/integrations/garmin/.../
  01-garmin-provider-snapshot.json
  02-garmin-raw-ingest-envelope-legacy.json
  03-garmin-canonical-wearable-records.json
  04-epoch-summary-abc.json
  manifest.json

ledger/events/...jsonl
ledger/metric-samples/...jsonl if needed
```

Legacy envelope contains top-level `payload`.

Provider snapshot exactly duplicates the payload under `hashWearableRawPayload`.

Assert:

```text
payload removed from envelope
envelope path unchanged
payloadHash unchanged
rawArtifactRoles unchanged
rawArtifactCount unchanged
provider snapshot bytes unchanged
canonical wearable records bytes unchanged
epoch summary bytes unchanged
event ledgers unchanged
event rawRefs unchanged
metric sample ledgers unchanged
manifest envelope byteSize/sha256 updated
other manifest entries unchanged
audit appended
audit does not contain payload sentinel
validateVault() passes
strict touched-artifact sha/size check passes
```

### 2. Idempotency

Run compactor twice.

Assert:

```text
first run compactedCount = 1
second run compactedCount = 0
second run does not append another audit record
second run does not change any file hash
```

### 3. Bounded resumability

Create three eligible legacy envelopes.

Run with:

```text
maxEnvelopes = 1
```

Assert:

```text
run 1: compactedCount=1, hasMore=true
run 2: compactedCount=1, hasMore=true
run 3: compactedCount=1, hasMore=false
run 4: compactedCount=0, hasMore=false
```

No durable cursor should exist.

### 4. Already modern receipt

Envelope has no top-level `payload`.

Assert:

```text
no mutation
no audit
no manifest change
```

### 5. Payload hash mismatch

Envelope has payload but:

```text
hashWearableRawPayload(payload) !== envelope.payloadHash
```

Assert:

```text
skip
no mutation
no audit
```

### 6. Missing evidence role

Envelope references a role not listed in manifest.

Assert:

```text
skip
no mutation
```

### 7. Evidence checksum mismatch

Evidence artifact exists, but actual sha256 does not match manifest sha256.

Assert:

```text
skip
no mutation
```

This guards the fact that existing vault validation does not recompute manifest checksums.

### 8. Split provider artifacts without exact duplicate proof

Fixture with Garmin epoch-summary artifacts and a legacy envelope payload, but no single evidence artifact whose wearable payload hash equals `payloadHash`.

Assert:

```text
skip
epoch-summary artifacts preserved
```

This prevents provider-specific reconstruction logic from sneaking into v1.

### 9. Multiple manifests

Case A:

```text
two manifests list envelope and agree on old byteSize/sha256
```

Assert:

```text
both manifests updated
```

Case B:

```text
two manifests list envelope and disagree
```

Assert:

```text
skip
no partial update
```

### 10. No raw deletion

Assert before/after raw file set:

```text
all non-envelope raw paths still exist
all canonical wearable records paths still exist
all provider raw artifact paths still exist
```

## Runtime tests

### 11. Due workspace wake runs as `nudge`

Set workspace:

```text
nextWakeAt = past
nextWakeReason = legacy-wearable-receipt-compaction-v1
```

Invoke with request reason:

```text
nudge
```

Assert:

```text
housekeeping runs
assistant phase does not run
model does not run
device sync does not run
runtime dirty marked when mutation occurs
idle_shutdown checkpoint publishes compacted snapshot
```

### 12. Fresh message wins

Set due maintenance wake and import fresh conversation input.

Assert:

```text
compactor is not called before foreground reply path
assistant path runs
maintenance is not allowed to delay reply
```

### 13. Fresh detection scheduling is checkpoint-safe

After a dirty foreground pass with detected legacy state:

```text
scheduled maintenance wake time > now + idleCheckpointDelayMs
```

Assert the dirty loop does not service maintenance before the `idle_shutdown` checkpoint.

This guards `packages/assistant-runtime/src/hosted-runtime.ts:820-856`.

### 14. Do not clobber non-maintenance wake

If assistant/device/mailbox already produced a next wake, assert:

```text
maintenance is not scheduled
existing wake reason/time preserved
```

### 15. Stale maintenance wake clears

Workspace has maintenance wake scheduled, but compactor finds no work.

Assert:

```text
nextWakeAt cleared
nextWakeReason cleared
runtime dirty marked only for wake metadata change
no audit if no vault mutation
```

### 16. Budget exhaustion reschedules

Compactor returns:

```text
hasMore = true
```

Assert:

```text
same maintenance reason rescheduled
rescheduled wake is not due before current dirty checkpoint window
completed mutations still publish via idle_shutdown
```

### 17. Query/browser-vault content unchanged

Build query/browser-vault metrics before and after compaction.

Assert:

```text
query_metric_points rows identical
browser-vault metric rows identical
wearable latest/day-summary query-visible content identical
```

A refresh may happen because source hashes changed, but rows should not.

---

# Suggested implementation order

## Step 1: shared hash helper

Add core helper:

```text
packages/core/src/wearable-raw-payload-hash.ts
```

Update importer envelope builder to use it.

Add parity tests against existing known payloads.

## Step 2: core detector and compactor

Add:

```text
packages/core/src/wearable-receipts.ts
```

Export only:

```ts
detectLegacyWearableReceiptCompaction
compactLegacyWearableReceiptEnvelopes
```

Keep proof, manifest indexing, strict checksum validation, and skip-code helpers private.

## Step 3: thin usecase seam

If assistant-runtime should continue using `vault-usecases` as the composed owner surface, add a thin wrapper there.

Do not put mutation logic in `vault-usecases`. The architecture says it must stay a thin composition layer over core/importers/query. `ARCHITECTURE.md:31`

## Step 4: hosted housekeeping lane

Add:

```text
packages/assistant-runtime/src/hosted-runtime/workspace-housekeeping.ts
```

It should:

```text
recognize the one maintenance wake reason
check due time independent of request.reason
skip when fresh conversation input exists
call the vault-usecases/core compactor
return redacted result
```

## Step 5: runner integration

Integrate the housekeeping hook in `runHostedWorkspaceUntilIdleOrBudget` after initial mailbox import and before assistant hydration.

This keeps the lane non-AI and avoids the existing assistant-phase wake filtering.

## Step 6: fresh-message detector

In the outer hosted runtime, after the foreground pass result is available and before building the final checkpoint projection:

```text
if foreground path was dirty
and no non-maintenance wake is already selected
and cheap detector says hasWork
then schedule maintenance wake after idleCheckpointDelayMs + grace
```

Do not schedule due-now.

Do not clobber an existing non-maintenance wake.

## Step 7: architecture docs

Update `ARCHITECTURE.md` with one narrow exception:

```text
Imported provider raw artifacts remain immutable evidence.
wearable-raw-envelope:* artifacts are receipt artifacts.
Legacy payload-bearing wearable receipt artifacts may be rewritten in-place
to the modern receipt-only shape by legacy-wearable-receipt-compaction-v1
after exact duplicate provider evidence is proven.
```

This is important because the current architecture says raw imported artifacts are immutable. `ARCHITECTURE.md:54`

---

# Final recommended end state

The cleanest architecture is:

```text
One wake reason:
  legacy-wearable-receipt-compaction-v1

One runtime lane:
  hosted workspace housekeeping, non-AI, outside assistant phase

One core mutation:
  compact legacy wearable receipt envelopes

One mutation target:
  wearable-raw-envelope:* files with top-level payload

One proof standard:
  payloadHash-equivalent provider evidence, manifest-listed and checksum-verified

One publication path:
  existing dirty state + idle_shutdown checkpoint

Zero deletion:
  provider raw artifacts, canonical wearable records, events, samples, metric rows all preserved
```

This keeps the system composable without introducing a premature maintenance framework. It gives you the snapshot-size win where it is provably safe, while preserving the repo’s existing raw evidence, append-only ledger, rawRef, query, browser-vault, and hosted checkpoint invariants.
