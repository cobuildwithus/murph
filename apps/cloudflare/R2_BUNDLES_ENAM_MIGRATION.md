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
- Before the destination exists, close account-deletion admission, retire every
  predecessor invocation, and prove every frozen source object belongs to a
  current canonical hosted-member namespace or is an exact legacy bundle key
  reached from that member's canonical workspace snapshot reference. Unknown
  or unowned placement blocks the migration without printing its key.
- The OC source remains authoritative until the binding switch and remains the
  rollback source until the first durable ENAM checkpoint. The tool never
  deletes from the OC source.
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
alone and load it into `R2_MIGRATION_ACCESS_KEY_ID` and
`R2_MIGRATION_SECRET_ACCESS_KEY` in place of the pair-scoped key. Run the
whole abandonment as one fail-closed block. It removes every ambient AWS
credential source, binds the destination-only key explicitly, proves the exact
pair marker exists in the named destination, and requires the source probe to
fail specifically with `AccessDenied` before either destructive command runs:

```bash
(
  set -euo pipefail
  test -n "$SOURCE_BUCKET"
  test -n "$DESTINATION_BUCKET"
  test "$DESTINATION_BUCKET" != "$SOURCE_BUCKET"
  test -n "$R2_MIGRATION_ACCESS_KEY_ID"
  test -n "$R2_MIGRATION_SECRET_ACCESS_KEY"

  unset AWS_PROFILE AWS_DEFAULT_PROFILE AWS_SESSION_TOKEN AWS_SECURITY_TOKEN
  unset AWS_ROLE_ARN AWS_ROLE_SESSION_NAME AWS_WEB_IDENTITY_TOKEN_FILE
  unset AWS_CONTAINER_CREDENTIALS_FULL_URI AWS_CONTAINER_CREDENTIALS_RELATIVE_URI
  export AWS_ACCESS_KEY_ID="$R2_MIGRATION_ACCESS_KEY_ID"
  export AWS_SECRET_ACCESS_KEY="$R2_MIGRATION_SECRET_ACCESS_KEY"
  export AWS_EC2_METADATA_DISABLED=true
  export AWS_CONFIG_FILE=/dev/null AWS_SHARED_CREDENTIALS_FILE=/dev/null
  R2_ENDPOINT="https://${CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com"

  MARKER_KEY="$(node -e '
    const { createHash } = require("node:crypto");
    const [source, destination] = process.argv.slice(1);
    const pair = createHash("sha256").update(`${source}\0${destination}`).digest("hex");
    process.stdout.write(`_murph/r2-bundles-migration/${pair}.marker`);
  ' "$SOURCE_BUCKET" "$DESTINATION_BUCKET")"
  aws s3api head-object --bucket "$DESTINATION_BUCKET" --key "$MARKER_KEY" \
    --endpoint-url "$R2_ENDPOINT" --region auto --no-cli-pager >/dev/null

  ABANDONMENT_TMP_DIR="$(mktemp -d)"
  SOURCE_PROBE_ERROR="$ABANDONMENT_TMP_DIR/source-probe.err"
  trap 'rm -f "$SOURCE_PROBE_ERROR"; rmdir "$ABANDONMENT_TMP_DIR"' EXIT
  if aws s3api list-objects-v2 --bucket "$SOURCE_BUCKET" --max-items 1 \
    --endpoint-url "$R2_ENDPOINT" --region auto --no-cli-pager \
    >/dev/null 2>"$SOURCE_PROBE_ERROR"; then
    echo "Destination-only credential can read the source; stop." >&2
    exit 1
  fi
  if ! grep -q 'AccessDenied' "$SOURCE_PROBE_ERROR"; then
    echo "Source probe did not fail with AccessDenied; stop." >&2
    exit 1
  fi

  aws s3 rm "s3://$DESTINATION_BUCKET" --recursive \
    --endpoint-url "$R2_ENDPOINT" --region auto --no-cli-pager
  pnpm --dir apps/cloudflare exec wrangler r2 bucket delete "$DESTINATION_BUCKET"
)
```

