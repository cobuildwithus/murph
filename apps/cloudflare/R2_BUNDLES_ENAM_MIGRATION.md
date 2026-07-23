# Hosted R2 bundles: OC to ENAM migration

This temporary operator runbook moves the hosted `BUNDLES` data from Oceania
(`OC`) to Eastern North America (`ENAM`). Delete it and the migration command
after the old buckets are retired.

The application already reads one bucket binding and one matching presign
bucket. The move therefore needs no dual-read runtime, fallback, or data-model
change: create dedicated ENAM buckets, copy and prove them, then switch the
existing configuration in one immediate deploy.

The expected production write pause is the ten-minute PUT-URL drain plus the
cutover deploy, post-deploy proof, one controlled restore canary, and one
same-head redeploy that forces its second restore onto a new versioned
container. Seed within 24 hours of the cutover; do not leave a second
production copy without a bounded owner.

## Safety contract

- Rehearse the whole flow against real R2 with a distinct staging Worker and
  the existing preview bucket before creating the production destination. The
  rehearsed ENAM bucket becomes the new configured preview bucket, so the
  production deploy never references an undefined bucket.
- The OC source remains authoritative until the binding switch and remains the
  rollback source until the first durable ENAM checkpoint. The tool never
  deletes from either bucket. An unexpected ENAM object is an invariant
  failure: abandon that unused destination instead of deleting unknown data.
- Keep the production ENAM destination unbound and writer-exclusive until
  cutover. Use a temporary Object Read & Write key scoped only to the exact
  bucket pair.
- Seed lists the source, then issues bounded, explicit `CopyObject` requests.
  Each request uses R2's required leading-slash source, the listed source ETag
  as a precondition, metadata `COPY`, and Standard storage. There is no `sync`
  heuristic or multipart path.
- Objects at the single-copy limit, non-Standard objects, and multipart or
  non-MD5 ETags fail closed. Seed excludes the canonical lifecycle prefixes;
  those prefixes must be naturally empty before final.
- The first seed accepts only an empty destination, reads back its lifecycle
  rules, conditionally creates one zero-byte marker bound to the exact pair,
  and proves that marker is the only object before copying. Every retry and
  final check requires that marker.
- Final is read-only. It requires `--source-frozen`, two stable inventory
  reads, the exact marker, and exact key, size, ETag, and storage-class parity
  with zero destination-only application objects.
- `--source-frozen` is an operator assertion, not a lock. Keep the external
  fence active through variable readback, both deploys, the post-deploy final
  checks, direct smokes, and both controlled restore wakes.

References: [R2 data location][data-location], [R2 consistency][consistency],
[R2 authentication][r2-auth], [R2 S3 compatibility][s3-api], [R2's current
leading-slash `CopyObject` example][copy-object], and [Vercel WAF custom
rules][vercel-waf]. The cutover ordering also accounts for [Worker version
deployment semantics][worker-versions], [Durable Object code-update skew][do-updates],
and [Durable Object alarms][do-alarms].

[data-location]: https://developers.cloudflare.com/r2/reference/data-location/
[consistency]: https://developers.cloudflare.com/r2/reference/consistency/
[r2-auth]: https://developers.cloudflare.com/r2/api/tokens/
[s3-api]: https://developers.cloudflare.com/r2/api/s3/api/
[copy-object]: https://developers.cloudflare.com/r2/buckets/storage-classes/
[vercel-waf]: https://vercel.com/docs/vercel-firewall/vercel-waf/custom-rules
[worker-versions]: https://developers.cloudflare.com/workers/versions-and-deployments/
[do-updates]: https://developers.cloudflare.com/durable-objects/platform/known-issues/#code-updates
[do-alarms]: https://developers.cloudflare.com/durable-objects/api/alarms/

## 1. Rehearse the exact copy path on real R2

Move the existing OC preview bucket first; this is both the real R2 rehearsal
and the preview-bucket migration. Create a distinct ENAM preview destination.
Bucket location cannot be changed after creation. Never delete or recreate an
OC source.

```bash
PREVIEW_SOURCE_BUCKET="$(gh variable get CF_BUNDLES_PREVIEW_BUCKET --env production)"
PREVIEW_DESTINATION_BUCKET='<new-preview-enam-bucket>'
pnpm --dir apps/cloudflare exec wrangler r2 bucket create "$PREVIEW_DESTINATION_BUCKET" --location enam
pnpm --dir apps/cloudflare exec wrangler r2 bucket info "$PREVIEW_SOURCE_BUCKET" --json
pnpm --dir apps/cloudflare exec wrangler r2 bucket info "$PREVIEW_DESTINATION_BUCKET" --json
```

