# Hosted R2 bundles: OC to ENAM migration

This temporary operator runbook moves the hosted `BUNDLES` data from Oceania
(`OC`) to Eastern North America (`ENAM`). Delete it and the migration command
after the old buckets are retired.

The application already reads one bucket binding and one matching presign
bucket. The move therefore needs no dual-read runtime, fallback, or data-model
change: create dedicated ENAM buckets, copy and prove them, then switch the
existing configuration in one immediate deploy.

The entire copy happens inside a single maintenance window. There is no live
pre-seed, so the copy is not racing a running product. The source is still not
assumed to be immutable: ordinary snapshot cleanup can delete an object at any
time, including a platform retry of an attempt that failed before the window,
and no operator control can prevent that. The migration therefore converges on
the source as it actually is — it copies what is there and removes destination
objects the source no longer has — instead of aborting the window whenever the
source moves.

## Safety contract

- Run the migration only inside the fence. The command requires
  `--source-frozen` in both its read-only and `--apply` forms; there is no
  phase that is safe to run against a live source.
- The OC source remains authoritative until the binding switch and remains the
  rollback source until the first durable ENAM checkpoint. The tool never
  deletes from either bucket.
- The destination must equal the source exactly when a run ends. A destination
  object the source no longer has is expected drift, not corruption, and is
  removed by an explicit `--prune <count>` whose count must match what the
  read-only gate reported. Without `--prune` the run still fails closed.
- The prune is the only delete this tool can issue. It can name only the
  destination bucket, only runs under `--apply`, requires the pair marker,
  requires an exact operator-supplied count, and re-reads the source to confirm
  each key is still absent before removing it. It can never name the source.
- Aborting is free before the first ENAM checkpoint. Nothing at the source has
  changed and no configuration has moved. Recovery is the abandonment procedure
  below, then a fresh destination and another run. Never delete or recreate an
  OC source.
- Keep the production ENAM destination unbound and writer-exclusive until
  cutover. Use a temporary Object Read & Write key scoped only to the exact
  bucket pair.
- The run lists the source, then issues bounded, explicit `CopyObject`
  requests. Each request uses R2's required leading-slash source, the listed
  source ETag as a precondition, metadata `COPY`, and Standard storage. There
  is no `sync` heuristic or multipart path.
- Objects at the single-copy limit, non-Standard objects, and multipart or
  non-MD5 ETags fail closed, as does any object still staged under a
  lifecycle-managed prefix.
- The first run against an empty destination reads back its lifecycle rules,
  conditionally creates one zero-byte marker bound to the exact pair, and
  proves that marker is the only object before copying. Every later run against
  that destination requires that exact marker.
- Every run ends with the same read-only proof: two stable inventory reads, the
  exact marker, and exact key, size, ETag, and storage-class parity with zero
  destination-only objects. The proof reports both divergence directions
  together, so a mixed result never presents as a pure one. Running the command
  without `--apply` performs only that proof, which is how the post-deploy gates
  in section 7 work.
- `--source-frozen` is an operator assertion that ordinary writers are paused,
  not a claim that nothing can delete. Keep the external fence active through
  the copy, variable readback, both deploys, the post-deploy proofs, direct
  smokes, and both controlled restore wakes.

### Abandoning a destination

This is the recovery path for every pre-commit failure, so it must be a real
procedure rather than an intention. It applies only to an ENAM destination that
is still unbound and writer-exclusive, and therefore contains nothing but
copies of the source and the pair marker. Confirm both facts before starting:
the bucket name must not appear in any of the three production variables, and
the migration key must still be the pair-scoped one.

**Mint a destination-only credential first. Do not use the pair-scoped
migration key for this.** A recursive delete is the one command in this runbook
that can destroy the authoritative dataset, and the pair-scoped key is
authorized for the source as well, so a stale, unset, or transposed bucket
variable would be enough to erase OC. Shell-variable discipline is not an
adequate guard for that outcome; the credential must make it impossible.

Issue a temporary Object Read & Write key scoped to `$DESTINATION_BUCKET`
alone, export it in place of the pair-scoped key, and prove it cannot reach the
source before deleting anything:

```bash
# Must fail with AccessDenied. If it succeeds, the credential is wrong: stop.
aws s3api list-objects-v2 --bucket "$SOURCE_BUCKET" --max-items 1 \
  --endpoint-url "https://${CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com" \
  --region auto
```

Only once that read is denied, empty the destination and delete the bucket:

```bash
test "$DESTINATION_BUCKET" != "$SOURCE_BUCKET"
aws s3 rm "s3://$DESTINATION_BUCKET" --recursive \
  --endpoint-url "https://${CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com" \
  --region auto
pnpm --dir apps/cloudflare exec wrangler r2 bucket delete "$DESTINATION_BUCKET"
```