Prove the bucket is gone afterwards through an authenticated bucket listing,
then revoke the destination-only key. Do not compare the source count with
section 1: ordinary cleanup is allowed to remove source objects throughout the
window, so count equality is not a source-safety proof. The mechanically bound
destination-only credential, exact pair marker, and denied source probe are the
proof that abandonment had no authority over OC.

Then release the `r2-bundles-enam` purpose before reopening anything. Once the
destination is gone, OC is the sole authoritative bucket again and this
migration no longer needs deletion maintenance. Follow the shared
`agent-docs/operations/hosted-account-deletion-maintenance.md` release
procedure: clear and deploy the flag only if no other purpose remains active,
then prove the protected effects either reach the application or remain
correctly closed by the other purpose. Only then reopen ordinary writers and
rebook.

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

The shared lifecycle in
`agent-docs/operations/hosted-account-deletion-maintenance.md` owns both edges
of the flag. This migration opens the `r2-bundles-enam` purpose before the
destination exists, keeps it active while an ENAM bucket holds copies that
could still become live, and releases only that purpose when OC is the sole
authority again:

| Point in the operation | Control |
| --- | --- |
| Section 4 | Unset. |
| Activation, predecessor retirement, and active-owner gate | Set. The destination does not exist yet. |
| Activation or owner-gate failure | Release `r2-bundles-enam`; clear through a production deployment only if the shared owner has no other active purpose. No destination cleanup is needed. |
| Copy, cutover, proofs, canary | Set. |
| Any pre-commit abandonment or overrun | Release `r2-bundles-enam` through the abandonment procedure before writers reopen; another purpose may keep the flag set. |
| Successful retirement | Release `r2-bundles-enam` in section 8; clear only if it was the final purpose. |

Do not create the destination until activation, the absolute predecessor wait,
and the active-owner gate all pass. If a later setup step fails before the copy
tool creates the pair marker, leave the empty, unbound destination in place,
revoke its temporary key, release this migration's purpose, and rebook. Once
the pair marker exists, use the mechanically guarded abandonment procedure. No
ordinary exit leaves an unowned purpose.

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

Redeploy production, then prove every protected effect in
`agent-docs/operations/hosted-account-deletion-maintenance.md` before copying.
In particular, `POST /api/settings/sensitive-action-challenge` with
`account.delete` and `POST /api/settings/privacy/delete` must each return `503`
with `account_deletion_maintenance`, subscription Checkout must return `503`
with `subscription_checkout_maintenance`, and `vault.export` must still return
`200`.

The challenge route is the one members hit first, so declining there means a
member who tries during the window is told before any passkey approval and
before any browser-vault teardown, with the dialog still open and an unspent
authorization. The delete route keeps the same guard as the effect boundary, so
a direct request cannot bypass the window.

This runbook never deletes the shared maintenance module, environment contract,
or effect guards. Their lifecycle belongs only to the shared owner.

References: [R2 data location][data-location], [R2 consistency][consistency],
[R2 authentication][r2-auth], [R2 S3 compatibility][s3-api], and [R2's current
leading-slash `CopyObject` example][copy-object]. The cutover ordering also
accounts for [Worker version deployment semantics][worker-versions], [Durable
Object code-update skew][do-updates], [Durable Object alarms][do-alarms],
[AWS CLI automatic pagination][aws-cli-pagination],
[Vercel Function duration limits][vercel-function-duration], and
[Vercel Skew Protection][vercel-skew-protection].

