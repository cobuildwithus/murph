# Hosted R2 bundles: live OC to ENAM cutover bridge

This temporary runbook replaces the whole-copy maintenance window with a
single-writer, two-bucket bridge. It is intentionally optimized for the current
hosted population (roughly twenty members), not for a permanent general-purpose
replication system.

Delete this runbook, the online-copy command, the second binding, and all phase
handling after OC is retired.

## Safety contract

The fixed bucket roles never change while the bridge exists:

- `BUNDLES` is the existing OC source binding.
- `BUNDLES_ENAM` is the new ENAM destination binding.
- `HOSTED_R2_PRESIGN_BUCKET_NAME` is the OC source bucket.
- `HOSTED_R2_PRESIGN_ENAM_BUCKET_NAME` is the ENAM destination bucket.
- `HOSTED_R2_CUTOVER_PHASE` is exactly `source_active` or
  `destination_active`.

The phase changes behavior, not binding identity:

| Phase | Reads | Ordinary writes | General lists | Deletes |
| --- | --- | --- | --- | --- |
| `source_active` | OC only | OC only | OC only | OC, then ENAM |
| `destination_active` | ENAM, then OC only after a definitive miss | ENAM only | ENAM only | OC, then ENAM |

Do not add dual writes, a merged-list abstraction, a migration Durable Object,
a queue, a copy journal, a tombstone, or a hot-path migration lock.

Account deletion is deliberately unavailable through the existing maintenance
response from before the first ENAM application object is created until all of
these conditions hold:

1. destination writes are active;
2. every source-active Worker and Durable Object is drained;
3. every OC-targeting direct PUT URL and bounded upload is expired;
4. the final source-active create-only invocation completed every internal
   convergence cycle;
5. the copier is permanently stopped; and
6. two final directional convergence reads pass.

After deletion is re-enabled, the runtime deletes the member's data from OC
first and ENAM second, obtains stable-empty observations in both buckets, and
deletes Durable Object state last. A partial cleanup or an outstanding direct
PUT returns failure or a retryable response and never reports deletion success.

## What the online copier may copy

`pnpm --dir apps/cloudflare r2:bundles:online-copy` accepts only these
user-scoped immutable classes:

- content-addressed hosted bundles;
- content-addressed artifacts;
- browser-vault replicas after the operator has proved that a `dataVersion`
  cannot identify two different payloads; and
- workspace snapshots with unique snapshot IDs.

Every copy uses:

- the ETag from the OC inventory as a source precondition;
- R2's destination create-only CopyObject condition;
- metadata `COPY`; and
- Standard storage.

The command never issues a delete and never overwrites an ENAM object. An
existing identical ENAM object is convergence. A same-key identity mismatch is
an invariant failure.

The command blocks rather than copies:

- `runner-secrets.json` or any other fixed/mutable key;
- legacy global `bundles/` keys;
- unknown placement;
- an object outside the current hosted-member namespace set;
- a canonical workspace still using a pre-v2 snapshot reference;
- a canonical v2 checkpoint absent from OC;
- non-Standard, multipart/non-MD5, or single-copy-oversized eligible objects;
  and
- any source or destination migration marker other than the exact pair marker.

Raw email, private-media, and meal-photo objects are recognized but excluded:

- `hosted-email/messages/`
- `hosted-private-media/images/`
- `hosted-meal-photos/images/`

Copying these objects would restart their lifecycle age. Their consumers must
continue using exact keys, which automatically receive destination-active
ENAM-to-OC read fallback. Do not introduce a generic merged list to discover
them. Keep OC until all three source prefixes have drained through processing
and their original lifecycle policy.

## Direct snapshot upload tickets

A new upload session records the phase's bucket role. A session written by
pre-bridge code has no role and is interpreted as `source`, preserving OC
affinity during mixed-version drain.

Before returning a direct PUT URL, the Durable Object records:

- the selected fixed bucket role;
- the URL expiry; and
- a conservative deletion-drain deadline.

The production PUT lifetime is fixed at the existing ten-minute direct-upload
window. The runner upload request is independently bounded by that expiry; the
deletion watermark adds another ten-minute conservative completion bound.
Account deletion retries until the watermark has passed, then performs its
final bucket scans.

Completion HEADs the bucket recorded in the session, not the phase's current
primary bucket. Presigned GET first HEADs the current primary; it checks OC only
after an actual ENAM absence and signs the bucket where the object was found.
Permission failures, timeouts, and other operational errors do not trigger
fallback.

Do not issue direct presigned DELETE URLs while the two buckets coexist. Before
the first copy, prove every pre-bridge mutating URL has expired.

