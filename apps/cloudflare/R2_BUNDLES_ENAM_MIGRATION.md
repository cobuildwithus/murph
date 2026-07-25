# Hosted R2 bundles: OC to ENAM migration

This temporary operator runbook moves the hosted `BUNDLES` data from Oceania
(`OC`) to Eastern North America (`ENAM`). Delete it and the migration command
after the old buckets are retired.

The application already reads one bucket binding and one matching presign
bucket. The move therefore needs no dual-read runtime, fallback, or data-model
change: create dedicated ENAM buckets, copy and prove them, then switch the
existing configuration in one immediate deploy.

The entire copy happens inside a single write fence. There is no live
pre-seed, so no ordinary bundle cleanup can delete a source object after that
object has already been copied, and the destination can never drift from the
source while the operation is in flight. The window is therefore longer than a
delta cutover and correspondingly simpler: the source is authoritative and
unchanged throughout, and aborting costs only the window.

## Safety contract

- Run the migration only inside the fence. The command requires
  `--source-frozen` in both its read-only and `--apply` forms; there is no
  phase that is safe to run against a live source.
- The OC source remains authoritative until the binding switch and remains the
  rollback source until the first durable ENAM checkpoint. The tool never
  deletes from either bucket.
- The destination must be a subset of the frozen source when a run starts and
  exactly equal to it when the run ends. An object present in the destination
  but absent from the source is an invariant failure: it means the source moved
  while the fence was supposed to hold it still.
- Aborting is free before the first ENAM checkpoint. Nothing at the source has
  changed and no configuration has moved. Recovery is to empty and delete the
  ENAM destination — which only ever held copies of the source — create a fresh
  one, and run again inside the same or a later fence. Never delete or recreate
  an OC source.
- Keep the production ENAM destination unbound and writer-exclusive until
  cutover. Use a temporary Object Read & Write key scoped only to the exact
  bucket pair.
- The run lists the source, then issues bounded, explicit `CopyObject`
  requests. Each request uses R2's required leading-slash source, the listed
  source ETag as a precondition, metadata `COPY`, and Standard storage. There
  is no `sync` heuristic or multipart path.
- Objects at the single-copy limit, non-Standard objects, and multipart or
  non-MD5 ETags fail closed.
- The first run against an empty destination reads back its lifecycle rules,
  conditionally creates one zero-byte marker bound to the exact pair, and
  proves that marker is the only object before copying. Every later run against
  that destination requires that exact marker.
- Every run ends with the same read-only proof: two stable inventory reads, the
  exact marker, and exact key, size, ETag, and storage-class parity with zero
  destination-only objects. Running the command without `--apply` performs only
  that proof, which is how the post-deploy gates in section 7 work.
- `--source-frozen` is an operator assertion, not a lock. Keep the external
  fence active through the copy, variable readback, both deploys, the
  post-deploy proofs, direct smokes, and both controlled restore wakes.

### Account deletion stays available

Account deletion is not blocked at any point in this operation. The runtime
deletion path targets the active bucket, and the single-window shape keeps that
correct at every moment:

- Before the fence, no ENAM copy exists, so deletion removes the member's
  objects from the only copy that exists.
- Inside the fence, a deletion that reaches R2 mutates the frozen source. The
  copy or the closing proof fails closed, because the removed object is still
  present in the destination. The operator recovers by abandoning the
  destination and re-running; no member data is carried forward.
- Between the closing proof and the binding switch, the post-deploy proof in
  section 7 re-runs before any writer is reopened and detects the same
  condition. The response there is the rollback in section 6, which is still
  free at that point.
- After cutover, deletion targets ENAM. OC is a retirement copy that section 8
  destroys whole, so nothing a member deleted can come back.

References: [R2 data location][data-location], [R2 consistency][consistency],
[R2 authentication][r2-auth], [R2 S3 compatibility][s3-api], and [R2's current
leading-slash `CopyObject` example][copy-object]. The cutover ordering also
accounts for [Worker version deployment semantics][worker-versions], [Durable
Object code-update skew][do-updates], and [Durable Object alarms][do-alarms].