[data-location]: https://developers.cloudflare.com/r2/reference/data-location/
[consistency]: https://developers.cloudflare.com/r2/reference/consistency/
[r2-auth]: https://developers.cloudflare.com/r2/api/tokens/
[s3-api]: https://developers.cloudflare.com/r2/api/s3/api/
[copy-object]: https://developers.cloudflare.com/r2/buckets/storage-classes/
[worker-versions]: https://developers.cloudflare.com/workers/versions-and-deployments/
[do-updates]: https://developers.cloudflare.com/durable-objects/platform/known-issues/#code-updates
[do-alarms]: https://developers.cloudflare.com/durable-objects/api/alarms/
[aws-cli-pagination]: https://docs.aws.amazon.com/cli/latest/userguide/cli-usage-pagination.html
[vercel-function-duration]: https://vercel.com/docs/functions/configuring-functions/duration
[vercel-skew-protection]: https://vercel.com/docs/skew-protection

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
5. Do not set the deletion-window control yet. Section 5 activates and proves
   it before creating the destination, so an abort anywhere in this section
   leaves nothing to unwind.
6. Do not claim that `HostedUserRunner` cleanup alarms are stopped. They fire on
   schedule with no invocation, and the platform retries an attempt that failed
   earlier, so one can delete a source object at any point in the window. That
   is handled by `--prune` in section 5 rather than prevented. Every other
   deleter — bundle-transition GC and replaced legacy snapshot cleanup — runs
   only on a write path and is already fenced by items 1 and 2.

Keep the fence through section 7.

## 5. Close deletion admission, prove source ownership, and copy

Vercel runtime logs are diagnostic only. Their filters, result limit, and
retention do not provide a complete-enumeration or bounded-indexing contract,
so no log query, request count, status, cursor, or flush delay can authorize
destination creation.

First confirm Skew Protection is enabled. Also confirm this project uses Fluid
Compute and its ordinary Function default remains 300 seconds; the delete route
pins the maintenance-bearing version to that same duration:

```bash
pnpm --dir apps/web exec vercel api /v9/projects/murph --raw 2>/dev/null |
  jq -e '
    (.skewProtectionMaxAge | type == "number" and . > 0)
    and .defaultResourceConfig.fluid == true
    and .defaultResourceConfig.functionDefaultTimeout == 300
  ' >/dev/null
```

Set `HOSTED_ACCOUNT_DELETION_MAINTENANCE=1`, deploy it to 100 percent, prove
the three route checks from the deferral section, and record its exact
deployment ID as `MAINTENANCE_DEPLOYMENT_ID`. In that deployment's Vercel menu,
advance the [Skew Protection Threshold][vercel-skew-protection] to
`MAINTENANCE_DEPLOYMENT_ID`.

The later of the 100-percent deployment confirmation and the threshold
confirmation is the single admission-closing instant. Traffic percentage alone
is not sufficient because Skew Protection can still address an older
deployment. Once the threshold is set, no new request can resolve to an older
unset-guard deployment and every request on the maintenance deployment rejects
before consuming its sensitive-action challenge.

Wait Vercel's current absolute Node.js Function maximum, not a runtime-log
flush interval and not merely this route's current 300-second setting. This
retires any already-running predecessor even if a historical deployment had a
larger explicit duration:

```bash
test -n "$MAINTENANCE_DEPLOYMENT_ID"
: "${VERCEL_ABSOLUTE_FUNCTION_MAX_SECONDS:?set from the current official Vercel Function limit}"
export DELETION_ADMISSION_CLOSED_UTC="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
sleep "$VERCEL_ABSOLUTE_FUNCTION_MAX_SECONDS"
```

The wait proves only that no pre-threshold Web invocation remains active. It
does not infer whether a prior deletion completed. That outcome is derived
from the two existing durable owners instead: the frozen source R2 inventory
and canonical Postgres `hosted_member` rows.

Before creating the destination, require the lifecycle-managed
`hosted-email/messages/` and `hosted-meal-photos/images/` prefixes to contain
zero objects. Copying one would restart its deletion backstop in ENAM, while
dropping one could lose a pending import. If either prefix cannot be emptied,
rebook rather than copying or dropping its contents.

