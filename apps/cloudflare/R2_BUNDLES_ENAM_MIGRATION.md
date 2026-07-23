# Hosted R2 bundles: OC to ENAM migration

This temporary operator runbook moves the hosted `BUNDLES` data from Oceania
(`OC`) to Eastern North America (`ENAM`). Delete it and the migration command
after the old buckets are retired.

The application already reads one bucket binding and one matching presign
bucket from deploy configuration. The migration therefore adds no dual-read
runtime, fallback, or data-model change: create new ENAM buckets, copy and
verify them, then switch the existing configuration in one immediate deploy.

The expected production write pause is the ten-minute PUT-URL drain plus the
final delta, deploy, and smoke. Do not schedule that window until the readiness
gates below already pass.

## Safety contract

- Rehearse the entire flow on a distinct staging Worker and the preview data.
- The source remains authoritative and untouched until cutover.
- Use a temporary R2 Object Read & Write key scoped only to the source and
  destination pair. It is never a runtime credential.
- The command accepts only an OC source and ENAM destination with Standard
  defaults. It fails on objects at the single-copy limit, non-Standard objects,
  or multipart/non-MD5 ETags instead of weakening verification.
- Seed excludes every prefix in `r2-bundles-lifecycle.json`. The command first
  proves the source has those exact live rules, applies them only to an empty
  destination, and reads them back.
- Seed uses server-side `CopyObject` with metadata preservation. Exact simple
  ETag, key, size, and storage-class equality proves copied bytes; the staging
  rehearsal separately proves representative v2 snapshot metadata and restore.
- The first seed accepts only an empty destination and writes one zero-byte
  provenance marker bound to the exact bucket pair. Retries and final require
  that marker, preventing a destructive command from drifting to another ENAM
  bucket. It stays under the reserved `_murph/r2-bundles-migration/` prefix,
  outside application-owned prefixes, through cutover and rollback. Final
  excludes it from deletion. Verify accepts that exact marker or its absence
  after retirement cleanup, and rejects every other marker state.
- Final refuses to delete until the frozen source is already fully and exactly
  present at the destination. The operator must acknowledge a hash of the
  exact destination-only deletion set before one `sync --delete`.
- `--source-frozen` is an operator assertion, not a lock. The external write
  fence must remain active through the last `verify`, environment edits,
  immediate deploy, and pre-commit smoke.

References: [R2 data location][data-location], [R2 consistency][consistency],
[R2 authentication][r2-auth], [R2 S3 compatibility][s3-api], [R2 object
uploads and ETags][r2-upload], AWS CLI [`sync`][aws-sync], and [S3 transfer
configuration][aws-config].

[data-location]: https://developers.cloudflare.com/r2/reference/data-location/
[consistency]: https://developers.cloudflare.com/r2/reference/consistency/
[r2-auth]: https://developers.cloudflare.com/r2/api/tokens/
[s3-api]: https://developers.cloudflare.com/r2/api/s3/api/
[r2-upload]: https://developers.cloudflare.com/r2/objects/upload-objects/
[aws-sync]: https://docs.aws.amazon.com/cli/latest/reference/s3/sync.html
[aws-config]: https://docs.aws.amazon.com/cli/latest/topic/s3-config.html

## 1. Create the new bucket before credentials

Authenticate Wrangler to the correct account. Create a uniquely named ENAM
bucket; bucket location cannot be changed after creation. Never delete or
recreate the OC source.

```bash
SOURCE_BUCKET='<oc-bucket>'
DESTINATION_BUCKET='<new-enam-bucket>'
pnpm --dir apps/cloudflare exec wrangler r2 bucket create "$DESTINATION_BUCKET" --location enam
pnpm --dir apps/cloudflare exec wrangler r2 bucket info "$SOURCE_BUCKET" --json
pnpm --dir apps/cloudflare exec wrangler r2 bucket info "$DESTINATION_BUCKET" --json
```