Prove the bucket is gone afterwards, then revoke the destination-only key. Read
the source inventory once more with the ordinary migration key and confirm its
object count is unchanged from the count recorded in section 1.

Then release the deletion window before reopening anything. Once the
destination is gone, OC is the sole authoritative bucket again and deletion is
safe, so leaving the control set would disable a privacy-critical flow for no
reason:

1. remove `HOSTED_ACCOUNT_DELETION_MAINTENANCE` from the Vercel production
   environment and deploy;
2. prove an authenticated `account.delete` challenge request succeeds again and
   that the delete route no longer returns `503`; and
3. only then reopen ordinary writers and rebook.

If the operation aborted before section 5 set the control, there is nothing to
clear here; confirm it is unset rather than assuming it.

### Account deletion is deferred for the window

From the moment the copy starts until OC is retired, two buckets hold the
member's objects and either one can still become the active bucket. The runtime
deletion path only ever targets the currently active bucket, so a deletion
accepted inside that period could not be completed everywhere: restoring OC
after a deletion served by ENAM would republish that member's data, and there
is no durable record of a deleted member to repair it from afterwards.

Rather than accept a deletion we cannot honour completely, the operation
declines it for the length of the window and tells the member exactly when to
come back. This is a deliberate product decision, not a technical fallback:
statutory response windows are measured in days, this deferral is measured in
hours, and the alternative is a privacy failure that cannot be detected or
repaired after the fact.

`HOSTED_ACCOUNT_DELETION_MAINTENANCE=1` lives in the Vercel production
environment for the `murph` web project. It is not read from a file and a bare
shell assignment does nothing: setting or clearing it requires a production
environment change followed by a deployment that picks it up.

**One rule owns the window.** The control is set only while an ENAM bucket
holds copies that could still become live, and cleared the moment OC is the
sole authority again. The cutover owner owns both edges. Deriving every exit
from that one rule is what keeps the control from outliving the operation:

| Point in the operation | Control |
| --- | --- |
| Anything before the copy, including every section 4 abort | Never set. Section 5 sets it immediately before the first object is copied, after the destination bucket exists and every other fence check has passed. |
| Copy, cutover, proofs, canary | Set. |
| Any pre-commit abandonment or overrun | Cleared by the abandonment procedure, before writers reopen. |
| Successful retirement | Cleared in section 8. |

Because activation is the last step before copying, an abort during the fence
happens while the control is still unset and needs no unwinding at all. There
is no ordinary exit that leaves it set.

The message makes no timing promise, not even a relative one. This window runs
from before the copy until OC retirement, which section 8 permits as late as 24
hours after cutover and extends when a retirement check fails, so any duration
the copy named could expire while the window was still open. It tells members
to try again after maintenance instead; the table above is what bounds the
window.

Set it as directed in section 5:

```bash
vercel env add HOSTED_ACCOUNT_DELETION_MAINTENANCE production   # 1
```

Redeploy production, then prove all three checks before copying:
`POST /api/settings/sensitive-action-challenge` with `account.delete` and
`POST /api/settings/privacy/delete` must each return `503` with
`account_deletion_maintenance`, and `vault.export` must still return `200`.

The challenge route is the one members hit first, so declining there means a
member who tries during the window is told before any passkey approval and
before any browser-vault teardown, with the dialog still open and an unspent
authorization. The delete route keeps the same guard as the effect boundary, so
a direct request cannot bypass the window.

The whole control — module, one variable, and both call sites — is deleted with
the runbook.

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
extrapolated copy time plus the fixed cost of section 4's ten-minute PUT drain,
the cutover deploy, the post-deploy proofs, and both restore canaries. Add
margin for one prune-and-reprove cycle.

Account deletion stays declined from the start of the copy until section 8
clears the control after OC retirement, which cannot happen until at least an
hour after cutover and may be later. Size the operation knowing that. The
member-facing copy makes no timing promise, so a longer run leaves nothing to
correct or re-announce.

An overrun is not a data risk. If the copy or any proof does not finish inside
the booked window, take the abandonment path in the safety contract, which
clears the deletion window before writers reopen, and rebook. Nothing at the
source has changed.

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
5. Do not set the deletion-window control yet. Section 5 sets it immediately
   before the copy, once the destination exists, so that an abort anywhere in
   this section leaves nothing to unwind.
6. Do not claim that `HostedUserRunner` cleanup alarms are stopped. They fire on
   schedule with no invocation, and the platform retries an attempt that failed
   earlier, so one can delete a source object at any point in the window. That
   is handled by `--prune` in section 5 rather than prevented. Every other
   deleter — bundle-transition GC and replaced legacy snapshot cleanup — runs
   only on a write path and is already fenced by items 1 and 2.

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