If the preview source is empty, first use the existing OC staging Worker to
write a representative v2 checkpoint; the migration final intentionally
refuses an empty source because it cannot prove a real restore path.

Issue a temporary R2 key limited to that pair. Load it without echoing the
secret or placing it in an argument:

```bash
read -r CLOUDFLARE_ACCOUNT_ID
read -r R2_MIGRATION_ACCESS_KEY_ID
read -r -s R2_MIGRATION_SECRET_ACCESS_KEY
export CLOUDFLARE_ACCOUNT_ID R2_MIGRATION_ACCESS_KEY_ID R2_MIGRATION_SECRET_ACCESS_KEY
```

Run read-only preflight, then seed:

```bash
pnpm --dir apps/cloudflare r2:bundles:migrate -- \
  --phase seed --source "$PREVIEW_SOURCE_BUCKET" \
  --destination "$PREVIEW_DESTINATION_BUCKET"

pnpm --dir apps/cloudflare r2:bundles:migrate -- \
  --phase seed --source "$PREVIEW_SOURCE_BUCKET" \
  --destination "$PREVIEW_DESTINATION_BUCKET" \
  --confirm-destination "$PREVIEW_DESTINATION_BUCKET" --apply
```

Stop staging writers, wait ten minutes after the last possible presigned PUT,
rerun seed, then require the read-only final gate:

```bash
pnpm --dir apps/cloudflare r2:bundles:migrate -- \
  --phase seed --source "$PREVIEW_SOURCE_BUCKET" \
  --destination "$PREVIEW_DESTINATION_BUCKET" \
  --confirm-destination "$PREVIEW_DESTINATION_BUCKET" --apply

pnpm --dir apps/cloudflare r2:bundles:migrate -- \
  --phase final --source "$PREVIEW_SOURCE_BUCKET" \
  --destination "$PREVIEW_DESTINATION_BUCKET" --source-frozen
```

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

## 2. Establish the privacy owner and 24-hour lease

The runtime account-deletion cleanup targets only the active bucket. Before
the first production seed, add a temporary Vercel WAF `Deny` rule whose exact
conditions are method `POST` and request path
`/api/settings/privacy/delete`. WAF changes are immediate and need no deploy.

Prove the production rule returns the WAF's `403`, observe the exact rule hit
in Vercel Firewall, and confirm the request did not reach application logs.
Wait ten minutes so any deletion admitted before the rule can finish. Keep the
rule until OC retirement. This blocks only account deletion, not ordinary use.

Record an owner and a deadline no later than 24 hours after the first production
seed. If cutover misses it, perform a separately reviewed abandonment operation
that:

1. empties and deletes only the unused ENAM destination;
2. revokes its migration key;
3. restores the old runtime credential with an immediate deploy if section 3
   had already staged the transition credential; and
4. removes the exact WAF rule and proves account deletion reaches the app.

Never let an abandoned destination become an unowned second data copy.
The deadline is an ownership escalation, never permission to delete or revoke
without proof. After the commit point, extend the named owner and deadline if a
retirement check fails; keep the safety copy and temporary controls in place.

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

## 4. Seed production

Define the authoritative production pair, create its dedicated ENAM bucket,
and issue a separate pair-scoped migration key as in section 1:

```bash
SOURCE_BUCKET="$(gh variable get CF_BUNDLES_BUCKET --env production)"
test "$(gh variable get HOSTED_R2_PRESIGN_BUCKET_NAME --env production)" = "$SOURCE_BUCKET"
DESTINATION_BUCKET='<new-production-enam-bucket>'
pnpm --dir apps/cloudflare exec wrangler r2 bucket create "$DESTINATION_BUCKET" --location enam
pnpm --dir apps/cloudflare exec wrangler r2 bucket info "$SOURCE_BUCKET" --json
pnpm --dir apps/cloudflare exec wrangler r2 bucket info "$DESTINATION_BUCKET" --json

pnpm --dir apps/cloudflare r2:bundles:migrate -- \
  --phase seed --source "$SOURCE_BUCKET" --destination "$DESTINATION_BUCKET"

pnpm --dir apps/cloudflare r2:bundles:migrate -- \
  --phase seed --source "$SOURCE_BUCKET" --destination "$DESTINATION_BUCKET" \
  --confirm-destination "$DESTINATION_BUCKET" --apply
```