Only after both buckets exist, issue a temporary R2 key limited to that pair.
Load it without echoing the secret or putting it in an argument:

```bash
read -r CLOUDFLARE_ACCOUNT_ID
read -r R2_MIGRATION_ACCESS_KEY_ID
read -r -s R2_MIGRATION_SECRET_ACCESS_KEY
export CLOUDFLARE_ACCOUNT_ID R2_MIGRATION_ACCESS_KEY_ID R2_MIGRATION_SECRET_ACCESS_KEY
```

The wrapper gives AWS and Wrangler separate minimal child environments. It
never prints subprocess arguments, stderr, raw object keys, or credentials.

## 2. Rehearse on preview data

There is no GitHub-hosted preview Worker deployment lane. Use the documented
manual staging path in `apps/cloudflare/DEPLOY.md` with a distinct
`CF_WORKER_NAME` and `HOSTED_EXECUTION_DEPLOY_CONTEXT=preview`.

Run the read-only seed preflight, then the seed:

```bash
pnpm --dir apps/cloudflare r2:bundles:migrate -- \
  --phase seed --source "$SOURCE_BUCKET" --destination "$DESTINATION_BUCKET"

pnpm --dir apps/cloudflare r2:bundles:migrate -- \
  --phase seed --source "$SOURCE_BUCKET" --destination "$DESTINATION_BUCKET" \
  --confirm-destination "$DESTINATION_BUCKET" --apply
```

The first applied seed sets and reads back lifecycle rules on the empty
destination, writes the pair-bound migration marker, and only then starts the
copy. A retry refuses a non-empty destination without that marker. Final keeps
the marker outside application-owned prefixes so the destination remains
attributable, pre-commit retries remain safe, and the rollback window retains
its provenance.

Stop staging writers, wait ten minutes from the last possible presigned PUT,
and rerun seed under that fence. Then run final dry-run, copy its exact
delete-set token, apply final, and verify:

```bash
pnpm --dir apps/cloudflare r2:bundles:migrate -- \
  --phase final --source "$SOURCE_BUCKET" --destination "$DESTINATION_BUCKET"

DELETE_SET='<count:sha256-from-dry-run>'
pnpm --dir apps/cloudflare r2:bundles:migrate -- \
  --phase final --source "$SOURCE_BUCKET" --destination "$DESTINATION_BUCKET" \
  --confirm-destination "$DESTINATION_BUCKET" \
  --confirm-delete-set "$DELETE_SET" --source-frozen --apply

pnpm --dir apps/cloudflare r2:bundles:migrate -- \
  --phase verify --source "$SOURCE_BUCKET" --destination "$DESTINATION_BUCKET"
```

For the deployed staging rehearsal, set both `CF_BUNDLES_BUCKET` and
`HOSTED_R2_PRESIGN_BUCKET_NAME` to the ENAM preview destination. Set
`CF_BUNDLES_PREVIEW_BUCKET` to the ENAM preview bucket as required by deploy
configuration, but do not mistake it for the deployed binding: Wrangler uses
it only as `preview_bucket_name`. Deploy with:

```bash
pnpm --dir apps/cloudflare deploy:worker
```

The manual deploy does not automatically run `deploy:smoke`; run the matching
staging smoke separately with the same staging environment:

```bash
pnpm --dir apps/cloudflare deploy:smoke
```

Require all of this before production:

1. HEAD the same representative v2 snapshot in both buckets and compare
   `ContentLength`, ETag, custom metadata, supported HTTP metadata, stored
   SHA-256, and checksum type. Keep the private key and output local and
   ephemeral; do not paste them into a PR, issue, or log.
2. Cold-restore an existing copied v2 snapshot through the staging Worker.
3. Write a fresh staging checkpoint and cold-restore it from ENAM.

This comparison emits no key or metadata. Enter the preview object key without
terminal echo; do not run with shell tracing enabled:

```bash
(
  set -euo pipefail
  read -r -s SNAPSHOT_KEY
  R2_ENDPOINT="https://${CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com"
  head_snapshot() {
    AWS_ACCESS_KEY_ID="$R2_MIGRATION_ACCESS_KEY_ID" \
    AWS_SECRET_ACCESS_KEY="$R2_MIGRATION_SECRET_ACCESS_KEY" \
    AWS_CONFIG_FILE=apps/cloudflare/scripts/r2-bundles-migration.aws-config \
      aws s3api head-object --bucket "$1" --key "$SNAPSHOT_KEY" \
        --checksum-mode ENABLED --endpoint-url "$R2_ENDPOINT" --region auto \
        --output json --no-cli-pager | \
      jq -Sc '{CacheControl,ChecksumCRC32,ChecksumCRC32C,ChecksumSHA1,ChecksumSHA256,ChecksumType,ContentDisposition,ContentEncoding,ContentLanguage,ContentLength,ContentType,ETag,Expires,Metadata}'
  }
  SOURCE_HEAD="$(head_snapshot "$SOURCE_BUCKET")"
  DESTINATION_HEAD="$(head_snapshot "$DESTINATION_BUCKET")"
  test -n "$SOURCE_HEAD"
  test -n "$DESTINATION_HEAD"
  test "$SOURCE_HEAD" = "$DESTINATION_HEAD"
)
```

## 3. Seed production and pass readiness days ahead

Create a separate production ENAM destination and pair-scoped migration key.
Run seed while OC remains live. It can be rerun; it never deletes destination
objects.

Seed deliberately excludes raw email and staged meal-photo objects because a
copy resets their age. Those prefixes currently expire after one and 31 days.
Run a final dry-run days ahead and do not book the maintenance window until:

- every lifecycle-managed source prefix is empty naturally;
- every source object has a simple quoted 32-hex ETag and supported size;
- the destination already contains the complete exact source; and
- both inventory reads are stable.

Do not delete transient evidence merely to make the gate pass. If durable
source objects changed, rerun seed and readiness.

## 4. Establish the external write fence

The repository has no global BUNDLES writer-freeze switch. One cutover owner
must use the established provider/operator controls and prove every item below.
If any item cannot be proven, abort; `--source-frozen` does not compensate.

1. Prevent any other operator from editing the hosted GitHub environment or
   dispatching a deployment. Confirm no hosted deploy is queued or running.
2. Pause new hosted message admission and browser-vault activity.
3. Pause Cloudflare Email Routing, meal-photo intake/staging, automations,
   Temporal/cron wakes, account deletion, and operator jobs that write or
   delete BUNDLES objects.
4. Confirm every runner reports no in-flight invocation and the hosted mailbox
   is drained. Keep a private record of the last possible presigned PUT time.
5. Wait a full ten minutes after that time. Existing one-hour GET URLs are
   read-only; retain their signing key and OC access.

Keep this fence active until section 7 explicitly reopens normal writers.
Account-deletion completion stays paused and fail-closed through OC retirement
in section 8.

## 5. Final delta under the fence

First rerun seed while frozen so final never depends on `sync` detecting a
same-size update. Then run the final dry-run, apply its current deletion token,
and verify:

```bash
pnpm --dir apps/cloudflare r2:bundles:migrate -- \
  --phase seed --source "$SOURCE_BUCKET" --destination "$DESTINATION_BUCKET" \
  --confirm-destination "$DESTINATION_BUCKET" --apply

pnpm --dir apps/cloudflare r2:bundles:migrate -- \
  --phase final --source "$SOURCE_BUCKET" --destination "$DESTINATION_BUCKET"

DELETE_SET='<current-count:sha256>'
pnpm --dir apps/cloudflare r2:bundles:migrate -- \
  --phase final --source "$SOURCE_BUCKET" --destination "$DESTINATION_BUCKET" \
  --confirm-destination "$DESTINATION_BUCKET" \
  --confirm-delete-set "$DELETE_SET" --source-frozen --apply

pnpm --dir apps/cloudflare r2:bundles:migrate -- \
  --phase verify --source "$SOURCE_BUCKET" --destination "$DESTINATION_BUCKET"
```