Now open the deletion window, as the last step before any object is copied:
set `HOSTED_ACCOUNT_DELETION_MAINTENANCE=1` in the Vercel production
environment, deploy, and prove the three checks from the deferral section.

**Then drain the deletions the guard could not stop.** Both guards run once, at
request entry. A deletion accepted by the previous deployment keeps running
through its whole workflow -- vendor revocation, database deletion, and
Cloudflare object deletion -- and nothing re-checks the flag partway through. If
one is still in flight when copying starts, it can remove a member's objects
from only one side of the pair, which is the exact outcome this window exists to
prevent, and it would also make the section 7 rollback unsafe.

Prove the drain before copying:

1. Record the time the maintenance deployment reached 100 percent.
2. Query production logs for `POST /api/settings/privacy/delete` requests that
   started before that time, and confirm each one has logged its completion.
3. Wait ten minutes past the last such completion with no new admitted request.
   Ten minutes is the same bound section 4 uses for issued PUT URLs and is far
   above the observed runtime of a single deletion; if any request has not
   completed by then, do not start the copy. Treat it as an incident and
   establish what state that member's data is in first.

Only after both the three checks and this drain pass does anything get copied.

Run the copy, then the read-only proof immediately before editing variables:

```bash
pnpm --dir apps/cloudflare r2:bundles:migrate -- \
  --source "$SOURCE_BUCKET" --destination "$DESTINATION_BUCKET" \
  --source-frozen --confirm-destination "$DESTINATION_BUCKET" --apply

pnpm --dir apps/cloudflare r2:bundles:migrate -- \
  --source "$SOURCE_BUCKET" --destination "$DESTINATION_BUCKET" --source-frozen
```

The copy run may be interrupted and rerun; a partially copied destination is
still a subset of the source, so the rerun resumes rather than restarts.

If either run reports `N unexpected destination object(s) the source no longer
has`, ordinary cleanup removed something after it was copied. That is expected
and converges — it does not cost the window. Re-run the copy with the exact
count the gate reported, then re-prove:

```bash
pnpm --dir apps/cloudflare r2:bundles:migrate -- \
  --source "$SOURCE_BUCKET" --destination "$DESTINATION_BUCKET" \
  --source-frozen --confirm-destination "$DESTINATION_BUCKET" --apply --prune <count>

pnpm --dir apps/cloudflare r2:bundles:migrate -- \
  --source "$SOURCE_BUCKET" --destination "$DESTINATION_BUCKET" --source-frozen
```

The count must match exactly; a stale count fails closed rather than deleting a
different set. Record every reported prune count in the private change record.
Repeat until the read-only proof passes with no divergence in either direction.

The migration refuses to start while anything remains under the
lifecycle-managed `hosted-email/messages/` or `hosted-meal-photos/images/`
prefixes, in both the `--apply` and read-only forms, before it creates or
copies any destination object. Copying such an object would restart its 24-hour
or 31-day deletion backstop in ENAM, and dropping it would lose a pending
import when OC is retired; neither is acceptable, so the operation waits for
the existing import, post-checkpoint cleanup, account-deletion, and lifecycle
owners to empty those prefixes.

Record a zero-object inventory for both prefixes immediately before the copy.
If either prefix cannot be emptied, rebook the window rather than copying or
dropping its contents.

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
direct-R2 smoke before reopening writers.

Rollback is unconditionally safe here because account deletion is deferred for
the whole window: no member can have deleted data from one bucket that the
other still holds, so restoring OC cannot republish anything. Cloudflare can
briefly run old Durable Object code during an update; these proofs are the gate
that catches an OC or ENAM orphan cleanup in the binding-switch window. Cleanup
re-reads the current snapshot before deleting, so it cannot remove the
referenced checkpoint.

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
   credentials;
4. remove `HOSTED_ACCOUNT_DELETION_MAINTENANCE` from the Vercel production
   environment, deploy, and prove both an `account.delete` challenge request and
   the delete route reach the application again; and
5. delete this runbook, migration script, tests, package command, and the
   account-deletion maintenance module and its call site in one cleanup PR.

Retirement does not require OC/ENAM parity after the commit point: new ENAM
checkpoints and orphan cleanup legitimately diverge them. It does require all
three bucket variables to still read back as ENAM, the intended Worker version
to be the sole 100% deployment, and the fresh ENAM checkpoint/cold restore proof
to remain accepted before any OC credential or bucket is removed.

Finally remove operator-shell credentials without printing them:

```bash
unset R2_MIGRATION_ACCESS_KEY_ID R2_MIGRATION_SECRET_ACCESS_KEY CLOUDFLARE_ACCOUNT_ID
```