[data-location]: https://developers.cloudflare.com/r2/reference/data-location/
[consistency]: https://developers.cloudflare.com/r2/reference/consistency/
[r2-auth]: https://developers.cloudflare.com/r2/api/tokens/
[s3-api]: https://developers.cloudflare.com/r2/api/s3/api/
[copy-object]: https://developers.cloudflare.com/r2/buckets/storage-classes/
[worker-versions]: https://developers.cloudflare.com/workers/versions-and-deployments/
[do-updates]: https://developers.cloudflare.com/durable-objects/platform/known-issues/#code-updates
[do-alarms]: https://developers.cloudflare.com/durable-objects/api/alarms/

## 1. Size the window before booking it

The fence must cover the whole copy, so book from measured volume and a
measured rate rather than an assumption.

```bash
SOURCE_BUCKET="$(gh variable get CF_BUNDLES_BUCKET --env production)"
pnpm --dir apps/cloudflare exec wrangler r2 bucket info "$SOURCE_BUCKET" --json
```

Record the reported object count and payload size. Take the copy rate from the
timed preview rehearsal in section 2, which uses the same account, the same
command, and the same OC-to-ENAM path. Book the fence with margin over the
extrapolated copy time plus the fixed cost of section 4's ten-minute drain, the
cutover deploy, the post-deploy proofs, and both restore canaries.

An overrun is not a data risk. If the copy or any proof does not finish inside
the booked window, take the abandonment path in the safety contract, reopen
writers, and rebook. Nothing at the source has changed.

## 2. Rehearse the exact copy path on real R2

Move the existing OC preview bucket first; this is both the real R2 rehearsal
and the preview-bucket migration. Create a distinct ENAM preview destination.
Bucket location cannot be changed after creation.

```bash
PREVIEW_SOURCE_BUCKET="$(gh variable get CF_BUNDLES_PREVIEW_BUCKET --env production)"
PREVIEW_DESTINATION_BUCKET='<new-preview-enam-bucket>'
pnpm --dir apps/cloudflare exec wrangler r2 bucket create "$PREVIEW_DESTINATION_BUCKET" --location enam
pnpm --dir apps/cloudflare exec wrangler r2 bucket info "$PREVIEW_SOURCE_BUCKET" --json
pnpm --dir apps/cloudflare exec wrangler r2 bucket info "$PREVIEW_DESTINATION_BUCKET" --json
```

If the preview source is empty, first use the existing OC staging Worker to
write a representative v2 checkpoint; the migration intentionally refuses an
empty source because it cannot prove a real restore path.

Issue a temporary R2 key limited to that pair. Load it without echoing the
secret or placing it in an argument:

```bash
read -r CLOUDFLARE_ACCOUNT_ID
read -r R2_MIGRATION_ACCESS_KEY_ID
read -r -s R2_MIGRATION_SECRET_ACCESS_KEY
export CLOUDFLARE_ACCOUNT_ID R2_MIGRATION_ACCESS_KEY_ID R2_MIGRATION_SECRET_ACCESS_KEY
```

Stop staging writers, wait ten minutes after the last possible presigned PUT,
then run the copy and record its wall time. Rerun the read-only form to prove
the mirror a second time:

```bash
time pnpm --dir apps/cloudflare r2:bundles:migrate -- \
  --source "$PREVIEW_SOURCE_BUCKET" --destination "$PREVIEW_DESTINATION_BUCKET" \
  --source-frozen --confirm-destination "$PREVIEW_DESTINATION_BUCKET" --apply

pnpm --dir apps/cloudflare r2:bundles:migrate -- \
  --source "$PREVIEW_SOURCE_BUCKET" --destination "$PREVIEW_DESTINATION_BUCKET" \
  --source-frozen
```

The `Copy plan` line reports the object and byte counts actually copied. Divide
the recorded wall time by those counts to get the per-object and per-byte rates
that section 1 extrapolates from.