If any command fails or exceeds the maintenance budget, leave configuration
unchanged, reopen writers against OC, and retry the same pair later; its
provenance marker remains. Immediately rerun `verify` just before dispatching
the deploy so the proof-to-deploy gap is as small as possible.

## 6. Switch configuration and deploy immediately

If the runtime presign credential is source-scoped, create a transition
credential authorized for both OC and ENAM. Update these two GitHub secrets to
that credential without revoking the old source key:

- `HOSTED_R2_PRESIGN_ACCESS_KEY_ID`
- `HOSTED_R2_PRESIGN_SECRET_ACCESS_KEY`

While deploys remain frozen, update these GitHub environment variables with no
workflow dispatch between edits:

- `CF_BUNDLES_BUCKET` to the ENAM production bucket;
- `CF_BUNDLES_PREVIEW_BUCKET` to the rehearsed ENAM preview bucket; and
- `HOSTED_R2_PRESIGN_BUCKET_NAME` to the ENAM production bucket.

The deployed preflight requires the binding and presign bucket to match. From
an up-to-date `main`, dispatch one immediate deployment:

```bash
pnpm cf:deploy:immediate
```

Do not use a gradual rollout. Keep both the old signing key and transition
credential valid for OC until outstanding one-hour URLs expire and the chosen
rollback window closes.

## 7. Pre-commit smoke, commit point, and post-commit restore

While writers remain fenced, require:

1. the deploy reports the exact Worker version and managed-container
   fingerprint healthy; and
2. the immediate-rollout direct-R2 smoke completes its self-cleaning PUT,
   binding HEAD, size check, and delete against ENAM.

Do not run a production turn or canonical checkpoint yet. Until the first
durable ENAM write, rollback is still variables-back plus another immediate
deploy because OC remains authoritative.

If the pre-commit smoke passes, explicitly accept ENAM and reopen normal
writers, but keep account-deletion completion paused and fail-closed. The first
durable ENAM write is the rollback commit point. After it:

1. cold-start an existing member to prove the copied v2 snapshot restores;
2. let it produce a fresh ENAM checkpoint; and
3. cold-restore that fresh checkpoint.

A failure after the commit point requires a forward fix or a reviewed reverse
migration, not a blind variables-back deploy.

## 8. Rollback, credentials, and retirement

Before the commit point, restore the three old variables and deploy
immediately; the unchanged OC source is still authoritative. After the commit
point, a reverse migration requires another full writer fence, PUT-URL drain,
exact ENAM-to-OC mirror, verification, and review.

The runtime deletion path only targets the active ENAM bucket. Keep
account-deletion completion paused and fail-closed while OC remains, or it
could report completion while leaving the OC copy behind.

Keep both OC buckets, lifecycle rules, old signing key, and transition runtime
credential through old GET URL expiry and rollback sign-off: at least one hour
after cutover, but no more than 24 hours after cutover. Retire OC by that
deadline only in a separate, explicitly reviewed destructive operation after
the restore evidence passes. That operation must first delete each exact
pair-bound marker from its ENAM destination and prove each reserved migration
prefix is empty; this is ENAM cleanup performed alongside retirement, not an
instruction for the migration tool to delete OC. Then retire the matching OC
buckets, revoke the temporary pair-scoped migration keys, and remove them from
the operator shell:

```bash
unset R2_MIGRATION_ACCESS_KEY_ID R2_MIGRATION_SECRET_ACCESS_KEY CLOUDFLARE_ACCOUNT_ID
```

Only after OC is retired, reopen account deletion, narrow runtime credentials
to ENAM, revoke the old signing key and transition scope, and delete this
runbook, migration script, tests, package command, and AWS config in one
cleanup PR.