## Automated preflight

The online-copy command performs these gates before inventory comparison or
copying:

1. AWS CLI v2 is available.
2. The named source is OC and the named destination is ENAM.
3. Both buckets use Standard as their default storage class.
4. Both buckets exactly match `r2-bundles-lifecycle.json`.
5. A complete read-only `hosted_member`/workspace query succeeds through
   `murph-prod-psql-ro`.
6. Every current canonical snapshot is v2, owned by the matching member, and
   present in OC.
7. Every observed user or lifecycle namespace belongs to a current member.
8. No mutable, unknown, or legacy-global object exists in either bucket.
9. The operator explicitly supplies `--immutable-keys-audited` for copying and
   final convergence.

The command reports counts and short key fingerprints only. It does not print
member IDs, namespace IDs, snapshot references, object keys, or credentials.

## Deployment preparation

Create an empty ENAM production bucket and a separate ENAM preview bucket with
the canonical lifecycle rules. Create one temporary runtime credential scoped
only to the fixed OC/ENAM pair and one temporary online-copy credential scoped
only to that pair.

Configure the GitHub environment variables:

```text
CF_BUNDLES_BUCKET=<existing-oc-production>
CF_BUNDLES_PREVIEW_BUCKET=<existing-oc-preview>
CF_BUNDLES_ENAM_BUCKET=<new-enam-production>
CF_BUNDLES_ENAM_PREVIEW_BUCKET=<new-enam-preview>
HOSTED_R2_PRESIGN_BUCKET_NAME=<existing-oc-production>
HOSTED_R2_PRESIGN_ENAM_BUCKET_NAME=<new-enam-production>
HOSTED_R2_CUTOVER_PHASE=source_active
```

Before rendering Worker deploy artifacts, the deploy preflight reads Cloudflare
bucket metadata and requires each fixed source to report OC and each fixed
destination to report ENAM. It also rejects equal source/destination roles, an
unknown phase, or a presign name that does not match its fixed binding.

## Minimum production sequence

### 1. Merge and deploy V1 in `source_active`

Deploy the complete bridge before placing any application object in ENAM.
Require:

- `BUNDLES` still names OC;
- `BUNDLES_ENAM` names the new ENAM bucket;
- ordinary reads, writes, direct PUTs, and lists remain OC-only;
- every ordinary delete attempts OC and then ENAM; and
- runner status reports protocol `r2-oc-enam-v1` and phase
  `source_active`.

### 2. Drain pre-bridge code and mutating URLs

Enumerate the roughly twenty current hosted members. Wake or query each runner
and require the V1 status protocol. Require no in-flight invocation. Wait the
maximum lifetime of every PUT or DELETE URL that pre-bridge code could have
issued, plus its bounded request duration.

Do not start copying merely because Worker traffic is at 100 percent. An old
Durable Object can outlive the Worker rollout and must be observed directly.

### 3. Enable account-deletion maintenance

Set and prove the existing account-deletion maintenance control at both the
sensitive-action challenge and effect boundaries. Keep unrelated privacy
operations, including export, available.

Wait the existing Web predecessor/skew drain. Only then may the destination
receive the pair marker or copied application data.

### 4. Run source-active create-only passes

Load the pair-scoped migration credential without printing it, then run:

```bash
pnpm --dir apps/cloudflare r2:bundles:online-copy -- \
  --source "$SOURCE_BUCKET" \
  --destination "$DESTINATION_BUCKET" \
  --phase source_active \
  --immutable-keys-audited \
  --confirm-destination "$DESTINATION_BUCKET" \
  --copier-exclusive \
  --hold-for-source-put-drain \
  --apply
```

`--copier-exclusive` is an operator assertion, not a distributed lock. Use one
controlled credential and one operator shell for this bucket pair. Never
overlap apply invocations across terminals, hosts, CI, or automation. The one
acknowledged process retains the source keys it observes, re-inventories after
each copy cycle, and continues internally when concurrent OC writes appear.
An ETag change for an approved immutable key blocks the operation and must be
investigated.

That provenance exists only in the live process. A later process must reject
every source-active destination-only eligible object because it cannot
distinguish clean prior churn from an ambiguous late commit.

`--hold-for-source-put-drain` makes the production-cutover process pause at its
first temporary zero-source-only observation without discarding provenance.
Continue with step 6 while that exact process waits. A timing-only rehearsal
must omit this flag; if it exits with destination-only churn, keep that
destination as rehearsal evidence only and never restart copying into it.

CopyObject has three narrow recovery cases:

1. The initial request allows one additional attempt only when the first
   built-in-fetch rejection is a `TypeError` whose direct cause code is
   `UND_ERR_CONNECT_TIMEOUT`, proving that the failed connection attempt never
   reached the server.
2. An initial built-in-fetch `TypeError` whose direct cause code is exactly
   `ECONNRESET` enters identity reconciliation instead of a blind retry. The
   reset does not prove whether R2 committed the create-only request, so the
   copier uses the same strong destination/source HEAD proof and one-second
   same-key recovery floor described below.
3. After the terminal response body is fully drained, exactly HTTP `500`
   enters the same identity reconciliation path. Cloudflare documents `500
   InternalError` as retryable, and R2's direct S3 reads are strongly
   consistent:
   [error codes](https://developers.cloudflare.com/r2/api/error-codes/) and
   [consistency model](https://developers.cloudflare.com/r2/reference/consistency/).
   The copier HEADs the destination and source and requires the planned ETag
   and byte size for every object that exists. An exact destination plus exact
   source proves the first request committed and returns without another PUT.
   An absent destination plus exact source permits exactly one further raw
   create-only CopyObject with the same source and destination conditions. That
   recovery attempt does not use or reset the pre-connect retry wrapper. R2
   permits only [one write per second to the same object key](https://developers.cloudflare.com/r2/platform/limits/),
   so the copier establishes a one-second recovery-not-before deadline after
   the ambiguous failure, performs the reconciliation HEADs during that
   interval, and waits any remaining time before the recovery PUT. For HTTP
   `500`, that deadline starts only after the first response body drains.

The single ambiguous-outcome recovery accepts only a successful response or
`412`, then the ordinary destination and source HEAD validation runs again. A
second `404`, `500`, `429`, `503`, other HTTP response, redirect, socket or
transport failure, or response-body failure is terminal. A body failure on the
first `500`, failed reconciliation HEAD, missing or changed source, or
conflicting destination is also terminal without a recovery PUT. Every other
first-attempt terminal HTTP response, redirect, socket failure, and
response-body failure keeps its existing terminal one-shot behavior. No PUT is
allowed after the single ambiguous-outcome recovery attempt; when the initial
pre-connect retry was used, this still caps the sequence at three raw fetch
calls while only two could have reached R2.

R2's destination and source CopyObject conditions are not atomic with one
another, so these identity checks cannot be removed:
[conditional CopyObject extensions](https://developers.cloudflare.com/r2/api/s3/extensions/).
After any unresolved outcome, keep copy admission closed, preserve the
destination as quarantine evidence, and never resume, reuse, delete, or promote
it. Rebook the rehearsal or migration with a fresh empty destination after the
failure is understood.

### 5. Complete normally or audit an abnormal stop

On normal production-cutover exit, the command has received the exact drain
confirmation, awaited every bounded worker request, completed all internally
required cycles, and performed coherent final source/destination inventory
validation. That is the source-active copy proof; do not launch a separate
read-only process afterward because its intentionally fresh provenance must
distrust clean destination-only churn from the completed process.

Only if the process crashes or a CopyObject result is ambiguous, wait out the
request bound and run the strict source-active read-only audit:

Run without `--apply`:

```bash
pnpm --dir apps/cloudflare r2:bundles:online-copy -- \
  --source "$SOURCE_BUCKET" \
  --destination "$DESTINATION_BUCKET" \
  --phase source_active
```

In `source_active`, an eligible ENAM object absent from OC blocks promotion.
The online command cannot prune it. Because ENAM is still writer-exclusive,
abandon the destination using separately reviewed destination-only credentials
or investigate the specific ordinary-delete race before rebooking. Never use
this abnormal-stop audit to bless a destination-only object.

### 6. Fence writes, drain OC PUT capability, and finish copying

Pause new workspace writes and direct-PUT ticket issuance. Reads remain
available. Drain current write invocations. Record the last instant at which
any source-active version could issue an OC PUT ticket, then wait the enforced
ten-minute URL lifetime and the conservative ten-minute upload bound. Require
no in-flight write invocation and no new OC direct-PUT issuance or completion
during the final quiet interval.

The source-active apply invocation from step 4 must remain the sole copier
through this drain. When it logs that temporary convergence is waiting for the
OC PUT drain, complete every proof above, then type the exact process prompt:

```text
SOURCE_PUT_DRAINED <source-bucket> <destination-bucket>
```

This is the existing operator drain assertion delivered late to the exact
provenance-bearing process, not a new persistence owner. The command then
re-reads active owners before and after both R2 inventories. If ownership or a
canonical checkpoint changes during those reads, it retries the coherent pair
inside the same invocation. It copies every delayed source delta in another
cycle and exits only after the post-confirmation pair has zero source-only
objects. Revoke the copy credential before promotion.

No CopyObject request may be issued after this point.

### 7. Promote and validate

Deploy the same bridge with:

```text
HOSTED_R2_CUTOVER_PHASE=destination_active
```

Require one Worker version at 100 percent and query every relevant Durable
Object until it reports protocol `r2-oc-enam-v1` and phase
`destination_active`.

While write admission remains fenced, prove:

1. a copied pre-switch snapshot cold-restores;
2. an operator canary writes directly to ENAM;
3. that ENAM checkpoint cold-restores through a fresh current-version runner;
4. ENAM binding PUT/HEAD/GET/delete smokes pass; and
5. source fallback occurs only for an actual ENAM miss.

### 8. Keep post-promotion copy disabled

The online command rejects `--apply --phase destination_active`. An ambiguous
CopyObject could otherwise commit after ordinary dual-bucket garbage
collection and recreate an object that directional convergence cannot
distinguish from a legitimate ENAM-native write. If any eligible OC object is
still source-only after promotion, keep write admission closed and investigate
the violated source-drain or final-pass proof. Do not resume the copier.

### 9. Prove final eligible convergence

Run twice from a clean operator shell:

```bash
pnpm --dir apps/cloudflare r2:bundles:online-copy -- \
  --source "$SOURCE_BUCKET" \
  --destination "$DESTINATION_BUCKET" \
  --phase destination_active \
  --immutable-keys-audited \
  --final-convergence \
  --copier-stopped \
  --source-put-drained
```

The proof is directional: every currently eligible OC object must exist
identically in ENAM. ENAM-only production writes are valid and are not drift.

Only after both reads pass may normal write admission resume. Before that
release, rollback is the source-active phase plus immediate redeploy. Releasing
normal write admission is the forward-only commit point. After release, repair
forward; never return to OC-only reads.

### 10. Re-enable account deletion

Before clearing maintenance, require the deployed deletion path to:

- stop the runner and establish its existing write fence;
- honor the recorded direct-PUT drain watermark;
- require list/delete support on both concrete bindings;
- delete every per-user prefix and fixed key in OC and ENAM;
- observe every prefix and fixed key absent in both buckets;
- delete logical state, alarms, and Durable Object storage last; and
- return success only when all steps complete.

Exercise a deletion race canary that produces a pending `503`, then completes
after the watermark. Exercise an ENAM deletion failure and prove Durable Object
state remains for retry.

### 11. Drain OC lifecycle prefixes and fallback

Continue normal processing of exact raw-email, private-media, and meal-photo
keys. Require all three OC prefixes to become empty under their original
lifecycle. Keep ENAM-to-OC fallback while any legitimate source read remains.

Before removing fallback, require a bounded zero-fallback interval longer than
all supported GET URLs, the 24-hour private-media capability horizon, and
relevant retry/alarm cycles, plus successful cold restores of both pre-switch
and post-switch snapshots.

### 12. Retire OC and remove the bridge

Use a separate reviewed destructive operation. Before deleting OC, prove:

- all live configuration and presign variables name ENAM as authority;
- the runtime is ENAM-only;
- no source-only eligible object remains;
- all three OC lifecycle prefixes are empty;
- no valid OC URL or credential remains;
- account deletion is green against the ENAM-only path; and
- fallback has remained unused for the approved soak.

Then merge one cleanup PR that removes:

- `BUNDLES_ENAM` and phase handling;
- the source fallback;
- pair-scoped runtime credentials;
- the online-copy command and tests;
- the temporary maintenance control;
- this runbook; and
- the old OC bucket only after its final destructive gate.

## Observability and privacy

Runtime structured logs include only:

- current cutover phase and protocol;
- selected direct-PUT bucket role;
- source-fallback operation counts;
- dual-delete partial-failure flags; and
- whether a PUT drain deadline was recorded.

The runner status response exposes the versioned bridge protocol and phase so
operators can enumerate the small member set during both drains. Do not add raw
object keys or member identifiers to migration logs.

## Emergency frozen-window fallback

The existing command remains unchanged:

```text
pnpm --dir apps/cloudflare r2:bundles:migrate
```

It requires `--source-frozen`, exact source/destination parity, and may prune a
writer-exclusive destination. It is not safe against a live source and must
never be used for destination-active convergence. Follow
`R2_BUNDLES_ENAM_MIGRATION.md` only when deliberately abandoning the online
plan and entering its full maintenance fence.
