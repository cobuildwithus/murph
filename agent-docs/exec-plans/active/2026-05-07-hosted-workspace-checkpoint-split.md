# Hosted Workspace Checkpoint Simplification

Status: final proposed plan
Last reviewed: 2026-05-07

## Goal

Replace hosted checkpointing with a clean, simple, long-term architecture:

```text
correctness barrier -> one fast working workspace commit
idle shutdown       -> full/base compaction
```

The priority is minimal complexity. The runtime should have one durable answer to:

```text
What workspace state will cold restore see?
```

Checkpoint reasons may remain as labels for logs, metrics, and tests, but they must stop deciding which subset of state is durable.

## Problem

The current architecture mixes two persistence scopes behind one `snapshotRef` contract:

- Full/base checkpoints persist the broader hosted workspace and regenerate the browser-vault replica.
- Hot checkpoints persist selected assistant runtime/Codex continuity and reuse the previous base plus previous browser-vault replica.

That is unsafe when the warm container has canonical vault edits.

Failure mode:

1. A hosted agent repairs a canonical vault file, such as an experiment markdown file under `bank/**`.
2. A hot checkpoint commits assistant/Codex continuity but not the repaired canonical file.
3. A cold restore replays the old base snapshot and loses the repair.
4. Idle shutdown later writes a full snapshot from the stale restored workspace and makes the loss durable.

This is not a browser-vault bug, not a CAS bug, and not primarily a typed-writer bug. It is a persistence-scope bug: warm filesystem state can look durable even when only assistant runtime state was checkpointed.

The invariant we need:

```text
If a checkpoint commits after code that may have changed canonical vault files,
then cold restore after that checkpoint must see those canonical changes.
```

## Current Snapshot Inventory

Current full/base checkpoints are broader than "vault plus `.codex-hosted`":

- They snapshot the vault root with the hosted workspace filter.
- They include canonical vault files such as `bank/**`, `journal/**`, `ledger/**`, `derived/**`, `raw/**`, `CORE.md`, and `vault.json` when present and allowed by the filter.
- They include portable local operational state under `.runtime/operations/**`, including assistant runtime continuity.
- They exclude machine-local state such as projections, cache, tmp, locks, process files, unsafe device-sync runtime state, credentials, and repair/quarantine residue.
- Large canonical artifacts under paths such as `raw/**` may be externalized into content-addressed artifact objects.
- Operator-home Codex continuity is not a broad `.codex-hosted/**` copy. It should be a small manifest plus only active manifest-referenced rollout JSONL files needed for hosted Codex resume.
- They do not include Codex auth, credentials, logs, history, SQLite metadata, cache, tmp, unreferenced sessions, or archived sessions.

Current hot checkpoints are intentionally assistant-only. They are useful as an implementation starting point, but they are not a valid durable workspace commit when canonical vault files changed.

## Final Architecture

Keep one logical workspace state pointer and make it represent the effective durable workspace.

```text
base snapshot
  broad cold-restore image written off the user-visible path

working delta
  latest authoritative fast portable workspace delta since base
  includes correctness-bearing canonical vault changes
  includes assistant runtime continuity
  includes required Codex continuity

idle shutdown
  materializes base + delta
  writes a new full/base snapshot
  clears/replaces delta
```

Use one overlay, not a chain:

```ts
type HostedExecutionSnapshotRefState =
  | HostedExecutionBundleRefState
  | HostedExecutionLayeredSnapshotRefState
  | HostedExecutionWorkingSnapshotRefState;

type HostedExecutionWorkingSnapshotRefState = {
  schema: "murph.hosted-execution-working-snapshot.v1";
  base: HostedExecutionBundleRefState;
  delta: HostedExecutionBundleRefState;
};
```

Use the existing full/base ref when there is no delta. The working ref shape should not represent empty or no-op states.

The old layered `base + hot` shape remains restore compatibility only. New producers should move to working commits.

## Base Manifest Foundation

