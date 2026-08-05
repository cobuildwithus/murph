# Hosted R2 bundles: live OC to ENAM cutover with Super Slurper

This runbook moves hosted bundle data with Cloudflare-managed
[Super Slurper](https://developers.cloudflare.com/r2/data-migration/super-slurper/).
There is no application-owned copier, copy journal, queue, or migration state.
Healthy execution keeps Murph replies, workspace checkpoints, and direct uploads
available throughout the cutover.

The temporary runtime bridge remains in place until the ENAM destination is
active and the OC source has completed its writer, fallback, lifecycle, and URL
drain. Promotion changes `HOSTED_R2_CUTOVER_PHASE`; it does not transpose the
fixed bucket bindings.

## Fixed roles

- `BUNDLES` and `HOSTED_R2_PRESIGN_BUCKET_NAME` name the OC source.
- `BUNDLES_ENAM` and `HOSTED_R2_PRESIGN_ENAM_BUCKET_NAME` name the ENAM
  destination.
- `HOSTED_R2_CUTOVER_PHASE=source_active` keeps reads, writes, and new direct
  uploads on OC.
- `HOSTED_R2_CUTOVER_PHASE=destination_active` makes ENAM authoritative while
  retaining ENAM-to-OC read fallback and dual-bucket deletion.
- `HOSTED_R2_WRITE_ADMISSION=open` admits normal runtime starts and wakes. Keep
  it `open` throughout the healthy migration and live promotion.
- `HOSTED_R2_WRITE_ADMISSION=paused` is incident containment, not a planned
  migration step. It makes the Worker return `retry_later` before any UserRunner
  Durable Object call, so the encrypted mailbox remains the durable backlog
  while current invocations drain.
- `HOSTED_R2_PAUSED_CANARY_USER_ID_SHA256` is an emergency-only lowercase
  SHA-256 digest of one operator-selected member ID. It never contains the raw
  member ID and is valid only while the phase is `destination_active` and write
  admission is `paused`.

Deploy preflight verifies that both source bindings report OC, both destination
bindings report ENAM, and every bucket uses Standard storage. Keep these roles
fixed until a later ENAM-only cleanup removes the bridge.

## Managed-copy contract

- The OC source is read-only to migration tooling. Never delete, rename, or
  overwrite a source object.
- Use temporary R2 credentials scoped to read-only source access and read/write
  destination access. Keep credentials in the operator session; never print,
  persist, or pass them in command arguments.
- Do not overwrite destination objects. An existing destination object must
  already have the expected byte size.
- Copy only the approved immutable manifest. Exclude mutable fixed keys,
  unknown or unowned placement, legacy global placement, and lifecycle-managed
  raw email, private-media, and meal-photo objects.
- Before promotion, prove exact key-and-size inclusion for the current approved
  source manifest. After promotion, prove the stable approved source manifest is
  a key-and-size-matching subset of ENAM. Legitimate post-promotion ENAM writes
  make whole-bucket equality invalid. Do not require ETag parity: Super Slurper
  may use multipart transfer and produce a different destination ETag for
  identical bytes.
- Never promote a quarantined destination. A failed destination may be retained
  as evidence, but a new attempt uses a fresh ENAM bucket.

## Ownership and recovery decision

This is one indivisible, one-time managed migration transition:

- Cloudflare Super Slurper owns every copy mutation, job state, and transfer
  retry.
- The operator owns the private, read-only ownership query, in-memory approved
  manifest, exact-key job batches, terminal-job reconciliation, and clean
  key-and-size inventories. Keep exact keys and private identifiers out of
  repository artifacts; retain only aggregate evidence in the private change
  record.
- The application owns only the fixed-role deploy check and the temporary
  runtime cutover safety bridge.

No repository-executable migration verifier remains. Keeping one would turn a
completed one-time transition into a permanent production-database and object-
inventory integration. The managed rehearsal proved the operator procedure
against the real service. Production repeats it while normal runtime admission
stays open, using the authoritative read-only database path and independent R2
inventories described below. A dashboard progress total is never sufficient
proof.

Recovery is intentionally narrow. Before promotion, any unresolved job result,
key classification, ownership change, or manifest-inclusion mismatch
quarantines the destination and restarts with a fresh bucket. After ENAM accepts
production writes, recovery is forward-only and limited to identified missing
approved objects; broad copying and OC-only rollback are unsupported. There is
no application-owned abnormal-stop command.

The runtime bridge remains because old direct-upload capabilities, warm Durable
Objects, lifecycle-managed objects, and deletion retries can legitimately refer
to either fixed bucket after transfer finishes. Remove it only after the URL,
lifecycle, fallback-observation, cold-restore, and OC-retirement gates at the
end of this runbook all pass.

## Dashboard wizard or jobs API

The dashboard wizard is suitable only when the whole source inventory exactly
equals the approved migration manifest.

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

Deploy the two fixed bindings with `HOSTED_R2_CUTOVER_PHASE=source_active` and
`HOSTED_R2_WRITE_ADMISSION=open`. Require current bridge protocol status from
every relevant Durable Object and wait for pre-bridge Worker and Durable Object
invocations to drain. Ordinary reads, writes, lists, and new direct uploads must
still resolve to OC.

### 2. Stabilize ownership and warm-copy while admission stays open

Enable the account-deletion maintenance control at both admission and effect
boundaries so the approved ownership set cannot shrink during the managed copy.
This is the only planned product restriction. Keep
`HOSTED_R2_CUTOVER_PHASE=source_active` and
`HOSTED_R2_WRITE_ADMISSION=open`: messages, checkpoints, and direct uploads
continue against OC throughout the bulk transfer.

An earlier transfer that ran before account-deletion maintenance is copy
progress only, not an approved baseline checkpoint. After maintenance is
active, rebuild the approved manifest and inventory ENAM. If ENAM contains an
object outside that current approved manifest before promotion, quarantine the
destination and restart with a fresh destination; never delete or mutate OC to
reconcile it. Otherwise copy only currently approved missing keys.

Read current hosted ownership and canonical workspace snapshot state through
the authorized read-only production path. Admit immutable user-scoped bundle,
artifact, browser-vault replica, and unique workspace-snapshot keys owned by
current hosted members. Fail closed on mutable fixed keys, pre-v2 canonical
snapshots, unknown placement, lifecycle-managed placement, or ownership changes
during the read. Record aggregate counts and bytes only.

Use the dashboard wizard only when the whole source inventory exactly equals
the approved manifest. Otherwise create managed jobs with exact key batches and
destination overwrite disabled. Wait for every baseline job to reach a terminal
state. If a job stalls or reports a failure, reconcile that job's submitted keys
against the destination by exact key and size. Retry only missing or mismatched
keys in a new managed job. Do not infer failure solely from a stale progress
counter, and do not change the source to recover a destination problem.

Prove exact key-and-size inclusion for a fresh approved source manifest while
runtime writes remain open. This is a warm-copy checkpoint, not a frozen
promotion boundary: new immutable objects may continue to appear in OC and are
handled by the post-promotion tail copy.

### 3. Prove live-promotion readiness

Keep `HOSTED_R2_WRITE_ADMISSION=open` and
`HOSTED_R2_PAUSED_CANARY_USER_ID_SHA256` unset. From clean operator processes:

1. Rebuild the approved manifest and prove every included key is already in
   ENAM with the exact source byte size.
2. Prove every submitted managed job is terminal and reconcile the exact keys
   from any failed or stale job.
3. Inventory ENAM and prove it contains no object outside the current approved
   manifest while OC remains authoritative.
4. Run direct ENAM PUT, HEAD, GET, and delete smokes using a disposable key.
5. Require bridge-protocol status from every relevant runner and confirm
   account deletion remains maintenance-fenced. Account deletion is the only
   runtime path that lists user prefixes; all ordinary reads use explicit keys,
   and destination-active reads fall back to OC only after a definitive ENAM
   miss.

A new OC object after either manifest read does not invalidate readiness. It
will remain readable after promotion and becomes part of the bounded tail-copy
loop. Any unknown key, incorrect byte size, non-terminal managed job, failed
ENAM smoke, or bridge-status gap blocks promotion without pausing service.

### 4. Promote ENAM with runtime admission open

Deploy the same bridge to 100 percent with:

```text
HOSTED_R2_CUTOVER_PHASE=destination_active
HOSTED_R2_WRITE_ADMISSION=open
HOSTED_R2_PAUSED_CANARY_USER_ID_SHA256=<unset>
```

New current-version runtime writes and direct-upload tickets now target ENAM.
During Cloudflare's Worker and Durable Object convergence, an old source-active
runner or already-issued source-bucket upload ticket may still complete against
OC. That write remains readable through the destination-first bridge and must
not be treated as corruption. Do not terminate an invocation or revoke a valid
upload capability.

Poll every relevant UserRunner until it reports the current bridge protocol,
`phase=destination_active`, `writeAdmission=open`, and no paused canary. Confirm
newly admitted mailbox work continues to be consumed and checkpoints directly
to ENAM. Through one operator-controlled hosted member with a current snapshot,
prove an ordinary wake can cold-restore a copied pre-switch snapshot, write an
ENAM checkpoint, and cold-restore that checkpoint through a fresh
current-version runner. Also prove a known source-only object is readable only
through the definitive-miss fallback.

Promotion becomes irreversible when ENAM accepts its first production write.
From that point, repair forward; do not return to OC-only authority.

### 5. Drain source writers and converge with bounded tail copies

Record the last time any runner reports source-active and the last time a
source-bucket direct-upload ticket can have been issued. Require all relevant
runners to remain destination-active and let every already-issued OC capability
expire: the production PUT URL lifetime is ten minutes and its upload request
has a separate conservative ten-minute completion bound. The timer begins only
after the last possible OC ticket issuance. Existing invocations finish
normally while users continue to receive service.

After that writer drain, rebuild the approved OC manifest and inventory both
buckets from a clean process. Submit exact-key, overwrite-disabled jobs only for
approved OC keys absent from ENAM. An existing destination key must already
have the exact source byte size. Reconcile every submitted job to terminal state
and repeat the inventories. If the approved OC manifest changed, restart the
bounded observation and tail-copy loop; never broaden the job to excluded
prefixes.

Convergence requires all of the following twice from clean operator processes:

- the approved OC manifest is unchanged across the observation interval;
- every approved OC key exists in ENAM with the exact byte size;
- every ENAM-only key is classified as a legitimate current destination write
  or lifecycle-managed object, not an unapproved migration mutation;
- every current canonical workspace reference is readable through the bridge;
- every managed job is terminal; and
- aggregate evidence contains no unknown key or unresolved ownership change.

R2 provides strong consistency for object writes and listings, so fresh stable
inventories are authoritative after the application-level writer drain:
[R2 consistency](https://developers.cloudflare.com/r2/reference/consistency/).
Do not require equal bucket counts or bytes after promotion; live ENAM writes
make equality both impossible and incorrect.

### 6. Validate live operation and restore account deletion

While global admission remains open, prove ordinary members continue to consume
mailbox work and checkpoint to ENAM with no migration-correlated error or lag
increase. Repeat direct ENAM PUT, HEAD, GET, and delete smokes. Inspect source-
fallback observations: any remaining fallback must map to a known drained OC
object or trigger an exact-key forward repair.

Re-enable account deletion only after its race canary proves the bridge deletes
from both concrete buckets and retains state for retry after a partial failure.

Keep OC, the second binding, upload-session bucket affinity, dual deletion, and
ENAM-to-OC fallback through:

- expiry of every valid OC GET or PUT capability;
- empty OC lifecycle-managed prefixes;
- a bounded zero-fallback observation window covering retry and alarm cycles;
  and
- successful cold restores of both pre-switch and post-switch snapshots.

## Failure handling

Before promotion, keep `source_active+open`, quarantine or reconcile the
non-authoritative destination, and retry later without interrupting service.

After ENAM accepts a production write, retain `destination_active` and repair
identified missing objects forward. Keep admission open while reads, writes,
and fallback remain correct. If those correctness guarantees become unavailable,
`HOSTED_R2_WRITE_ADMISSION=paused` is the explicit incident-containment lever:
declare an active service incident, allow current invocations to drain, and use
the optional hashed canary only for a quiescent forward-repair validation. Never
silently turn the emergency pause into the normal migration procedure, and
never roll back to OC-only writes.

## Retire OC

OC retirement is a separate reviewed destructive operation. Before it, prove
that live configuration is ENAM-only, no valid OC credential or URL remains,
no source-only approved object exists, lifecycle-managed prefixes are empty,
account deletion is green against ENAM, and fallback stayed unused for the
approved soak.

Only after OC is retired should a follow-up change remove the second binding,
phase handling, read fallback, dual deletion, upload-session bucket affinity,
account-deletion maintenance control, emergency pause/canary support, and this
runbook.
