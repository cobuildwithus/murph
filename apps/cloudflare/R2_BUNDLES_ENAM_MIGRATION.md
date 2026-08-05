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
- `HOSTED_R2_WRITE_ADMISSION=open` admits normal runtime starts and wakes.
  `paused` makes the Worker return `retry_later` before any UserRunner Durable
  Object call, so the existing encrypted mailbox remains the only durable
  backlog while current invocations drain.
- `HOSTED_R2_PAUSED_CANARY_USER_ID_SHA256` is a temporary lowercase SHA-256
  digest of one operator-selected member ID. It never contains the raw member
  ID. It can admit only that member's callback-signed Temporal ensure while the
  phase is `destination_active` and write admission is `paused`; source-active
  pauses, every other member, and every Vercel OIDC hint remain fenced.

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

Deploy the two fixed bindings with `HOSTED_R2_CUTOVER_PHASE=source_active` and
`HOSTED_R2_WRITE_ADMISSION=open`.
Require current runner status from every relevant Durable Object and wait for
pre-bridge Worker and Durable Object invocations to drain. Ordinary reads,
writes, lists, and new direct uploads must still resolve to OC.

### 2. Stabilize ownership and prove the warm baseline while admission stays open

Enable the account-deletion maintenance control at both admission and effect
boundaries so the approved ownership set cannot shrink during the managed copy.
Keep `HOSTED_R2_CUTOVER_PHASE=source_active` and
`HOSTED_R2_WRITE_ADMISSION=open`: messages and ordinary runtime work continue
against OC throughout the bulk transfer.

An already-completed warm transfer that ran before account-deletion maintenance
is copy progress only, not an approved baseline checkpoint. After maintenance is
active, rebuild the approved manifest and inventory ENAM. If ENAM contains an
object outside that current manifest, quarantine the destination and restart
with a fresh destination; never delete or mutate OC to reconcile it. Otherwise
copy only currently approved missing keys and continue with baseline parity.

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

Prove exact key-and-size parity for the baseline manifest while runtime writes
remain open. This is a warm-copy checkpoint, not promotion proof: new immutable
objects may continue to appear in OC and are handled by the final delta.

### 3. Pause and drain runtime writes

Keep `HOSTED_R2_PAUSED_CANARY_USER_ID_SHA256` unset. Set
`HOSTED_R2_WRITE_ADMISSION=paused`, deploy the Worker version to 100 percent,
and require every status response to report `writeAdmission=paused` and
`pausedCanaryConfigured=false`. Start a 30-minute pre-promotion deadline when
the paused version reaches 100 percent. Deploy preflight rejects a canary digest
while the source remains active.
The Worker-level check must return `retry_later` for both signed Temporal calls
and Vercel OIDC direct latency hints without calling UserRunner while the phase
remains `source_active`. Inbound messages
remain accepted in the web-owned encrypted mailbox. An invocation already in
flight may finish work it accepted before the pause; after every runner reports
`inFlight=false`, Murph replies and other new runtime effects wait until
admission reopens.