Deploy a distinct staging Worker through the manual preview path in
`apps/cloudflare/DEPLOY.md`. Set its binding, presign bucket, and preview bucket
to `PREVIEW_DESTINATION_BUCKET`, then run both commands:

```bash
pnpm --dir apps/cloudflare deploy:worker
pnpm --dir apps/cloudflare deploy:smoke
```

Before production, require all three proofs:

1. HEAD the same representative v2 snapshot in both buckets and compare
   length, ETag, custom metadata, supported HTTP metadata, stored SHA-256, and
   checksum type.
2. Cold-restore that copied snapshot through the staging Worker.
3. Write and cold-restore a fresh staging checkpoint from ENAM.

Enter the private object key without terminal echo. This emits no key or
metadata; do not use shell tracing:

```bash
(
  set -euo pipefail
  read -r -s SNAPSHOT_KEY
  R2_ENDPOINT="https://${CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com"
  head_snapshot() {
    AWS_ACCESS_KEY_ID="$R2_MIGRATION_ACCESS_KEY_ID" \
    AWS_SECRET_ACCESS_KEY="$R2_MIGRATION_SECRET_ACCESS_KEY" \
      aws s3api head-object --bucket "$1" --key "$SNAPSHOT_KEY" \
        --checksum-mode ENABLED --endpoint-url "$R2_ENDPOINT" --region auto \
        --output json --no-cli-pager | \
      jq -Sc '{CacheControl,ChecksumCRC32,ChecksumCRC32C,ChecksumSHA1,ChecksumSHA256,ChecksumType,ContentDisposition,ContentEncoding,ContentLanguage,ContentLength,ContentType,ETag,Expires,Metadata}'
  }
  SOURCE_HEAD="$(head_snapshot "$PREVIEW_SOURCE_BUCKET")"
  DESTINATION_HEAD="$(head_snapshot "$PREVIEW_DESTINATION_BUCKET")"
  test -n "$SOURCE_HEAD"
  test -n "$DESTINATION_HEAD"
  test "$SOURCE_HEAD" = "$DESTINATION_HEAD"
)
```

After all three preview proofs pass, revoke the preview-pair migration key. The
new ENAM preview bucket is now owned by the staging Worker, not an unowned copy.

## 3. Pre-stage rollback-safe runtime credentials

Create a distinct runtime credential scoped exactly to OC and ENAM. Before
putting it in GitHub, use a unique, self-cleaning probe key to prove that exact
credential can PUT, HEAD, and delete in both buckets. Do not print the key,
credential, or response metadata.

Update these two production GitHub secrets without revoking the old key:

- `HOSTED_R2_PRESIGN_ACCESS_KEY_ID`
- `HOSTED_R2_PRESIGN_SECRET_ACCESS_KEY`

Use `gh secret list --env production --json name,updatedAt` to record that both
names changed in the intended maintenance preparation. Secret values must not
be read back or copied into a file.

While all bucket variables still point to OC, dispatch a separate immediate
deployment and require the canonical direct-R2 smoke. This proves the exact
new secret pair, signer, OC binding, and variables-back rollback path before
the maintenance window. Keep the old key valid for outstanding URLs.

## 4. Establish the production write fence

One cutover owner must prove every item below. Abort if any item is uncertain.

1. Freeze hosted GitHub environment edits and deploy dispatches; prove no
   hosted deploy is queued or running.
2. Pause message and browser-vault admission, Cloudflare Email Routing,
   meal-photo intake, automations, Temporal and cron wakes, and operator jobs
   that can write BUNDLES.
3. Confirm every runner has no invocation in flight and the mailbox is drained.
4. Record the last possible presigned PUT time and wait ten full minutes.
5. Account for `HostedUserRunner` cleanup alarms. They can still delete only an
   aged orphan after re-reading Web's current snapshot; they do not create
   objects or delete the current referenced snapshot. Do not claim a global
   alarm pause. A cleanup that fires during the window removes an object the
   copy already carried, which the closing proof reports as a destination-only
   object; that is an abandon-and-retry condition, not a partial success.

Keep the fence through section 7.