Issue a temporary Object Read-only key scoped only to the OC source. Load it
without terminal echo, then run the active-owner gate:

```bash
command -v murph-prod-psql-ro >/dev/null
read -r CLOUDFLARE_ACCOUNT_ID
read -r R2_MIGRATION_ACCESS_KEY_ID
read -r -s R2_MIGRATION_SECRET_ACCESS_KEY
export CLOUDFLARE_ACCOUNT_ID R2_MIGRATION_ACCESS_KEY_ID R2_MIGRATION_SECRET_ACCESS_KEY

pnpm --dir apps/cloudflare r2:bundles:active-owners -- \
  --source "$SOURCE_BUCKET" --source-frozen

unset R2_MIGRATION_ACCESS_KEY_ID R2_MIGRATION_SECRET_ACCESS_KEY CLOUDFLARE_ACCOUNT_ID
```

Revoke that source-only key immediately. The gate performs two stable,
paginated source inventories and one complete Keychain-backed read-only query
of each current `hosted_member.id` and its left-joined
`hosted_workspace.snapshot_ref`. It derives the deterministic `hsn_` namespace
ids in memory and reuses the runtime's canonical snapshot parser to extract the
exact base, hot, or delta bundle keys from any supported pre-v2 reference. It
requires every current canonical checkpoint object to exist in the frozen
source, reports counts only, and refuses every source object that is neither
under a current hosted-member namespace nor exactly referenced by one of those
canonical legacy snapshots. It never prints or writes a member id, namespace
id, snapshot reference, object key, or database URL.

A request hidden from or delayed in Vercel logs cannot evade this proof. If it
removed its member row but left even one R2 object, that namespace is unowned
and every legacy snapshot reference disappeared through the existing cascade,
so destination creation fails. If it completed R2 cleanup, there is no object
to copy. A dormant current member's supported legacy full, layered, or working
checkpoint remains copyable only through its exact canonical reference; a
different or unreferenced legacy key remains ambiguous. An empty owner result,
missing canonical checkpoint object, unknown key placement, malformed canonical
snapshot reference, unstable inventory, failed automatic pagination, malformed
AWS output, failed Postgres query, or unowned object all fail closed.

Any failure keeps OC authoritative and the destination nonexistent. Preserve
the source, release the `r2-bundles-enam` purpose through the shared maintenance
owner, clear through a production deployment only if no other purpose remains,
and investigate an unowned-object result as a privacy incident before
rebooking. Do not delete an ambiguous source object or substitute logs,
elapsed time, a retrying scan, or a manual count.

The external write fence remains active after this gate. An account deletion
cannot start, and ordinary writers cannot create another namespace. A
previously scheduled cleanup may still delete a source object; the migration's
explicit prune-and-reprove path safely converges that deletion.

Only now define the authoritative production pair, create its dedicated ENAM
bucket, and issue a new pair-scoped migration key as in section 2. Never reuse
the revoked source-only owner-gate key:

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
4. release the `r2-bundles-enam` purpose through
   `agent-docs/operations/hosted-account-deletion-maintenance.md`; clear and
   deploy the flag only if no other purpose remains, then prove the protected
   effects have the expected shared state; and
5. delete this runbook, migration script, tests, and package command in one
   cleanup PR. Do not delete the shared maintenance module or its guards.

Retirement does not require OC/ENAM parity after the commit point: new ENAM
checkpoints and orphan cleanup legitimately diverge them. It does require all
three bucket variables to still read back as ENAM, the intended Worker version
to be the sole 100% deployment, and the fresh ENAM checkpoint/cold restore proof
to remain accepted before any OC credential or bucket is removed.

Finally remove operator-shell credentials without printing them:

```bash
unset R2_MIGRATION_ACCESS_KEY_ID R2_MIGRATION_SECRET_ACCESS_KEY CLOUDFLARE_ACCOUNT_ID
```