Query every relevant UserRunner until `inFlight=false`. Do not terminate an
invocation: let it finish its ordinary checkpoint. Record the last completion
time only after the paused Worker version is at 100 percent. Cloudflare Worker
versions include their bindings and configuration, but Worker and Durable
Object code updates are eventually consistent, so the route-level pause and
explicit per-runner drain are both required:
[versions and deployments](https://developers.cloudflare.com/workers/versions-and-deployments/),
[Durable Object lifecycle](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/).

The production direct-PUT URL lifetime is ten minutes and the upload request
has a separate conservative ten-minute completion bound. Wait both intervals
after the last runner becomes idle, then prove there is no in-flight write,
ticket issuance, or completion. This drain and every remaining pre-promotion
step must fit inside the same 30-minute deadline.

### 4. Copy and prove the final delta

Build a fresh approved manifest from a clean process after the write drain.
Inventory both buckets and submit only approved keys that are absent from ENAM;
an existing destination key must already have the exact source byte size. Wait
for every delta job to reach a terminal state and reconcile its exact submitted
keys.

After all jobs finish, inventory both buckets again under the same write fence.
Require:

- the source inventory and approved manifest are unchanged;
- every approved key exists in ENAM with the exact byte size;
- ENAM contains no unapproved migration object; and
- aggregate object and byte counts match.

Repeat the comparison from another clean operator process. Before revoking the
migration credential, run direct destination PUT, HEAD, GET, and delete smokes.

The 30-minute deadline is fail-safe, not an estimate to extend. If every
pre-promotion requirement cannot pass before it expires, or any requirement
fails, keep `HOSTED_R2_CUTOVER_PHASE=source_active`, deploy
`HOSTED_R2_WRITE_ADMISSION=open` with the canary digest still unset, require the
source-active/open version at 100 percent, and prove a queued mailbox item is
consumed. Do not promote. Reconcile
or quarantine the non-authoritative destination and retry the final delta in a
later bounded window. Keep account deletion in maintenance only until any
outstanding managed jobs are terminal and the destination disposition is known,
then re-enable it.

### 5. Promote ENAM

Deploy the same bridge with:

```text
HOSTED_R2_CUTOVER_PHASE=destination_active
HOSTED_R2_WRITE_ADMISSION=paused
```

Require the destination-active Worker version at 100 percent and query every
relevant Durable Object until it reports the current bridge protocol and
destination-active phase. Every response must still report
`pausedCanaryConfigured=false` and `writeAdmission=paused`. An already scheduled
retry for any member must still receive `retry_later` with zero UserRunner calls
during this convergence deploy.

Only after every relevant Durable Object has converged, select a dedicated,
operator-controlled hosted member with a current snapshot. Through the existing
mailbox, runner-status, and Temporal inspection paths, prove that member has no
in-flight work, mailbox lag, pending retry/recheck/wake, scheduled alarm, or
member-facing ingress during the canary window. Derive the lowercase SHA-256
digest of its member ID in the private operator process; never place the raw ID
in deploy configuration, logs, or artifacts. Deploy the digest as
`HOSTED_R2_PAUSED_CANARY_USER_ID_SHA256` while remaining
`destination_active+paused`, wait for the route configuration to reach 100
percent, and repeat the quiescence proof before issuing the explicit
runtime-maintenance wake.

The digest is a temporary per-member callback window, not a one-shot request:
every callback-signed Temporal ensure or recheck for the matching member can
pass while it is configured. Quiescence and closed member-facing ingress make
the explicit maintenance wake the only callback in that window. A wrong or
absent digest, every other member, and every direct OIDC hint must still receive
`retry_later` without a UserRunner call. While global write admission remains
closed, prove:

1. a copied pre-switch snapshot cold-restores;
2. a canary writes directly to ENAM;
3. the ENAM checkpoint cold-restores through a fresh current-version runner;
4. ENAM PUT, HEAD, GET, and delete smokes pass; and
5. source fallback occurs only after a definitive ENAM miss.

If any approved OC object is absent from ENAM, keep writes closed and repair
forward. Do not restart copying broadly or return to OC-only authority after
ENAM accepts production writes.

### 6. Resume service

Unset `HOSTED_R2_PAUSED_CANARY_USER_ID_SHA256` and deploy
`HOSTED_R2_WRITE_ADMISSION=open` only after promotion checks pass. Require the
destination-active Worker version at 100 percent, every status response to
report `pausedCanaryConfigured=false`, and confirm newly admitted work consumes
durable mailbox input and checkpoints to ENAM. Deploy preflight rejects the
temporary canary digest on an open-admission version. The paused `retry_later`
response gives Temporal the continuation owner; the direct web hint remains
optional and performs no retry.

Re-enable account
deletion only after its race canary proves the bridge deletes from both
concrete buckets and retains state for retry after a partial failure.

Promotion is the irreversible boundary. A failure after ENAM becomes
authoritative keeps admission paused and repairs forward; it must be declared as
an active service incident rather than silently extending the pre-promotion
deadline or returning to OC-only writes.

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