## 5. Copy the frozen source and prove the mirror

Define the authoritative production pair, create its dedicated ENAM bucket,
and issue a separate pair-scoped migration key as in section 2:

```bash
test "$(gh variable get HOSTED_R2_PRESIGN_BUCKET_NAME --env production)" = "$SOURCE_BUCKET"
DESTINATION_BUCKET='<new-production-enam-bucket>'
pnpm --dir apps/cloudflare exec wrangler r2 bucket create "$DESTINATION_BUCKET" --location enam
pnpm --dir apps/cloudflare exec wrangler r2 bucket info "$SOURCE_BUCKET" --json
pnpm --dir apps/cloudflare exec wrangler r2 bucket info "$DESTINATION_BUCKET" --json
```

Run the copy, then the read-only proof immediately before editing variables:

```bash
pnpm --dir apps/cloudflare r2:bundles:migrate -- \
  --source "$SOURCE_BUCKET" --destination "$DESTINATION_BUCKET" \
  --source-frozen --confirm-destination "$DESTINATION_BUCKET" --apply

pnpm --dir apps/cloudflare r2:bundles:migrate -- \
  --source "$SOURCE_BUCKET" --destination "$DESTINATION_BUCKET" --source-frozen
```

The copy run may be interrupted and rerun; a partially copied destination is
still a subset of the frozen source, so the rerun resumes rather than restarts.
A destination-only object is different: it means the source moved under the
fence. Do not delete around the gate. Abandon that destination per the safety
contract, reopen writers, and rebook.

Objects staged under the lifecycle-managed `hosted-email/messages/` and
`hosted-meal-photos/images/` prefixes are copied like any other object rather
than dropped, so a pending import survives the move. Both destinations carry
the identical checked-in lifecycle rules, so the deletion backstop still
applies; a staged object that was already partway through its backstop restarts
that clock in ENAM. Carrying a pending import forward is the intended trade
against losing it when OC is retired.

## 6. Switch and read back all configuration

Capture the three current production values and prove the active source before
changing anything:

```bash
OLD_CF_BUNDLES_BUCKET="$(gh variable get CF_BUNDLES_BUCKET --env production)"
OLD_CF_BUNDLES_PREVIEW_BUCKET="$(gh variable get CF_BUNDLES_PREVIEW_BUCKET --env production)"
OLD_HOSTED_R2_PRESIGN_BUCKET_NAME="$(gh variable get HOSTED_R2_PRESIGN_BUCKET_NAME --env production)"
test "$OLD_CF_BUNDLES_BUCKET" = "$SOURCE_BUCKET"
test "$OLD_CF_BUNDLES_PREVIEW_BUCKET" = "$PREVIEW_SOURCE_BUCKET"
test "$OLD_HOSTED_R2_PRESIGN_BUCKET_NAME" = "$SOURCE_BUCKET"
```

Set `CF_BUNDLES_BUCKET` and `HOSTED_R2_PRESIGN_BUCKET_NAME` to the exact ENAM
production destination. Set `CF_BUNDLES_PREVIEW_BUCKET` to the rehearsed ENAM
preview destination. Do not dispatch between edits. Read back and compare all
three values before the single immediate deploy:

```bash
gh variable set CF_BUNDLES_BUCKET --env production --body "$DESTINATION_BUCKET"
gh variable set CF_BUNDLES_PREVIEW_BUCKET --env production --body "$PREVIEW_DESTINATION_BUCKET"
gh variable set HOSTED_R2_PRESIGN_BUCKET_NAME --env production --body "$DESTINATION_BUCKET"
test "$(gh variable get CF_BUNDLES_BUCKET --env production)" = "$DESTINATION_BUCKET"
test "$(gh variable get CF_BUNDLES_PREVIEW_BUCKET --env production)" = "$PREVIEW_DESTINATION_BUCKET"
test "$(gh variable get HOSTED_R2_PRESIGN_BUCKET_NAME --env production)" = "$DESTINATION_BUCKET"
pnpm cf:deploy:immediate
```

