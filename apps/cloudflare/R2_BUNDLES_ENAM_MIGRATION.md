# Hosted R2 bundles: OC to ENAM with Super Slurper

This runbook moves hosted bundle data with Cloudflare-managed
[Super Slurper](https://developers.cloudflare.com/r2/data-migration/super-slurper/).
There is no application-owned copier, copy journal, queue, or migration state.

The temporary runtime bridge remains in place until the ENAM destination is
active and the OC source has completed its fallback and URL drain. Promotion
changes `HOSTED_R2_CUTOVER_PHASE`; it does not transpose the fixed bucket
bindings.

## Fixed roles

- `BUNDLES` and `HOSTED_R2_PRESIGN_BUCKET_NAME` name the OC source.
- `BUNDLES_ENAM` and `HOSTED_R2_PRESIGN_ENAM_BUCKET_NAME` name the ENAM
  destination.
- `HOSTED_R2_CUTOVER_PHASE=source_active` keeps reads, writes, and new direct
  uploads on OC.
- `HOSTED_R2_CUTOVER_PHASE=destination_active` makes ENAM authoritative while
  retaining ENAM-to-OC read fallback and dual-bucket deletion.

Deploy preflight verifies that both source bindings report OC, both destination
bindings report ENAM, and every bucket uses Standard storage. Keep these roles
fixed until a later ENAM-only cleanup removes the bridge.

## Managed-copy contract

- The OC source is read-only to migration tooling. Never delete, rename, or
  overwrite a source object.
- Use temporary R2 credentials scoped to the required source and destination
  only. Keep credentials in the operator session; never print, persist, or pass
  them in command arguments.
- Do not overwrite destination objects. An existing destination object must
  already have the expected byte size.
- Copy only the approved immutable manifest. Exclude mutable fixed keys,
  unknown or unowned placement, legacy global placement, and lifecycle-managed
  raw email, private-media, and meal-photo objects.
- Verify exact object-key and byte-size parity. Do not require ETag parity:
  Super Slurper may use multipart transfer and produce a different destination
  ETag for identical bytes.
- Never promote a quarantined destination. A failed destination may be retained
  as evidence, but a new attempt uses a fresh ENAM bucket.

## Ownership and recovery decision

This is one indivisible, one-time managed migration transition:

- Cloudflare Super Slurper owns every copy mutation, job state, and transfer
  retry.
- The operator owns the private, read-only ownership query, in-memory approved
  manifest, exact-key job batches, terminal-job reconciliation, and two fresh
  key-and-size parity reads. Keep the exact keys and private identifiers out of
  repository artifacts; retain only aggregate evidence in the private change
  record.
- The application owns only the fixed-role deploy check and the temporary
  runtime cutover safety bridge.

No repository-executable migration verifier remains. Keeping one would turn a
completed one-time transition into a permanent production-database and object-
inventory integration. The managed rehearsal already proved the same operator
procedure against the real service. Production repeats it under the write
fence, using the authoritative read-only database path and independent R2
inventories described below. The operator must be able to reproduce the
manifest and both parity comparisons from a clean process before promotion; a
dashboard progress total alone is never sufficient proof.

Recovery is intentionally narrow. Before promotion, any unresolved job result,
key classification, ownership change, or parity mismatch quarantines the whole
destination and restarts with a fresh bucket. After ENAM accepts production
writes, recovery is forward-only and limited to identified missing approved
objects; broad copying and OC-only rollback are unsupported. There is no frozen-
window fallback or application-owned abnormal-stop command.

The runtime bridge remains because old direct-upload capabilities, warm Durable
Objects, lifecycle-managed objects, and deletion retries can legitimately refer
to either fixed bucket after transfer finishes. Remove it only after the URL,
lifecycle, fallback-observation, cold-restore, and OC-retirement gates at the end
of this runbook all pass.

## Dashboard wizard or jobs API

The dashboard wizard is the preferred whole-bucket path when a frozen source
inventory is exactly the approved migration manifest.

The production OC bucket may also contain excluded lifecycle, legacy, mutable,
or unowned objects. In that case, the whole-bucket wizard is unsafe. Use the
same managed Super Slurper service through its jobs API and provide exact
`source.keys` batches. Super Slurper accepts at most 10,000 explicit keys per
job; smaller byte-balanced batches make progress and recovery easier to audit.
Generate the manifest in memory from authoritative current ownership and
canonical snapshot state. Do not write keys or private identifiers to logs or
repository files.

## Production sequence

### 1. Deploy and prove the bridge

Deploy the two fixed bindings with `HOSTED_R2_CUTOVER_PHASE=source_active`.
Require current runner status from every relevant Durable Object and wait for
pre-bridge Worker and Durable Object invocations to drain. Ordinary reads,
writes, lists, and new direct uploads must still resolve to OC.

### 2. Close destructive and write admission

Enable the account-deletion maintenance control at both admission and effect
boundaries. Pause new workspace writes and direct-upload ticket issuance, then
drain current write invocations.

The production direct-PUT URL lifetime is ten minutes and the upload request
has a separate conservative ten-minute completion bound. Wait both intervals
after the last version capable of issuing an OC PUT ticket, then prove there is
no in-flight write, ticket issuance, or completion.

### 3. Build the approved manifest

Read current hosted ownership and canonical workspace snapshot state through
the authorized read-only production path. Inventory OC only after the write
drain. Admit immutable user-scoped bundle, artifact, browser-vault replica, and
unique workspace-snapshot keys owned by current hosted members.

Fail closed on mutable fixed keys, pre-v2 canonical snapshots, unknown
placement, lifecycle-managed placement, or ownership changes during the read.
Record aggregate counts and bytes only.

### 4. Run Super Slurper

Use the dashboard wizard only when the whole frozen source equals the approved
manifest. Otherwise create managed jobs with exact key batches and destination
overwrite disabled.

Wait for every job to reach a terminal state. If a job stalls or reports a
failure, reconcile that job's submitted keys against the destination by exact
key and size. Retry only missing or mismatched keys in a new managed job. Do
not infer failure solely from a stale progress counter, and do not change the
source to recover a destination problem.

### 5. Prove destination parity

After all jobs finish, inventory both buckets again under the same write fence.
Require:

- the source inventory and approved manifest are unchanged;
- every approved key exists in ENAM with the exact byte size;
- ENAM contains no unapproved migration object; and
- aggregate object and byte counts match.

Repeat the destination comparison from a fresh operator process. Revoke the
migration credential after the second pass.

### 6. Promote ENAM

Deploy the same bridge with:

```text
HOSTED_R2_CUTOVER_PHASE=destination_active
```

Require the destination-active Worker version at 100 percent and query every
relevant Durable Object until it reports the current bridge protocol and
destination-active phase.

While write admission remains closed, prove:

1. a copied pre-switch snapshot cold-restores;
2. a canary writes directly to ENAM;
3. the ENAM checkpoint cold-restores through a fresh current-version runner;
4. ENAM PUT, HEAD, GET, and delete smokes pass; and
5. source fallback occurs only after a definitive ENAM miss.

If any approved OC object is absent from ENAM, keep writes closed and repair
forward. Do not restart copying broadly or return to OC-only authority after
ENAM accepts production writes.

### 7. Resume service

Resume ordinary writes only after promotion checks pass. Re-enable account
deletion only after its race canary proves the bridge deletes from both
concrete buckets and retains state for retry after a partial failure.

Keep OC, the second binding, upload-session bucket affinity, dual deletion, and
ENAM-to-OC fallback through:

- expiry of every valid OC GET or PUT capability;
- empty OC lifecycle-managed prefixes;
- a bounded zero-fallback observation window covering retry and alarm cycles;
  and
- successful cold restores of both pre-switch and post-switch snapshots.

## Retire OC

OC retirement is a separate reviewed destructive operation. Before it, prove
that live configuration is ENAM-only, no valid OC credential or URL remains,
no source-only approved object exists, lifecycle-managed prefixes are empty,
account deletion is green against ENAM, and fallback stayed unused for the
approved soak.

Only after OC is retired should a follow-up change remove the second binding,
phase handling, read fallback, dual deletion, upload-session bucket affinity,
account-deletion maintenance control, and this runbook.