Run seed no earlier than 24 hours before the booked cutover. It never deletes
or silently accepts destination extras. Keep the already rehearsed
`PREVIEW_DESTINATION_BUCKET` available; the deploy applies lifecycle rules to
both configured buckets before uploading the Worker.

Seed excludes raw-email and staged meal-photo prefixes because copying resets
their retention age. Do not book the final window until those prefixes are
naturally empty, every object passes the single-copy guards, and seed completes
with exact stable parity. Any later source mutation invalidates readiness;
rerun seed. Any destination-only object invalidates that destination; do not
delete around the gate.

## 5. Establish the production write fence

One cutover owner must prove every item below. Abort if any item is uncertain.

1. Freeze hosted GitHub environment edits and deploy dispatches; prove no
   hosted deploy is queued or running.
2. Pause message and browser-vault admission, Cloudflare Email Routing,
   meal-photo intake, automations, Temporal and cron wakes, and operator jobs
   that can write BUNDLES.
3. Confirm the account-deletion WAF rule remains active.
4. Confirm every runner has no invocation in flight and the mailbox is drained.
5. Record the last possible presigned PUT time and wait ten full minutes.
6. Account for `HostedUserRunner` cleanup alarms. They can still delete only an
   aged orphan after re-reading Web's current snapshot; they do not create
   objects or delete the current referenced snapshot. Do not claim a global
   alarm pause. The formal final checks therefore run after the immediate
   deployment has moved the active binding to ENAM.

Keep the general fence through section 8. Keep account deletion blocked through
section 9.

## 6. Last pre-switch convergence under the fence

Rerun seed to copy the fenced delta, then run one read-only final readiness
check immediately before editing variables. This proves stable parity at that
moment; the two formal final gates run after deploy to catch a cleanup mutation
in the binding-switch window.

```bash
pnpm --dir apps/cloudflare r2:bundles:migrate -- \
  --phase seed --source "$SOURCE_BUCKET" --destination "$DESTINATION_BUCKET" \
  --confirm-destination "$DESTINATION_BUCKET" --apply

pnpm --dir apps/cloudflare r2:bundles:migrate -- \
  --phase final --source "$SOURCE_BUCKET" --destination "$DESTINATION_BUCKET" \
  --source-frozen
```

Final mutates nothing. If this readiness check fails or the window expires,
leave configuration on OC, reopen ordinary writers, and retry before the
24-hour lease ends.

## 7. Switch and read back all configuration

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

## 8. Prove production before reopening writers

While the general fence remains active, require the exact Worker version and
container fingerprint plus the immediate rollout's self-cleaning direct-R2
PUT, binding HEAD, size check, and delete against ENAM. Then run final twice,
still before any user canary:

```bash
for _ in 1 2; do
  pnpm --dir apps/cloudflare r2:bundles:migrate -- \
    --phase final --source "$SOURCE_BUCKET" --destination "$DESTINATION_BUCKET" \
    --source-frozen
done
```

If either check fails, do not wake the canary. Restore all three captured OC
values, deploy immediately, and require the exact rollback workflow and OC
direct-R2 smoke before reopening writers. Cloudflare can briefly run old
Durable Object code during an update; the post-deploy checks are the gate that
catches an OC or ENAM orphan cleanup in that window. Cleanup re-reads the
current snapshot before deleting, so it cannot remove the referenced
checkpoint.

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
fresh cold restore pass. Keep account deletion blocked.

## 9. Retire OC and remove temporary controls

Keep the OC buckets, lifecycle rules, old signing key, and transition runtime
credential until old one-hour GET URLs expire and the canary is signed off:
at least one hour after cutover, with retirement targeted inside the 24-hour
lease. A missed target follows the fail-safe extension in section 2.

Use a separate, explicitly reviewed destructive operation to delete the exact
pair markers from the two ENAM destinations, prove each reserved marker prefix
empty, and retire only the matching production and preview OC buckets. Then:

1. mint an ENAM-only runtime credential;
2. update the two runtime secrets, record their names and `updatedAt` values,
   deploy immediately, and require the ENAM direct-R2 smoke;
3. revoke the transition, old runtime, and production pair-scoped migration
   credentials;
4. remove the exact account-deletion WAF rule and prove the route reaches the
   app again; and
5. delete this runbook, migration script, tests, and package command in one
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