Do not use a gradual rollout. Wait for the exact workflow run to finish; it must
report one Worker version at 100% and complete its version-pinned,
self-cleaning direct-R2 smoke. The transition credential was already proven on
both buckets, so rollback before the first durable ENAM write is the three old
values plus one immediate deploy. Record the workflow run, deployed head SHA,
Worker version, container fingerprint, and smoke result in the private change
record.

## 7. Prove production before reopening writers

While the fence remains active, require the exact Worker version and container
fingerprint plus the immediate rollout's self-cleaning direct-R2 PUT, binding
HEAD, size check, and delete against ENAM. Then run the read-only proof twice,
still before any user canary:

```bash
for _ in 1 2; do
  pnpm --dir apps/cloudflare r2:bundles:migrate -- \
    --source "$SOURCE_BUCKET" --destination "$DESTINATION_BUCKET" --source-frozen
done
```

If either proof fails, do not wake the canary. Restore all three captured OC
values, deploy immediately, and require the exact rollback workflow and OC
direct-R2 smoke before reopening writers. Cloudflare can briefly run old
Durable Object code during an update; these proofs are the gate that catches an
OC or ENAM orphan cleanup, or a member account deletion, in the binding-switch
window. Cleanup re-reads the current snapshot before deleting, so it cannot
remove the referenced checkpoint.

Next use the existing ops runtime-maintenance wake for exactly one controlled
operator-owned member while all other ingress stays fenced:

1. record its current workspace version and checkpoint time, then wake it and
   prove an existing copied v2 snapshot restored;
2. let it write the first durable ENAM checkpoint, require both recorded values
   to advance, prove the new object readable in ENAM, and prove no work remains
   in flight;
3. redeploy the same protected `main` SHA and unchanged ENAM configuration with
   `pnpm cf:deploy:immediate`;
4. require a new Worker version at 100%, distinct from the first cutover
   version, with the same expected head and container fingerprint; and
5. wake exactly the same member again. Runner names include the Worker version,
   so require the new versioned instance name, `container.ready` with
   `startMode: "cold"`, successful restore of the fresh checkpoint, another
   strict workspace version/checkpoint-time advance, and no in-flight work.

Keep the canary identifier and exact instance name in the private change record
only. If the second wake uses the first version's instance or lacks cold-start
evidence, stop and keep writers fenced; do not use broad container deletion.

The first canary checkpoint is the commit point. Before it, restore the old
variables and deploy immediately on any failure. After it, the operation is
forward-only; OC is a bounded retirement safety copy, not an automatic
rollback target. Reopen ordinary writers only after the same-head redeploy and
fresh cold restore pass.

## 8. Retire OC and remove temporary controls

Keep the OC buckets, lifecycle rules, old signing key, and transition runtime
credential until old one-hour GET URLs expire and the canary is signed off:
at least one hour after cutover, and within 24 hours. Extend the named owner
and deadline if a retirement check fails; keep the safety copy in place rather
than removing a control on a deadline.

Use a separate, explicitly reviewed destructive operation to delete the exact
pair markers from the two ENAM destinations, prove each reserved marker prefix
empty, and retire only the matching production and preview OC buckets. Then:

1. mint an ENAM-only runtime credential;
2. update the two runtime secrets, record their names and `updatedAt` values,
   deploy immediately, and require the ENAM direct-R2 smoke;
3. revoke the transition, old runtime, and production pair-scoped migration
   credentials; and
4. delete this runbook, migration script, tests, and package command in one
   cleanup PR.

Retirement does not require OC/ENAM parity after the commit point: new ENAM
checkpoints and orphan cleanup legitimately diverge them. It does require all
three bucket variables to still read back as ENAM, the intended Worker version
to be the sole 100% deployment, and the fresh ENAM checkpoint/cold restore proof
to remain accepted before any OC credential or bucket is removed.

Finally remove operator-shell credentials without printing them:

```bash
unset R2_MIGRATION_ACCESS_KEY_ID R2_MIGRATION_SECRET_ACCESS_KEY CLOUDFLARE_ACCOUNT_ID
```