Working commits require a stable base manifest. A bundle hash proves identity, but it does not tell the working commit builder which paths existed at base, which files were deleted, or which externalized artifact refs must be carried forward.

Every new full/base snapshot must include a portable workspace manifest generated from the same hosted snapshot inclusion/exclusion policy used to write the bundle.

The base manifest must record:

- every portable file included in the base snapshot
- path
- sha256
- size
- root/path class
- artifact ref for externalized entries
- snapshot policy version
- manifest hash

Old full/base snapshots without this manifest remain restorable. They are not eligible as a base for a working commit unless the manifest can be reconstructed once from the base bundle and validated.

Hard rule:

```text
if base is missing:
  write full/base seed

if base exists but has no portable manifest:
  reconstruct and validate manifest once, or write full/base seed

if base manifest reconstruction fails:
  fail closed
```

No working commit may be based only on `baseSnapshotHash`.

## Working Delta Contents

A working commit writes one portable workspace delta. The delta is authoritative for the portable workspace state that changed since the base snapshot.

Include:

- Portable file upserts.
- Portable file tombstones.
- Portable artifact refs required by those upserts.
- Portable assistant runtime continuity files as ordinary upserts/tombstones.
- Required Codex continuity files as ordinary upserts/tombstones, plus manifest validation.
- Metadata needed to validate the commit against its base snapshot.

Exclude:

- Browser-vault replica cache.
- Rebuildable projections.
- Parser outputs.
- Runtime logs and diagnostics.
- Cache, tmp, locks, sockets, pid files.
- Secrets, auth, credentials, and machine-local device-sync runtime DBs.

The manifest must support deletion and replacement:

```ts
type PortableWorkspaceDeltaManifest = {
  schema: "murph.portable-workspace-delta.v1";
  baseSnapshotHash: string;
  baseManifestHash: string;
  snapshotPolicyVersion: string;
  upserts: Array<{
    path: string;
    sha256: string;
    size: number;
    artifactRef?: HostedBundleArtifactRefState;
  }>;
  tombstones: Array<{
    path: string;
  }>;
  effectiveManifestHash: string;
};
```

The portable workspace manifest must be derived mechanically from the existing hosted snapshot inclusion/exclusion policy. Do not maintain a second hand-written list of "working commit paths" that can drift from full/base snapshot semantics.

The working commit builder should share the same path classifier as full/base snapshotting, then narrow by role:

```text
portable file changed -> working commit upsert/tombstone
machine-local/rebuildable/secret path -> excluded
unknown path class -> fail closed
```

Raw artifact handling is part of working commit correctness, not a restore afterthought. If a canonical file added or changed since base references or requires a canonical raw artifact, the working commit must either:

- include/materialize that artifact in the working commit, or
- carry a validated artifact ref that restore can resolve, verify, and preserve through later compaction.

The working commit must not allow a canonical file to become durable while its required canonical artifact remains only in warm local state.

Use the same artifact ref format and resolver path as full/base snapshots. Do not introduce a second artifact storage model for working deltas.

Restore must apply tombstones before upserts so old base files cannot resurrect.

```text
restore base
apply delta tombstones
apply delta upserts and artifact refs
verify Codex continuity manifest
verify effective manifest
```

## Working Commit Builder

Keep the runtime-facing API singular:

```ts
createHostedWorkspaceWorkingCommit(...)
```

Its job:

```text
read base portable manifest
scan current portable workspace through the shared hosted snapshot path classifier
compare current manifest to base manifest
emit one delta bundle/ref
```

Internal helpers may classify paths, collect manifest-validated Codex files, and preserve artifacts, but the bridge should expose only:

```text
createWorkingCommit()
createFullSeed()
createFullCompaction()
```

Do not grow a permanent matrix of hot/full/fallback/canonical builders.

## Checkpoint Policy

Long term, the bridge should stop asking:

```text
Does this reason mean hot or full?
```

It should ask:

```text
Is this a correctness barrier?       -> fast working workspace commit
Is this idle shutdown?               -> full/base compaction
Is this initial bootstrap no-base?   -> full/base seed
```

Correctness barriers include mailbox import, active-turn accepted input, outbox intent before provider send, provider receipt/failure after send, assistant runtime progress, and canonical vault edits after agent work.

If working commit creation cannot prove it captured all portable correctness-bearing state, it must fail closed. Failing closed can mean retrying later, refusing a provider-visible side effect, or writing a full/base seed when no valid base exists. It must not fall back to assistant-only hot state.

It must never silently commit assistant-only state after a canonical mutation.

## Hard-Cut Policy

Do not implement a long-lived intermediate producer policy that keeps assistant-only hot checkpoints as an accepted production path for correctness barriers.

The migration may add reader/parser compatibility first, but producer behavior should hard-cut to the new model:

```text
correctness checkpoint -> working workspace commit
idle shutdown          -> full/base compaction
bootstrap without base -> full/base seed
```

Reason strings remain accepted wire labels during compatibility, but no reason should select an assistant-only durable subset after the cutover.

The working commit builder must compute the effective portable workspace changes directly:

1. Compare current portable workspace state against the base snapshot manifest.
2. Emit upserts for added or changed portable files.
3. Emit tombstones for removed portable files.
4. Include portable assistant runtime and Codex continuity files through the same upsert/tombstone manifest.
5. Fail closed if portable state cannot be scanned, bounded, or represented safely.

Notifications and typed write receipts are useful observability and optimization, but they are not enough as the hard safety gate while hosted tools can still mutate files outside one constrained write API.

The old hot snapshot writer should remain only until the hard-cut producer switch lands. After that, it is restore compatibility and test fixture support, not a production checkpoint implementation.

Do not ship a multi-deploy interim state where legacy hot checkpoints remain production correctness barriers. Build compatibility and the working commit path together, then deploy the producer hard cut once.

## Idle Shutdown

Idle shutdown remains valuable, but only as compaction.

Algorithm:

```text
restore effective state from base + delta
write full/base snapshot
CAS HostedWorkspace.snapshotRef = newFullRef
destroy warm container if no pending work arrived
```

Idle shutdown must compact the effective current state, not the old base. The canonical repair regression must pass through both cold restore and idle compaction.

## Browser-Vault

Browser-vault is derived state. It must never make warm uncommitted state look durable.

For working refs, set `browserVaultReplicaRef = null`.

Do not carry forward the base browser-vault replica through a working ref. The existing replica identity is keyed to a source bundle hash, and `base + delta` is not the base bundle.

Browser-vault can be regenerated at idle compaction or later from the effective committed workspace. A future follow-up may attach browser-vault to working refs only after the protocol has an explicit effective-state identity for `base + delta`.

Missing browser-vault should degrade dashboard freshness, not force user-visible full checkpoint latency.

## Restore And Cache

Restore must be deterministic:

```text
if full/base ref:
  restore full bundle

if legacy layered ref:
  restore base
  clear assistant hot include roots
  restore old assistant hot state

if working ref:
  restore base
  apply delta tombstones
  apply delta upserts
  verify Codex continuity manifest
  verify effective manifest
```

The restore cache is disposable. It must not participate in correctness.

Cache hits require exact manifest verification:

```text
snapshot hash
snapshot size
restore policy version
portable file manifest hash
working delta manifest hash when a working ref is present
```

If verification is missing, stale, or too expensive, discard the local root and restore cleanly.

Restore is either destructive or manifest-pruned before applying source state. It must not overlay into an arbitrary warm root.

Vault restore must not leave stale files in place that no longer exist in the source snapshot or effective `base + delta` manifest.

Canonical externalized artifacts must be preserved. Either materialize canonical artifacts before snapshotting, or carry forward unmaterialized artifact refs from the previous base until a manifest/prune step proves the path was deleted.

## Device Sync And Parser State

Do not rely on full snapshots to save machine-local device-sync runtime DBs. Those paths are intentionally excluded.

Device-sync dirty handoff needs direct proof:

```text
dirty revision fetched
local work/handoff evidence recorded or provider results applied
checkpoint commits
dirty ack succeeds
container dies
cold restore can still complete, retry, or reconstruct the dirty work
```

Parser outputs stay excluded. If a parsed fact is correctness-bearing, persist it through assistant input/event evidence, outbox evidence, or the owning canonical record instead of treating parser output as durable checkpoint state.

## Hard-Cut Implementation

These steps describe implementation order inside one hard-cut release. They are not separate production deploy phases.

### Step 0: Failing Proofs

Add red tests before behavior changes:

- Canonical experiment repair followed by hot checkpoint survives cold restore.
- The same repair survives idle shutdown compaction.
- Canonical file deletion does not resurrect from base after restore or compaction.
- Correctness checkpoint reasons produce working refs, and production hot creation is unreachable for those reasons.
- Working refs schedule idle compaction instead of being classified as base-only.
- Device-sync dirty handoff survives checkpoint plus cold restore.
- Parser outputs can be deleted before restore while accepted input, outbox state, and terminal evidence survive.

### Step 1: Base Manifest Foundation

Add portable workspace manifests to new full/base snapshots.

- Manifest generation uses the existing hosted snapshot inclusion/exclusion policy.
- Manifest entries include path, hash, size, class, and artifact ref when externalized.
- Old base snapshots remain restorable.
- Old base snapshots are eligible for working commits only after manifest reconstruction and validation.

### Step 2: Working Ref Parser And Restore

Add `murph.hosted-execution-working-snapshot.v1` parser and restore support.

- Old full refs remain restorable.
- Old layered hot refs remain restorable.
- New working refs restore as base plus delta manifest.
- No producers write working refs yet.

This is compatibility-first, not a behavioral halfway state.

### Step 3: Working Commit Builder

Add `createHostedWorkspaceWorkingCommit(...)`.

- Read and validate the base portable manifest.
- Scan current state through the shared hosted snapshot path classifier.
- Emit one delta bundle with portable upserts, tombstones, manifest-validated Codex files, and required artifact refs.
- Use the same portable manifest path for assistant and Codex continuity; do not create separate runtime continuity lanes.
- Add edit/add/delete restore proofs.
- Do not wire producers to it yet.

### Step 4: Hard-Cut Producers To Working Commits

Switch correctness checkpoint producers from assistant-only hot snapshots to working commits in one scoped cutover.

- Include portable upserts/tombstones when portable files changed.
- Include assistant runtime continuity.
- Include required Codex continuity.
- Keep idle shutdown as full/base compaction.
- Keep old hot restore compatibility.
- Do not keep a canonical-clean `assistant_runtime_commit -> hot` production path.

The cutover includes:

- import
- active turn input
- active turn acceptance
- assistant runtime commit
- provider cleanup
- system mailbox receipt after activation split is represented
- outbox sending
- outbox receipt
- canonical runtime commit when a base exists

Bootstrap without a base remains a full/base seed. Idle shutdown remains full/base compaction.

### Step 5: Idle Compaction Cutover

Make idle shutdown compact the effective state:

```text
restore base + delta
write new full/base snapshot
replace snapshotRef with new base
```

The old behavior of compacting from stale base state must be impossible.

### Step 6: Browser-Vault Fallback Cleanup

Allow fast commits to proceed when browser-vault sidecar generation is missing or stale.

- Log degraded dashboard state.
- Do not force a full checkpoint on the user-visible path just to refresh browser-vault.
- Regenerate at idle compaction or from the effective committed workspace.

### Step 7: Retire Assistant-Only Hot Production

After the hard cut:

- Stop producing old assistant-only hot refs.
- Keep old restore compatibility until production has aged out old refs or migration tooling exists.
- Rename metrics away from hot/full as the main durability model.

## Deploy Shape

Ship one hard-cut production deploy:

```text
single release contains:
  base portable manifest
  working ref parser/restore
  working commit builder
  producer switch to working commits
  idle compaction from effective base + delta
  browser-vault null/degraded semantics for working refs
  old hot restore compatibility
```

No separate production stage should emit new assistant-only hot checkpoints for correctness barriers after the release. After any working ref is persisted, rollback must go only to a build that still parses and restores working refs. Do not roll back to a pre-working-ref build or use a feature flag that keeps two durability models alive.

## Test Matrix

Restore correctness:

- Canonical file addition survives cold restore.
- Canonical file edit survives cold restore.
- Canonical file deletion survives cold restore.
- Canonical edit survives idle compaction.
- Working ref tombstones prevent stale base resurrection.
- Legacy layered refs remain restorable.
- Working refs are not classified as base-only and do schedule idle compaction.
- Canonical metadata plus externalized `raw/**` artifact add/edit/delete survives cold restore and idle compaction.

Side-effect fences:

- Crash before import checkpoint replays mailbox.
- Crash after import checkpoint preserves staged input.
- Crash before outbox send causes no provider-visible side effect.
- Crash after outbox intent preserves send/retry state.
- Crash after provider send but before receipt preserves ambiguity or idempotent retry state.
- Crash after outbox receipt does not duplicate send.

Working commit correctness:

- Working commit contains portable upserts for changed portable files.
- Working commit contains tombstones for deleted portable files.
- Working commit rejects or fails closed on unknown portable state.
- Working commit includes required Codex continuity only.
- Working commit excludes secrets, cache, tmp, logs, and unreferenced Codex sessions.

Browser-vault:

- Missing replica does not block assistant progress after fallback cleanup.
- Working refs with portable changes clear or omit stale base replicas.
- Browser-vault session returns empty/degraded for a working ref without an effective-state replica, not `not_modified` from a stale base replica.
- Idle compaction regenerates or updates replica when possible.

Device sync and parser:

- Dirty ack happens only after a durable working commit or equivalent canonical provider result is committed.
- Dirty revision is not lost across checkpoint plus cold restore.
- Device-sync local DB exclusion has an explicit recovery path.
- Parser outputs may be deleted before restore, with accepted input, outbox state, terminal evidence, and assistant correctness preserved.

## Metrics

Track:

- checkpoint reason label
- checkpoint implementation: hot, working, full/base
- snapshot or working commit elapsed time
- working commit bytes and file count
- upsert count
- tombstone count
- full compaction elapsed time
- restore elapsed time by ref schema
- portable manifest scan failures
- workspace CAS conflicts
- mailbox lag
- outbox duplicate or ambiguous rates
- device-sync dirty rows stuck or acked
- browser-vault degraded state count

Expected result:

- Assistant progress stops depending on assistant-only hot durability.
- Canonical edits are durable at the same correctness barrier as assistant runtime state.
- Working commits remove full snapshot latency for ordinary correctness checkpoints.
- Idle shutdown becomes the main full/base snapshot producer.

## Non-Goals

- Do not introduce event sourcing.
- Do not add a web-owned run queue or a second workspace control plane.
- Do not create a generic capability matrix spread across packages.
- Do not make browser-vault canonical.
- Do not preserve assistant runtime state in canonical vault records.
- Do not trust notifications alone while hosted tools can still mutate canonical files directly.
- Do not keep layered assistant-hot production as a permanent abstraction.

## Final Recommendation

Do the full hard cut:

```text
fast working workspace commit at correctness barriers
full/base compaction at idle shutdown
old hot/full reason mapping only as restore compatibility
```

Implement additive parser/restore compatibility first inside the hard-cut release so old refs remain readable, then switch producers to working commits in the same release. Do not preserve a long-lived intermediate policy where some correctness barriers still produce assistant-only hot checkpoints.

This is the cleanest long-term model: one effective durable workspace state, cheap correctness barriers, and full snapshots only where they belong.
