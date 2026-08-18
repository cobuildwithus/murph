# Deploying The Cloudflare Execution Plane

This document covers the narrow Cloudflare deploy surface for hosted execution.

- `apps/web` remains the canonical owner of hosted product facts and lifecycle state.
- `apps/cloudflare` owns execution coordination, encrypted runtime blobs, the native runner container, and the public/internal execution routes described in [README.md](./README.md).
- Private `cobuildwithus/murph-cloud` owns production/preview GitHub environments, the protected deployment workflow, and rollback operations. Public Murph retains the source, render helpers, and smoke contracts that workflow consumes, but no deploy workflow or production credentials.

## What The Deploy Flow Produces

`pnpm --dir apps/cloudflare deploy:artifacts` renders:

- `apps/cloudflare/.deploy/wrangler.generated.jsonc`
- `apps/cloudflare/.deploy/worker-secrets.json`
- `apps/cloudflare/.deploy/runner-bundle/`

That rendered surface is then used by:

- `pnpm --dir apps/cloudflare r2:lifecycle:apply`
- `pnpm --dir apps/cloudflare deploy:worker`
- `pnpm --dir apps/cloudflare deploy:smoke`

The rendered deploy helper path is the canonical direct Wrangler deploy contract consumed from the private deployment workflow. The checked-in Wrangler scaffold remains useful for local development, but production deploys must run from private Murph Cloud and use the rendered config so hosted email send bindings stay environment-specific and sender-restricted.
`deploy:worker:apply` validates the generated Wrangler config, worker secrets payload, and `.deploy/runner-bundle/` manifest before invoking Wrangler. The runner bundle manifest records the assembled workspace closure and source/bundle fingerprints. Production assembly now builds the runner bundle first and renders those exact fingerprints into the Worker config; applying after a stale hosted-local bundle, a smoke-mutated bundle, or a config rendered for another bundle fails before upload.
The deploy helper also rejects generated config or secrets that no longer match the current environment, and rejects runner bundles assembled with `runner:bundle:assemble-only` so smoke-only build shortcuts cannot be uploaded as production artifacts.
Docker runner smoke derives a separate `.deploy/runner-smoke-bundle/` from the validated production bundle and overlays smoke-only entrypoints there, so the production `.deploy/runner-bundle/` remains the deploy artifact after smoke.
Runner bundle assembly esbuild-bundles two boot-critical surfaces with byte budgets and assembly-time probes: the in-container `vault-cli` binary (`scripts/runner-bundle/bundle-cli.ts`) and the container entrypoint itself (`scripts/runner-bundle/bundle-entrypoint.ts`, output `dist-bundled/`, run by the image CMD). The bundled entrypoint cuts cold-boot module loading from ~960 file reads to ~27 chunk reads on lazily pulled image layers; package resolvers that derive asset paths from their own module location are pinned to the installed package copies via Dockerfile ENV (`MURPH_ASSISTANT_SKILLS_ROOT`, `MURPH_ASSISTANT_CLI_SURFACE_PREBUILT_ARTIFACT_PATH`, `MURPH_HEALTH_COMMONS_PACKAGE_ROOT`). Health Commons stays installed in the runner bundle for its compact protocol and biomarker desired-direction artifacts, while its JS is inlined and assembly probes set the same package-root pin for bundled and unbundled parity. The web-only Health Commons artifact tree remains excluded. Zod stays installed for deferred package-loader paths, but production assembly removes declaration files, TypeScript source, the legacy v3 runtime, and unused mini variants after verifying that staged JavaScript imports only the retained root and v4 surfaces.
The device-sync package boundary suite also walks the static source graph from the runner's runtime-config entrypoint and rejects provider runtime modules, importer modules, and the Junction SDK. This focused gate catches boot-closure ownership regressions before the packed-bundle guard validates the final esbuild metafile.
Hosted assistant delivery recovery now relies on committed side-effect state inside the encrypted workspace and the web-owned hosted workspace checkpoint.

## Browser Vault Shard Rollout

Deploy the Web dual reader first. It advertises fixed `core`, `metrics-index`,
and `labs` demand plus explicit metric-bucket IDs only when the browser supports
gzip decompression, accepts the legacy encrypted monolith, and retries that
legacy transport when an older Web deployment ignores a missing-shard request.
Next deploy the Worker and runner bundle together with
`container_rollout=immediate`; the generation-10 runner rebuilds the replica
while the Worker atomically publishes the legacy monolith, the three fixed
children, and all 32 deterministic metric buckets. Each child independently
uses identity or gzip encoding before encryption, whichever is smaller. Old Web
and old browser clients omit the capability and continue to receive the
monolith.

Do not roll the Worker or runner below this release after the first
generation-10 bucketed ref is written. That write establishes the bucket-aware
Worker and producer as a hard rollback floor: an older cleanup alarm can consume
the sole top-level orphan candidate without deleting its child objects, leaving
those encrypted objects with no durable cleanup owner. The safe recovery is a
forward fix on this Worker/runner bundle or newer. New Web still accepts an
older Worker legacy response during the pre-write deploy window, but sharded
responses always require an exact ref and authenticated child AAD match.

Browser Vault orphan cleanup records only the top-level object candidate. An
older Worker therefore cannot mistake a current child for an orphan. Current
cleanup deletes the deterministic `.core`, `.metrics-index`, `.labs`, and 32
metric-bucket siblings when their noncurrent top-level candidate becomes
eligible. Because an older cleanup implementation cannot later rediscover
those siblings after consuming the candidate, it is not an eligible rollback
after bucketed publication. If an older Web restore is required, first stop
generation-10 replica production, wait for every admitted Browser Vault direct
PUT to drain, and keep the bucket-aware Worker/runner at or above the hard floor
while the Web restore serves the retained legacy monolith. Keep producing that
monolith until the dual-reader Web release has remained the production and
rollback floor for at least 30 days, matching
`HOSTED_APP_SESSION_MAX_AGE_SECONDS` in Web. After that authenticated
open-browser window has drained and rollback artifacts below the reader floor
are retired, a separate release may remove the legacy producer/ref/reader
together.

Browser Vault publication also participates in account-deletion draining. The
UserRunner admits each publication under the exact runtime write fence, all 36
bounded-concurrency object writes settle before that admission is released, and
deletion stops the runner before inspecting the durable admission. If the
publishing request died without releasing it, deletion establishes a 60-second
post-stop drain before its final prefix sweep; this is longer than the Workers
30-second post-disconnect extension window and prevents a late encrypted object
from recreating member data after deletion completes.

## Vault-Share Delivery Contract Rollout

Deploy the Cloudflare Worker and runner bundle first with
`container_rollout=immediate`, and require managed-container smoke to report the
exact new bundle fingerprint before deploying Web's required
`sourceWorkspaceVersion` parser, absolute effect-deadline parser, and conditional
replacement writer. The runner also marks only actual Web responses so a
proxy-local response cannot release publication ownership early. Old Web
ignores the additive runner request fields, so the first phase keeps projection
working; the source-version fence and shared deadline become authoritative only
after Web deploys. Do not deploy Web first: an older runner omits required
delivery fields and its projection fails closed, retaining the existing
device-sync continuation until a compatible runner handles it.

After both deploys, checkpoint one device-sync update with an active share,
confirm the replacement is readable through the ordinary group shared-data
path, and confirm the managed runner fingerprint still matches the deployed
bundle. Once Web requires the field, the compatible runner is the rollback
floor. Roll back Web before the runner only if necessary; otherwise forward-fix
the pair. Do not add a second retry owner or compatibility watermark.

## Generic Group-Email Cutover

The newsletter deletion is a hard public-runtime and private-skill cutover.
Old runners interpret an untagged `group-health-newsletter` record as email, so
they must never claim an automation created or edited by the new ordinary
recipe skill.

Suspend hosted automation wake dispatch before either producer changes and let
in-flight newsletter turns finish. Keep dispatch suspended while deploying the
matching Web receiver, then the Cloudflare Worker and runner with
`container_rollout=immediate`. Prove the exact runner-bundle fingerprint and
record that public artifact as the hard rollback floor before publishing the
private skill bundle or resuming wakes. The private skill must not deploy
earlier. After it is published, rollback below that public floor or to the old
skill is unsupported; use a forward fix.

New outbox and HTTP writes use only generic group-email keys and proof fields.
The current runner retains bounded readers for old persisted parents and
instructions, but no old runner, Worker, or Web parser is part of the supported
window. Remove the readers after legacy recipes are rewritten, legacy parents
and children drain, and the retired mailbox inventory is empty.

## Provider Media-Effect Rollout

The first runner that writes the true-only physical media-owner fact inside a
persisted provider-message effect must deploy with
`container_rollout=immediate`. Require managed-container smoke to report the
exact new runner-bundle fingerprint before admitting image or voice delivery.
There is no Web deployment dependency.

`HostedUserRunner` constructs its state store before creating any invocation,
workspace snapshot, or container service. This release advances that Durable
Object state to runner schema version 16 at construction. A version-15 Worker
rejects version 16 before it can wake a runner or read an encrypted workspace,
so it cannot send a marked record through the legacy strict outbox parser and
quarantine it during idle snapshot maintenance.

Runner schema version 16 is a hard Cloudflare/runner rollback floor after the
deploy reaches a member's Durable Object. Do not roll Worker or runner below
that floor; use a forward fix on version 16 or newer. Production preflight keeps
the immediate-container requirement fail closed, and the existing bundle
fingerprint admission prevents a stale warm runner from becoming the first
writer. After deployment, prove the managed runner fingerprint, send one
image-plus-link and one text-plus-voice response, checkpoint both workspaces,
and confirm Workers Observability contains no outbox quarantine or runner schema
version failures.

## Outbound Message-Volume Receipt Rollout

Deploy the additive Web receipt migration and signed callback route first, then
deploy Cloudflare/runner with `container_rollout=immediate`. Old runners do not
write Telegram/email receipt markers, so a gradual runner rollout would create
an unrecoverable counting gap even though delivery itself remains safe. Keep the
Web table and callback route available until the new managed runner fingerprint
is confirmed everywhere.

This release advances Durable Object runner state to schema version 17 before
creating an invocation, workspace snapshot, or container service. A version-16
Worker rejects version 17 before it can wake a runner or read an encrypted
workspace, so it cannot pass the new strict outbox receipt marker to a legacy
parser and quarantine the intent. Version 17 is a hard Cloudflare/runner
rollback floor after the release reaches a member's Durable Object. Do not roll
Worker or runner below that floor; forward-fix on version 17 or newer. The
additive Web table and callback may remain deployed during a Cloudflare repair.

After deployment, verify the managed runner fingerprint, record one signed
Telegram receipt and one signed email receipt, replay each exact dedupe key, and
confirm the public total increments once per delivery. Check Workers
Observability for receipt callback failures, outbox quarantine, and runner
schema-version rejection. Also confirm an intentionally failed callback leaves
a bounded assistant wake and succeeds after recovery without provider
redispatch.

## Health-Data Consent Stop-Target Rollout

Deploy the Cloudflare Worker that retains an exact user-control stop target
before deploying the Web health-data withdrawal routes, then deploy Web
immediately. No runner-bundle shape changes, but the Worker changes the meaning
of an existing Durable Object row: after write authority is cleared,
`active_runner_container_name` may remain populated until that exact container
is confirmed destroyed. Withdrawal and account deletion both consume this
pending-stop pointer before acknowledging their respective cleanup boundary.

The first-contact shell hint now writes that same exact target before the
container acknowledges registration of its platform-start operation. Deploy
this Worker with `container_rollout=immediate`: an older Worker can have started
a versioned shell without recording its name, so a gradual container drain
cannot prove withdrawal or deletion will find every old hint. Deploy Web first,
then deploy this Worker immediately. The response shape is unchanged, but Web
can now deny an absent or suspended member while reporting a non-revoked
consent state. An older Worker rejects that combination and fails closed; the
new Worker accepts both legacy and fail-closed responses. Do not deploy the new
Worker before Web because the old Web admission owner cannot deny a hint queued
behind account deletion. After the first shell-hint target is reserved, this
Worker is part of the existing hard rollback floor described below.

After the first such pending-stop row is written, this Worker is a hard
Cloudflare rollback floor. An older Worker treats the absent active attempt as
no exact target, derives a container name from its own version, and can erase
the retained pointer during account deletion while the intended newer runner
survives.

The consent-aware Web deployment is also a hard rollback floor after it can
record the first explicit `launch.health-data = revoked` event. Retaining only
the signed callback route is insufficient: webhook admission, scheduled sync,
shared-data reads, messaging, and other Web-owned consumers enforce revocation
inside that Web artifact and do not pass through the Worker callback. After the
consent-aware Web deployment is live, do not roll either plane below its floor.
Forward-fix the compatible Web and Worker pair; do not add a callback-only shim,
dual-read consent state, or a second lifecycle owner.

After deployment, withdraw consent while a runner is active and confirm the
stored target clears only after destruction succeeds. Also exercise one forced
container-destroy retry through account deletion and confirm R2 and Durable
Object deletion remain blocked until the same stored target is destroyed.

## Database Health Alert Rollout

Before deploying the Worker version that introduces
`DatabaseHealthDurableObject`, configure the production GitHub environment:

- var `HOSTED_DATABASE_ALERT_ENABLED=1` (leave it unset outside production);
- vars `HOSTED_DATABASE_ALERT_PLANETSCALE_ORGANIZATION`,
  `HOSTED_DATABASE_ALERT_PLANETSCALE_DATABASE_NAME`,
  `HOSTED_DATABASE_ALERT_PLANETSCALE_BRANCH_NAME`, and
  `HOSTED_DATABASE_ALERT_PLANETSCALE_BRANCH_ID`;
- secrets `HOSTED_DATABASE_ALERT_PLANETSCALE_SERVICE_TOKEN_ID` and
  `HOSTED_DATABASE_ALERT_PLANETSCALE_SERVICE_TOKEN` for a dedicated PlanetScale
  token with only the organization-level `read_metrics_endpoints` permission;
- secrets `HOSTED_DATABASE_ALERT_LINQ_CHAT_ID` and
  `HOSTED_DATABASE_ALERT_LINQ_SECONDARY_CHAT_ID` for two separate existing
  direct operator chats whose sole external recipients are different; and
- the already-required `LINQ_API_TOKEN`.

Deploy Cloudflare only; no Web or database migration is involved. Wrangler
migration `v4` creates the database-health SQLite Durable Object namespace,
migration `v5` creates the independent device-webhook Queue-health namespace,
and the generated config installs the shared five-minute cron. The Queue-health
owner reuses these two operator chats and the Linq token, but it has separate
incident, pending-message, and pacing state and never reads Postgres. After
deployment, confirm one scheduled invocation records healthy database and Queue
observations without a Linq send.
Then use the test-only fake-provider coverage for threshold and delivery proof;
do not induce a production database failure or mutate a real counter for smoke.
Confirm Workers Observability contains no configuration or collection failure
codes. Rollback may leave the unused v4 namespace and samples in place; an older
Worker does not schedule or address it, and no Web compatibility window exists.
After the two-recipient Worker has admitted a pending page, do not roll back to
the former single-recipient implementation: it can clear that page after only
the primary provider operation. The two-recipient Worker is the rollback floor
until alerts are disabled or the pending page has cleared.

## Device-Sync Wake Epoch Rollout

Connection-scoped `device-sync.wake` items bind their authority to the
connection row's `connectedAt` epoch. The runner consumes a wake as superseded
when that epoch is absent or differs from the hydrated connection, without
running its hint or queued jobs. Runtime applies echo the hydrated epoch as
`observedConnectedAt`; Web rejects connection, credential, local-state, and
source writes after OAuth replacement changes that epoch.

When hydration accepts a replacement epoch, the same local SQLite transaction
retires queued, retryable, and leased credential-scoped jobs before exposing the
replacement credentials. The existing companion-HRV resource exception remains
runnable because that accepted payload does not depend on provider
authorization. Web performs the matching dirty-state supersession under its
connection mutation lock.

Deploy Cloudflare and the runner bundle first with
`container_rollout=immediate`, and require managed-container smoke to report the
exact new bundle fingerprint. Then deploy Web so new producers append the
epoch. During the short runner-first window, legacy connection-scoped wakes
still hydrate the current Web snapshot but their hint and jobs fail closed;
keep that window short so later scheduled, manual, or provider wakes from the
new Web producer resume ordinary work. Do not deploy Web first: an old runner
does not enforce the epoch.

After Web emits an epoch-bearing wake, the first epoch-aware runner bundle is a
hard rollback floor while such wakes or in-flight work may remain. Prefer a
forward fix. Retaining the new runner while Web is rolled back is safety
preserving but intentionally fail-closed for legacy connection-scoped hints and
may reject old-Web apply parsing, so restore compatible Web promptly.

## Group Room-Model Rollout

Deploy the first group room-model release as a Cloudflare Worker and runner
bundle update with `container_rollout=immediate`; no Web deployment is required.
Require managed-container smoke to report the exact new runner-bundle
fingerprint before admitting group turns. Existing per-invocation fingerprint
admission prevents a stale warm container from processing a workspace under the
new Worker contract.

Before a new runner persists the immutable group room-model automation id, the
prior runner remains a safe rollback. After the first such write, the new bundle
is a hard rollback floor for that workspace: an older runner does not recognize
the id's silent maintenance policy and could treat its next due occurrence as
an ordinary deliverable automation. Forward-fix on this bundle or newer rather
than restoring an older runner. After rollout, verify the expected bundle
fingerprint and confirm a due room-model occurrence records no group delivery.

## Conversation Consumed-Watermark Rollout

The exact conversation acknowledgement release changes the durable hosted
pending-input file from v1 to cursor-bearing v2. Deploy the Cloudflare Worker
and runner bundle first with `container_rollout=immediate`, require managed
container smoke to report the exact new runner fingerprint, and only then
deploy Web. Old Web ignores the additive checkpoint field, so producer-first
skew is safe.

The first accepted workspace snapshot containing the v2 pending-input envelope
is a hard rollback floor for that workspace because the preceding v1-only
runner cannot read it. Treat the new runner as the production fleet floor before
admitting turns: after traffic begins, forward-fix the runner rather than
rolling it back. Web may roll back independently while the v2-capable runner
stays deployed. Restoring a v1-only runner requires a separate offline workspace
migration that preserves unresolved input IDs and the batch cursor; Web-first
rollback alone is not recovery proof.

After both deploys, verify the managed runner fingerprint, confirm conversation
lane consumed floors converge toward imported prefixes, and run one Telegram
reply across a controlled reload with no duplicate reply or multi-minute stall.

## Shared Message Targeting Rollout

The first release with shared exact-message reply and reaction targeting must
deploy Cloudflare and the runner bundle with `container_rollout=immediate`.
The bundle contains both the strict `nativeReplyRequested` outbox reader and its
writer, so there is no Web deployment order or feature flag. Require
managed-container smoke to report the exact new runner-bundle fingerprint and
prove its assistant CLI surface contract before accepting targeted turns.

Before the first `nativeReplyRequested: true` intent is written, the prior
runner bundle remains a safe rollback. After that write, the new bundle is a
hard rollback floor because an encrypted workspace, checkpoint, or retained
outbox intent may contain the marker. Do not try to prove an incident-time
drain. Forward-fix on that bundle or newer; do not restore an older runner or
add a dual writer.

After convergence, verify one unselected Linq or Telegram automatic model reply
remains flat, one selected reply with `---` keeps the same native target on
every bubble, and one reaction reaches its selected accepted message. Confirm
no strict outbox parse failures or stale runner fingerprints appear in Workers
Observability.

## Native iMessage Response-Card Rollout

Deploy the first native response-card release as one Cloudflare Worker and
runner bundle update with `container_rollout=immediate`. Before allowing card
traffic, require managed-container smoke to report the exact new runner-bundle
fingerprint and prove the updated assistant CLI surface.

Treat backward compatibility as a permanent traffic gate for every iMessage
app card. Linq capability is not decoder-version negotiation, so a new schema,
discriminator, required field, stricter bound, or changed meaning must not emit
while any previously released extension that can claim the card would reject
it. App Store availability of a new reader does not retire older installed
readers. Before enabling traffic, prove either that unknown clients receive the
last readable envelope, that an explicit capability selects a compatible
envelope, or that every earlier claiming extension already provides a complete
non-interactive recovery for the unknown shape. Otherwise keep the producer on
the prior schema or deterministic ordinary text. TestFlight, App Review,
provider acceptance, delivery receipts, and proof on only the new build do not
satisfy this gate.

An expansion of an existing strict card version has a reader floor even when
its discriminator is unchanged. For the V4 workout expansion above eight
exercises or eight sets per exercise, release the native reader first, deploy
the shared Web parser/static image route second, then deploy the Worker and
runner together with `container_rollout=immediate`. Before expanded authoring,
require the exact runner fingerprint and a successful fetch of an expanded V4
static image from the deployed Web artifact. Keep that Web version available
while any expanded immutable image URL can still be fetched.

Ordinary outbox records and hosted delivery side effects omit the optional
`card` field. A new Worker with an old runner is therefore safe for ordinary
work, although that runner cannot produce cards. The inverse is unsafe after a
new runner writes or emits a card-bearing record or side effect: do not pair
that state with an old Worker.

The prior bundle remains a safe rollback only before the first card-bearing
value exists. After that point, the new bundle is the hard rollback floor for
workspaces, checkpoints, retained outbox intents, and side effects. Forward-fix
on that bundle or newer rather than restoring an older reader.

For the within-V4 bound expansion, the prior Web and runner bundles remain safe
only before the first expanded V4 card is sent or persisted. After that point,
do not roll either reader below the expanded bound. Forward-fix, and if an old
local runner already quarantined an expanded intent, explicitly restore that
intent only after the compatible bundle is live. Monitor for
`outbox.intent.quarantined`, strict response-card parse failures, stale runner
fingerprints, and failed expanded static-image fetches.

## Exercise Routine Response-Card Rollout

The `exercise_routine` discriminator extends the strict assistant outbox card
union. Deploy the Cloudflare Worker operation allowlist before the new runner can
emit `sendRichMessage`, then use `container_rollout=immediate`. An older Worker
returns a non-Telegram policy response. The new runner treats that result as
terminal ambiguity and does not send text fallback. Before routine traffic,
require managed-container smoke to report the exact new runner-bundle fingerprint.

The prior runner remains safe only before the first routine-card outbox intent
is written. After that write, the new runner bundle is a hard rollback floor for
that workspace because an older strict reader can quarantine the retained
intent. Forward-fix on this bundle or newer. Monitor Workers Observability for
`outbox.intent.quarantined`, strict outbox parse failures, and stale runner
fingerprints after rollout.

## Model-Authored Telegram Rich-Content Rollout

The `telegram_rich_content` discriminator extends the same strict assistant
outbox card union. The Worker already allows `sendRichMessage`, so this release
needs no new provider operation or Worker egress rule. Deploy the new runner
bundle with `container_rollout=immediate`, and require managed-container smoke
to report its exact fingerprint before the model can attach this card.

The prior runner remains safe only before the first rich-content card intent is
written. After that write, the new runner bundle is a hard rollback floor for
that workspace because an older strict reader can quarantine the retained
intent. Forward-fix on this bundle or newer. Monitor `outbox.intent.quarantined`,
strict outbox parse failures, and stale runner fingerprints after rollout.

## Telegram Group Presentation-Card Audience Rollout

This release expands the strict audience rule for the existing
`exercise_routine` and `telegram_rich_content` card kinds. Deploy the runner
bundle with `container_rollout=immediate`. Before group-card authoring is
considered converged, require managed-container smoke to report the exact new
runner-bundle fingerprint.

The preceding runner remains a safe rollback only before the first Telegram
group presentation-card intent or hosted effect is persisted. After that write,
the audience-capable bundle is the hard rollback floor. The preceding strict
readers reject the non-direct card, and an old outbox reader can move a retained
intent into quarantine. Forward-fix on the compatible bundle or newer.

After rollout, monitor `outbox.intent.quarantined`, strict response-card parse
failures, and stale runner fingerprints. Restore a quarantined intent only after
the compatible bundle is live, then confirm that the restored card reaches the
same authenticated Telegram group.

Telegram daily-nutrition Rich Messages reuse the existing queryless response-
card image route. Keep that Web route available while sent Telegram or Linq
cards can still fetch their immutable image.

## Private Completion Continuity Rollout

Deploy Web first, then deploy the Cloudflare Worker and runner bundle together
with `container_rollout=immediate`. Only authenticated private-completion
intents write the new strict outbox continuity fields; generic notifications
remain compatible. An old runner cannot parse a retained new-format private
intent, so the first such write is the rollback floor for that workspace.
Forward-fix on this bundle or newer after the floor is crossed.

Recent production evidence showed six total Assistant Ask completion mailbox
items—an upper bound on private completions—and no matching private-completion
or outbox-quarantine runtime-log events over 14 days. Recent successful
protected deploy workflows completed in 8–13 minutes;
immediate rollout makes that one workflow the expected compatibility window.
Require managed-container smoke to report the new runner fingerprint, monitor
`outbox.intent.quarantined` and strict outbox parse failures, then verify one
same-channel private completion is delivered exactly once, never to the group,
and is visible before the next ordinary direct turn, whether that consumer is
an attended member turn, an exact-session scheduled occurrence, or an
exact-session Assistant Ask continuation, and before a direct exact notification
can append newer ordinary-session history.

## Audience-Key Rollout

The first production deploy that can write assistant conversation keys with an
`audience:` segment must use `container_rollout=immediate`. Require the normal
managed-container smoke to report the new runner-bundle fingerprint before
processing user turns. New code can read and retire the legacy key format, but
an old runner cannot read audience-scoped keys and can recreate one shared
legacy session for direct and group traffic.

After the first audience-scoped key is written, the fingerprinted runner bundle
is a hard rollback floor: do not deploy or restore an older runner. The safe
rollback is a forward fix on that bundle or newer. Keep immediate rollout until
the fleet has converged, then remove the compatibility reader only after every
assistant index contains zero live conversation keys without an `audience:`
segment.

## Shutdown Checkpoint Handoff Rollout

Roll out the single-snapshot shutdown handoff in this order:

1. Deploy the Cloudflare Worker and runner bundle with
   `container_rollout=immediate`, then require managed-container smoke to report
   the new bundle fingerprint.
2. Deploy `apps/web` only after the runner fleet has converged.

The intermediate state is safe: the new runner still understands an old web
deployment's `foreground_pending` checkpoint response, and its payload-free
owner-release callback may receive a non-success response from old web without
changing completed work or retrying. After web deploys, a valid checkpoint may
return `conversationInputAhead` instead; a live default-mode runtime imports it,
while retention-only work or shutdown leaves it to durable mailbox/Temporal
reconciliation. An old
runner ignores the additive field, and durable mailbox lag plus the existing
owner horizon still recover the input; its old post-upload wake path may retain
the extra-snapshot latency until the runner converges. Both mixed-version states
are correctness-compatible, so either side may be rolled back independently
during this compatibility window. The recommended order minimizes exposure to
the old latency path.

The same producer-first order applies to the positive
`immediateRecheckRequested` owner-release edge. New Cloudflare code signs its
exact query and lets it override only the normal future-continuation callback
skip; old runners simply omit the edge and fall back to the owner horizon. Web
must not deploy the due-wake level-trigger removal before the new producer is
available. Roll back Web before Cloudflare/runner if the pair must be reverted.

After both deploys, confirm there is no extra metadata-only handoff checkpoint
for the same shutdown and actionable late input causes the existing Temporal
recheck after owner release.

## Assistant Ask Deployment

Assistant Ask adds paired mailbox kinds and a one-shot process inside the
existing runner container. It adds no Cloudflare binding, secret, Durable
Object state, second container, scheduler, or workflow. Web always produces
otherwise-authorized requests, so an old runner that cannot parse the mailbox
kinds is no longer a supported deployment target. The first compatible runner
bundle is the rollback floor while an Ask request or completion can remain in a
mailbox or restored workspace. Roll below it only after at least the full
ten-minute request lifetime and proof that pending Ask work has drained or
expired; prefer a forward fix if any imported item may remain.

For changes to the consumer contract, deploy the Worker and runner bundle with
`container_rollout=immediate`. Managed-container smoke must report the expected
runner-bundle fingerprint and prove the `murph-group-read` profile can read the
intended committed group context while writes, `.runtime/**`, `.codex/**`,
environment files, other roots, inherited shell secrets, and tool network fail
closed. Smoke one private-to-group ask while the group runtime is idle and one
while its foreground Murph is replying; neither may create group-visible
activity or delay the foreground reply.

The Ask admission advisory-lock correction is Web-only and does not require a
Cloudflare deploy. The optional failed-request correlation headers are additive:
old runners ignore them safely, while the runner bundle that surfaces its
bounded request id, allowlisted Prisma diagnostic code, and HTTP status requires
a Cloudflare deploy. Deploy
that diagnostic consumer with `container_rollout=immediate`, prove the new
runner-bundle fingerprint, then deploy Web so every newly failing Ask can return
the correlation metadata immediately. Either mixed version remains functionally
safe because Web does not require the runner to consume the header.

## Phone-Call Result Deployment

A completed phone call delivers its result as a proactive
`assistant.notification.requested` message: Murph composes the result in its own
voice and must send every terminal success, failure, needs-user, and
not-completed outcome. A provider-less start without a stop fence publishes a
required not-completed result; when a stop fence already owns that provider-less
settlement, its independently deduped stop-settlement result is sufficient. A
safety-rejected provider call instead publishes a required `needs_user` result:
the call is no longer active, but its real-world outcome could not be safely
verified, so the member should confirm before repeating the request. Foreground
or workflow cleanup appends and signals that deterministic ordinary result
before terminal cleanup; notification failure leaves the row retryable. The
authenticated direct Linq or Telegram origin is
stored on the call row and resolved again at delivery; group calls continue to
use their existing thread-container route. A missing or revoked persisted route
keeps delivery retryable instead of falling back to another channel. This reuses
the existing notification wake path, so no new mailbox kind or runtime consumer
is introduced.

Apply the additive nullable `HostedPhoneCall.result_notification_channel`,
result-delivery state, and `HostedPhoneCall.stop_requested_at` migrations first.
Deploy Web next so it can accept, persist, resolve, reconcile, and notify those
fields. Finally deploy the
Cloudflare Worker and runner with `container_rollout=immediate` to expose status,
exact-stop, and result-channel-bound starts. New Web rejects channel-less new direct
starts from an old warm runner, while group starts and idempotent replay of an
existing legacy direct row remain compatible. Direct starts therefore fail
retryably during the Web-first window; keep that window short, replace warm
runners immediately, prove the new bundle fingerprint, and then run one Linq
and one Telegram direct-call canary. A runner-first window also fails closed
because old Web rejects the new strict start field.

The stop endpoint only records durable intent and wakes the reconciliation
workflow. That workflow alone owns Retell retrieve/stop and publishes a required
idempotent `phone-call-result:${callId}:stop-settled` notification when the call
is no longer active or no provider call exists. Its step timeout must remain
larger than Retell's four possible serial 15-second request budgets—provider
list, stop-status retrieve, conditional stop, and terminal-usage retrieve—plus
database, notification, and wake settlement time. The current budget is 90
seconds.

Once any non-null stop fence is written, compatible Web is a hard rollback
floor. A safe rollback below it requires disabling phone-call start, status, and
stop capabilities, immediately recycling or draining warm runners, and
retaining the compatible Web/reconciliation deployment until there are zero
unsettled stop fences and every settled fence has its deterministic settlement
mailbox item. After producer disablement and warm-runner drain, require this
read-only rollback check to return zero before restoring Web that would use
default-route fallback:

```sql
SELECT count(*) AS unresolved_result_bound_phone_calls
FROM hosted_phone_call AS call
WHERE call.result_notification_channel IS NOT NULL
  AND (
    (
      call.result_notification_channel = 'linq'
      AND NOT EXISTS (
        SELECT 1
        FROM hosted_mailbox_item AS item
        WHERE item.user_id = call.member_id
          AND item.dedupe_key =
            'assistant.notification.requested:phone-call-result:' || call.id
      )
    )
    OR (
      call.result_notification_channel = 'telegram'
      AND (
        call.result_delivery_status IS NULL
        OR call.result_delivery_status NOT IN ('delivered', 'ambiguous')
      )
    )
  );
```

Do not narrow this proof to active or analyzed rows. In particular, an ended
call with delayed analysis remains a rollback blocker because provider analysis
has no finite SLA. Materialize every ordinary deterministic result item under
compatible Web or use a forward fix. Keep the nullable columns; do not drop them
during rollback.

Direct Linq scheduled phone-call availability is an additive Web-first rollout.
Deploy Web so it recognizes the reserved scheduled-occurrence request-key
namespace, then deploy the Cloudflare runner bundle with
`container_rollout=immediate` so a warm old runner cannot consume a due
occurrence without exposing the phone tool.
There is no database migration or new wire field. A new runner against old Web
can place the first call, but a resident-session retry fails closed instead of
reconciling; brief drift still reuses the same occurrence key and cannot create
a second call. New Web remains compatible with old runners and attended calls.
After deploy, require the exact runner-bundle fingerprint and run one consented
private Linq scheduled-call canary that proves a single Web call row and
successful same-occurrence replay. A missed pre-deploy occurrence is rescheduled
explicitly; do not add replay or backfill machinery.

Scheduled email, Telegram, and group turns do not expose the phone tool. Direct
attended Linq and Telegram calls are origin-bound; scheduled calls remain direct
Linq only.

## Consented Group Disclosure Rollout

The group-to-member adapter reuses Assistant Ask and adds no Cloudflare binding,
secret, Durable Object state, scheduler, workflow, second container, or producer
flag. The first compatible runner bundle is the rollback floor while a consented
request or completion can remain in a Web mailbox, imported local pending item,
or committed workspace snapshot. Roll below that floor only after the full
ten-minute request lifetime has elapsed and pending work has drained or expired;
prefer a forward fix if an imported item may remain. Do not delete permission or
grant rows during rollback: they remain member-managed product truth and cannot
erase already shared answers.

After deployment, require managed-container smoke to report the new runner
bundle fingerprint and preserve the existing `murph-group-read` confinement
proof. Verify the outgoing reviewer starts with an empty runtime root and no
personal workspace, application tools, delivery route, inherited secrets, or
network. Smoke one exact permission-message Like by a current member, one
allowed ask whose bytes reach the originating group unchanged, one
out-of-permission denial, and one revoke followed by a rejected ask.

## Linq Participant-Context Rollout

The participant-addition hint uses an additive database column, an additive
conversation-wake field, and an optional field in the existing tolerant
mailbox-to-input sidecar. Roll it out in this order to preserve the one-shot
context through the mixed-version window:

1. Deploy the Cloudflare Worker and runner bundle with
   `container_rollout=immediate`, then require managed-container smoke to report
   the new runner-bundle fingerprint.
2. Apply the hosted-web database migration.
3. Deploy `apps/web` only after the runner fleet has converged.

Both mixed-version states remain correctness-compatible. New runners accept an
old web payload with no hint. Old runners ignore the optional sidecar field and
continue processing ordinary messages, but cannot render that one context hint
after a new web producer consumes it. Runner-first deployment avoids that
feature-only loss. Either side may otherwise roll back independently because
the strict persisted assistant-input schema is unchanged.

## Linq Affirmative-Reaction Rollout

The affirmative-reaction adapter transfers target authorship from a live Linq
message read to an optional wake marker plus exact same-route sent-outbox
attestation in the runner. Old Web with a marker-aware runner is safe; new Web
with an old runner is unsafe because the old tolerant parser drops the marker
and imports the synthetic reaction description as an ordinary message.

Roll out the first marker-aware release in this order:

1. Deploy the Cloudflare Worker and runner bundle with
   `container_rollout=immediate`. Require the predeploy parser/importer tests
   for that exact commit and managed-container smoke reporting its runner-bundle
   fingerprint before processing the new wake shape.
2. Deploy `apps/web` only after the runner fleet has converged.
3. Smoke an affirmative reaction to an exact Murph delivery in both a private
   and group chat, then verify that a reaction to a participant-authored target
   is terminally suppressed before model execution.

Once Web can emit a synthetic affirmative-reaction wake, that marker-aware
runner bundle is a rollback floor while any such mailbox item or imported input
can remain. Do not independently restore an older runner; roll Web back first,
prove no synthetic reaction work remains, and otherwise use a forward fix on
the marker-aware bundle or newer. Existing runner fingerprint admission rejects
stale warm containers, but it does not make an old deployed parser compatible.

## Linq Provider-Claim Protocol

Every Linq provider entry uses one Web-owned authorization and atomic dispatch
claim immediately before the provider request. A separate authority-only
preflight is limited to proactive home-route fallback and approved vault-file
delivery, where Web may resolve or validate the concrete target before media
work. Anchored replies, reactions, and voice memos do not make that redundant
round trip.

Every engagement request must state `authorityCheckOnly` explicitly. `true`
performs only the bounded preflight and never claims provider dispatch. `false`
is the final provider boundary, requires an explicit idempotency key, and must
return the additive `providerDispatchClaimed` marker before the runner enters
the provider. Web no longer derives authority or provider-dispatch identity
from the retired `currentInbound` request proof.

The Cloudflare Worker and runner rollback floor for this protocol is #627 or
newer. Do not deploy or restore an older runner after the Web hard cut; there is
no supported old-runner/new-Web compatibility window. Immediate rollout is not
required for ordinary later deploys because current runners already use this
shape and per-invocation fingerprint admission replaces stale warm shells.
After deployment, smoke one authority-only current-home resolution, one final
provider claim, and one Linq group-thread turn, then confirm the thread
container owns model execution and provider delivery.

New runners may send an optional `lineLookupKey` solely for post-send
line-health attribution; old Web ignores it, and new Web retains its existing
fallback when an older supported runner omits it.

### Canonical Linq Send-Route Rollout

Deploy Web first with the complete ephemeral `resolvedRoute` response while it
continues returning the deprecated `threadIsDirect` and conditional
`targetOverride` fields. The existing runtime ignores the additive route and
continues using the legacy fields, so this short reader-first window preserves
ordinary delivery. Then deploy Cloudflare and the runner bundle immediately
with `container_rollout=immediate`; the new runtime requires `resolvedRoute`,
uses it as the sole provider target/recipient/sender/directness source, and
reasserts the exact value before capability lookup and provider dispatch.

Do not deploy the new runtime before Web. It intentionally fails closed when
the canonical route is absent. If rollback is required during the compatibility
window, roll Cloudflare back first and Web second. Keep the legacy Web fields
until a later independently reviewed cleanup after the old runtime is outside
the rollback window; no database migration or persisted runtime-state floor is
introduced by this protocol.

After rollout, prove one authorized private scheduled native card, one ordinary
direct reply, one group reply, and one private Assistant Ask continuation.
Confirm no canonical-route protocol-unavailable or route-mismatch error appears
for those controlled sends.

## Group Usage Projection Privacy and Monthly Sponsorship Rollout

The current group-tool `read_usage` response is
`{fundingNeeded,fundingUrl,includedUsageUsedPercent}`. The parser requires and
preserves the bounded included-usage aggregate on that current successful shape
and remains strict about unknown or private fields. It rejects the newer
funding-only shape instead of retaining a field-specific rollout compatibility
path. The existing sponsorship-era response branches remain legacy-facing only.

1. Deploy the Cloudflare Worker and runner bundle first with
   `container_rollout=immediate`. Require managed-container smoke to report the
   new bundle fingerprint and drain older warm runners. The compatible runtime
   accepts the current response, strips the immediately preceding optional
   `sponsorshipStatus` field, and still accepts
   the older `{capacityState,fundingUrl,periodEnd,remainingPercent?}` response.
   It derives only whether funding is needed from that oldest shape and
   discards period, percentage, and funding-setup fields.
2. Apply the additive capped-sponsorship migration, then deploy the compatible
   Web release. Confirm both the migration and new Web have converged before
   enabling monthly authorization creation or automatic refill admission.
3. Smoke group reads with and without an active automatic sponsor and confirm
   the runtime learns only funding urgency, the first-party capability, and the
   bounded included-usage aggregate. Funding setup and other quantitative
   fields must not reappear.

The `includedUsageUsedPercent` producer, strict reader, and assistant policy
ship as one product change. There is no strip-only reader phase or rollout-only
feature flag. A mixed-version Web/runner window may temporarily make the strict
read fail; that availability tradeoff is accepted. Deploy Web and Cloudflare as
close together as practical, require managed-container smoke to prove the new
runner fingerprint, then run a controlled explicit group usage-status question.
Roll back both sides to a schema-compatible pair if rollback is required.

The first monthly authorization is the old-Web rollback floor. The preceding
Web reconciliation code cannot activate that authorization, so after the first
one is created, do not restore the old Web producer and do not roll
Cloudflare/runner below the dual-reader bundle. Recover with a forward fix on
that schema and compatible Web/runtime bundle. Before the first authorization,
Web may be rolled back only while monthly creation and refill admission remain
disabled and the additive schema is retained.

The legacy-shape reader branches exist only for their bounded cutover windows.
Remove them after
old Web is neither routable nor rollback-eligible, all pre-reader warm runners
have drained, and production evidence shows no preceding-shape responses. This
is a narrow read-side seam, not a permanent rollout framework, and it must never
restore legacy remaining percentages, period boundaries, or other quantitative
accounting to runtime or assistant policy outside the reviewed included-usage
aggregate.

The current projection separates urgency from capability: `fundingNeeded`
controls assistant-initiated depletion messaging, while a non-null `fundingUrl`
may be used after an explicit funding request at any capacity. Deploy the
Cloudflare runner bundle first, then Web: the new runtime safely strips the old
producer's sponsorship field, while an old runtime rejects the new reduced
shape. After both deployments, smoke a low room with automatic refill headroom
or a pending refill and confirm Murph does not start a funding thread. Include
an already-bound current-period payment on a paused authorization. Then
smoke a low room with no automatic recovery and confirm Murph gives the ordinary
link-free warning without payment-setup, payer, cap, amount, balance, or refill
detail. Exhaust a room in each funding setup and confirm both receive the same
deterministic neutral pause contract plus the first-party link, with no
immediate-restoration promise or payer pressure. Opening the link must still
preserve the single-automatic-sponsor invariant and show the payment options
appropriate to the authenticated payer. Also smoke an explicit funding request
in a healthy room and confirm Murph returns the first-party link without
claiming the room needs funding. Finally, make mandatory-link projection fail
before a denied-gate attempt, confirm no Linq or Telegram claim/provider send is
made with linkless copy, restore the projection, and confirm the same capacity
epoch sends the validated linked notice.

## Thread Usage Crossing Notice Rollout

The assistant runtime usage-record request has an additive, optional Linq group
delivery target. Deploy the Cloudflare Worker and runner bundle first with
`container_rollout=immediate`, then require managed-container smoke to report
the new bundle fingerprint before deploying `apps/web`. An old web deployment
ignores the additive target and keeps the next-inbound thread notice. A new web
deployment receiving an old or ambiguous request refuses personal-home fallback
for `thread_usage_limit_reached`, so the opposite skew is also safe but may
defer the notice until the next inbound.

After both deploys, send one group-thread turn that crosses a test allowance and
confirm the neutral thread notice replies in that same thread, the usage period
is claimed once, and no `home_route_missing` crossing warning is emitted.

## Usage-Notice Provider-Claim Rollout

Denied Telegram and email replies use versioned Worker routes plus a
signed provider-entry callback to Web. Keep the feature-level Web-first order:

1. Deploy `apps/web`. Until the Worker deploys, the new versioned control route
   returns not-found before provider dispatch and the prepared event claim
   remains retryable.
2. Deploy the Cloudflare Worker. It must persist the exact prepared-attempt
   fence through the signed Web callback immediately before the provider fetch
   or email binding send, and abort provider delivery when that callback fails.

The opposite mixed version is also correctness-safe: an old Web deployment
uses the removed legacy route, and the new Worker rejects it before provider
dispatch. Both mixed states can delay a deterministic denied reply, but neither
can silently send without the matching fence or blindly retry an ambiguous
provider call. After both deploys, exercise one denied reply on each enabled
channel and confirm the prepared row advances at provider entry.

## One-Time Cloudflare Setup

Before the first deploy:

1. Create the Worker service and the canonical runtime and preview R2 buckets.
2. Apply `apps/cloudflare/r2-bundles-lifecycle.json` to the real bundles buckets, or run the normal worker deploy path, which reapplies it before deploying the Worker.
3. Decide the public Worker URL, either `*.workers.dev` or a custom domain.

The rendered and checked-in Wrangler configs both declare the code-owned
`HOSTED_RUNTIME_RETRY_ANALYTICS` Analytics Engine binding and
`murph_hosted_runtime_retries` dataset. Analytics Engine creates the dataset on
its first write, so this binding adds no GitHub environment variable, secret,
or separate private-workflow mapping.

The checked-in lifecycle file contains four narrow backstops. Raw hosted-email blobs and their encrypted recovery refs under `hosted-email/messages/` become deletion-eligible after 24 hours. Application-encrypted Linq avatar-ingress objects under `hosted-private-media/images/` also become deletion-eligible after 24 hours. Retries reuse the deterministic object and cap capability expiry at that object's original lifecycle boundary; at or after the boundary, the mutation-locked `UserRunner` replaces the same deterministic key before returning another bounded capability. Application-encrypted Environment voice recordings under `hosted-environment-voice/audio/` become deletion-eligible after 24 hours; successful processing deletes them immediately after the updated vault checkpoint. Account deletion synchronously deletes each member prefix. Encrypted automatic meal-photo staging under `hosted-meal-photos/images/` becomes deletion-eligible after 31 days, one day beyond canonical mailbox recovery retention; successful imports still delete those objects immediately after checkpoint. R2 deletes eligible objects asynchronously. The rest of the encrypted objects in `BUNDLES` remain owner-cleaned or durable by design.

## Required GitHub Environment Vars

Set these in the selected GitHub environment as vars:

- `CF_WORKER_NAME`
- `CF_BUNDLES_BUCKET`
- `CF_BUNDLES_PREVIEW_BUCKET`
- `CF_PUBLIC_BASE_URL`
- `HOSTED_WEB_BASE_URL`
- `HOSTED_WEB_PRODUCTION_BASE_URL`
- `HOSTED_EXECUTION_VERCEL_OIDC_TEAM_SLUG`
- `HOSTED_EXECUTION_VERCEL_OIDC_PROJECT_NAME`
- `HOSTED_DATABASE_ALERT_ENABLED=1` (production only; it must be unset for
  preview and development)
- `HOSTED_DATABASE_ALERT_PLANETSCALE_BRANCH_ID`
- `HOSTED_DATABASE_ALERT_PLANETSCALE_BRANCH_NAME`
- `HOSTED_DATABASE_ALERT_PLANETSCALE_DATABASE_NAME`
- `HOSTED_DATABASE_ALERT_PLANETSCALE_ORGANIZATION`
- `HOSTED_R2_PRESIGN_ACCOUNT_ID`
- `HOSTED_R2_PRESIGN_BUCKET_NAME`

`MURPH_ANDROID_APP_ENABLED` is an optional, fail-closed rollout variable. Leave
it unset until the public Android app and the compatible Web, Worker, and runner
code are deployed. Private `cobuildwithus/murph-cloud` must map the raw value in
`.github/workflows/deploy-cloudflare-hosted.yml`, on the existing
`Prepare deploy artifacts` step's `env`, from
`${{ vars.MURPH_ANDROID_APP_ENABLED }}` after the `deploy` job selects the
`preview` or `production` GitHub Environment name from its workflow input. A
job-level `env` mapping is invalid because selected Environment variables are
available only after the job starts.
`production` is the current protected environment, while the absent preview
value stays fail-closed. Adding either Environment value is inert until this
private mapping has landed.

To activate, set the exact value `1` in both the matching Vercel Web environment
and the selected Cloudflare `preview` or `production` GitHub Environment. Deploy
Web, then deploy Cloudflare with `container_rollout=immediate`. Confirm that the
generated Wrangler config and deployed Worker binding contain canonical `1`,
the new runner fingerprint is active, and a direct-assistant turn includes the
Android Play guidance before checking the Connect Devices card. Disable by
clearing both values and redeploying both sides; confirm that the generated
Wrangler config, deployed binding, assistant guidance, and card no longer expose
the Android journey. A missing value—or any value other than exact `1`—keeps it
hidden.

`CF_PUBLIC_BASE_URL` is a required non-secret Worker variable as well as the standard deploy-and-smoke target. Private-media capability creation uses that exact deployment origin, and hosted Web validates capabilities against its matching `HOSTED_EXECUTION_CONTROL_URL` origin. Production preflight pins both sides to `https://murph-hosted.cobuildwithus.workers.dev`; preview uses its isolated staging Worker origin and must reject production-origin capabilities. Change the production pin and deploy invariant together before moving the production origin. Runner internal-host requests use Cloudflare Container outbound interception instead of a public Worker callback route.
`HOSTED_R2_PRESIGN_ACCOUNT_ID` must match `CLOUDFLARE_ACCOUNT_ID`, and `HOSTED_R2_PRESIGN_BUCKET_NAME` must match `CF_BUNDLES_BUCKET`; direct-R2 workspace snapshots upload and restore through presigned URLs and are verified through the canonical Worker R2 binding. Deploy preflight requires the canonical runtime and preview buckets to be ENAM Standard. Local S3-compatible endpoint flags are hosted-local only and must not be set for deploys.

For the one-time single-region retirement release, update
`CF_BUNDLES_BUCKET`, `CF_BUNDLES_PREVIEW_BUCKET`, and
`HOSTED_R2_PRESIGN_BUCKET_NAME` to their existing ENAM bucket names as one
candidate-deploy operation. Changing GitHub Environment values does not mutate
the already deployed Worker, so do not run an older phase/fallback deploy after
that change. Keep the Web account-deletion maintenance guard enabled. Deploy
Cloudflare first and require 100 percent rollout, the ordinary direct-R2 and
runtime smokes, and an API check proving that the live Worker has only the
canonical `BUNDLES` R2 binding. Then rerun the final current-owner check, empty
and delete only the exact retired production and preview OC buckets, and verify
that both bucket APIs report them absent. Only after physical absence is proven
may the post-retirement Web cleanup remove the maintenance guard. The former OC
buckets are not Worker bindings or rollback targets.
For production deploys, `HOSTED_WEB_BASE_URL` must exactly match the normalized
origin in `HOSTED_WEB_PRODUCTION_BASE_URL`; production preflight also rejects
HTTP, localhost, `host.docker.internal`, loopback, preview/development, and
private-network Worker and hosted web origins, including DNS names
that resolve to private-network addresses. When
`DEVICE_SYNC_PUBLIC_BASE_URL` is set, it may include a callback path but its
hostname must match `HOSTED_WEB_BASE_URL`; a separate callback host cannot
receive the host-only hosted app-session and callback-proof cookies. Cloudflare
preflight owns this explicit-override comparison only. When the override is
unset, hosted Web build validation derives the effective callback from
`HOSTED_ONBOARDING_PUBLIC_BASE_URL`, `HOSTED_WEB_BASE_URL`, then the Vercel
production fallback and rejects a split host; Cloudflare does not claim to
derive that Web-owned value.
The single member-scoped computer-use profile change is a greenfield hard cut,
not an old-Web/old-Worker compatibility rollout. Keep hosted computer-use
traffic paused during the Web/Worker skew window and finish the Worker deploy
immediately after the hosted web deploy.
Normal deploy smoke targets the public Worker banner and health endpoints after deploy, then runs managed-container smoke for both gradual and immediate rollouts: `deploy:smoke` signs `/internal/deploy/container-smoke`, starts the Cloudflare-managed runner container, verifies the deployed assistant CLI surface contract still includes detailed hot-path schemas for onboarding saves and device setup, and compares the reported runner-bundle fingerprint with the freshly rendered `.deploy/runner-bundle` manifest. When the workflow runs with `container_rollout=immediate`, managed-container smoke also runs the direct-R2 upload check.

The Worker also enforces that fingerprint contract on the normal user path. Before a warm or newly started runner receives a workspace invocation, its `/health` response must report the bundle and source fingerprints embedded in the generated Worker config. A stale warm shell is destroyed and restarted; a cold shell that still mismatches fails closed without receiving user work. Post-deploy smoke remains the rollout proof, while per-invocation admission prevents the window between a direct Worker deploy and that smoke from serving work through an old runner.

The production smoke also runs one real `gpt-5.6-terra` model turn inside the deployed runner container (`HOSTED_EXECUTION_SMOKE_LIVE_MODEL_TURN=true`, set by the deploy workflow's `live_model_turn` input, default on). The container runs a single non-interactive `codex exec` in a scratch workspace with the injected-credential placeholder; the Worker egress intercept authorizes exactly one deploy-smoke fenced `POST /v1/responses` request for `gpt-5.6-terra` and injects the real Worker-owned `OPENAI_API_KEY`, so the smoke proves the rollout target's OpenAI auth, account availability, quota, request compatibility, and network path without the raw key ever entering the container. The container accepts the smoke only when Codex JSONL reports the final agent output as exactly `OK`. Cost posture: exactly one bounded model turn per production deploy; the flag is never set in per-PR CI or hosted-local E2E, so those paths are byte-for-byte unchanged.

## Venice Provider Activation

Venice is an optional core-inference provider, not a replacement for the fleet
default or specialized tool providers. Configure the selected GitHub
Environment with this secret:

- secret `VENICE_API_KEY`

The Worker derives the regular Venice Luna/Terra/Sol provider ids from one
code-owned mapping; do not add model vars. Keep the hosted Web
`HOSTED_VENICE_ENABLED` flag off while applying the nullable member migration
and deploying the compatible Web reader. Then deploy Cloudflare and the runner
with `container_rollout=immediate` and require the exact runner fingerprint.
Before Web enables the flag, use that exact candidate bundle to exercise Luna,
Terra, and Sol through Venice. For each tier, prove a direct streamed reply, a
tool-bearing turn, and a compact request through the Worker intercept without
exposing the key to the container. Confirm completed streams and usage
snapshots identify `venice` plus the expected code-owned provider model. A
static translation test or one successful tier is not sufficient activation
proof.

The candidate must also pass a capped prompt-cache canary before Web exposure.
Drive two sequential Sol `/responses` turns within five minutes through the
exact candidate bundle's pinned Codex App Server and one resumed synthetic
thread; do not hand-author ordinary Responses requests. The captured pre-egress
shape must contain one valid nonempty Responses Lite `additional_tools`
envelope, a nonempty stable `prompt_cache_key`, a contiguous leading developer
prefix, and a different user tail on the second turn. Focused candidate proof
must show that the final Worker body preserves the key, restores tools at top
level, removes `additional_tools`, and adds exactly one breakpoint to the final
supported block in that developer prefix.

Retain only aggregate usage fields and provider request ids from the live
canary; never log the body, prompt, or cache key. The second request must report
a nonzero cache read and materially fewer cache-write tokens than the first. A
schema rejection, missing or changed key/prefix evidence, zero cache reads, or
another full-prefix cache write fails the gate: keep `HOSTED_VENICE_ENABLED`
off and roll back the Worker candidate. Only after the full request matrix and
cache canary pass should Web enable the flag and redeploy so Settings can offer
Venice.

Rollback in the opposite exposure order: disable the Web flag and redeploy Web
first, verify new workspace reads omit the Venice override, and only then
remove the Venice secret or roll Cloudflare back. The nullable stored
preference may remain; while the flag is off it resolves to OpenAI.

## Custom Inference Activation

Custom inference is reader-first and fail-closed. Apply the additive Web
database migration and deploy Web storage, verification, workspace projection,
and signed resolution routes with both `HOSTED_CUSTOM_INFERENCE_ENABLED` and
`HOSTED_CUSTOM_CHAT_COMPLETIONS_ENABLED` set to `0`. Then deploy Cloudflare and
the runner bundle with `container_rollout=immediate`, require managed-container
smoke to report the exact new runner fingerprint, and exercise the native
Responses synthetic tool/final-response probes through the deployed Worker.
The verification operation has one 60-second Worker deadline inside the
75-second Web control timeout; cancellation propagation is covered at the
Worker stream-adapter boundary instead of claimed as a remote capability.
The invocation target uses the existing provider-egress signing secret through
a context-separated key derivation; this release adds no custom-inference
secret or binding.

After that proof, set `HOSTED_CUSTOM_INFERENCE_ENABLED=1` for the intended Web
rollout and verify one controlled native Responses connection end to end.
Enable `HOSTED_CUSTOM_CHAT_COMPLETIONS_ENABLED=1` only after the exact Chat
adapter conformance suite passes on the deployed candidate. A selected custom
workspace presented to an incompatible Worker fails closed; it must never
resolve to OpenAI or Venice.

Rollback begins by preventing new custom selection and explicitly returning
currently selected members to managed inference. Only after no selected custom
connection remains may Web disable the main flag or Cloudflare/runner roll below
the custom-inference contract. Forward-fix the compatible Worker/runner while
any custom selection is active; an old runtime interpreting an unknown override
as managed inference is not a supported rollback state.

## Required GitHub Environment Secrets

Set these in the selected GitHub environment as secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_IMAGES_SIGNING_KEY`
- `HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK`
- `HOSTED_DATABASE_ALERT_LINQ_CHAT_ID`
- `HOSTED_DATABASE_ALERT_LINQ_SECONDARY_CHAT_ID`
- `HOSTED_DATABASE_ALERT_PLANETSCALE_SERVICE_TOKEN`
- `HOSTED_DATABASE_ALERT_PLANETSCALE_SERVICE_TOKEN_ID`
- `HOSTED_LOG_FINGERPRINT_SECRET`
- `HOSTED_PROVIDER_EGRESS_CREDENTIAL_SIGNING_SECRET`
- `HOSTED_R2_PRESIGN_ACCESS_KEY_ID`
- `HOSTED_R2_PRESIGN_SECRET_ACCESS_KEY`
- `HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK`
- `LINQ_API_TOKEN`
- `MURPH_DATA_API_KEY`
- `OPENAI_API_KEY`

`CLOUDFLARE_API_TOKEN` must include account-scoped Workers Queues write access
so deploy automation can create/update the producer, consumer, and DLQ binding.

The protected GitHub Environment may also hold the optional
`HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_KEYRING_JSON` secret. Deploy
automation forwards it to the Worker secret store without exposing it to the
runner. Its entries are compatibility material only; the required
`HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK` remains the active private
key.

The callback-signing key remains part of the required worker secret surface because Cloudflare reads mailbox items, side inputs, workspace checkpoints, and runtime logs through the signed hosted-web boundary. It is no longer documented as a broad lifecycle or correctness callback seam.
The optional read-only Labs port uses that existing signed callback and adds no
Cloudflare secret or provider credential. `JUNCTION_API_KEY` for Labs remains in
hosted Web; the Worker and runner carry only the normalized semantic
request/response. Deploy the compatible Web route and credential first, then
Cloudflare/runtime. Roll back Cloudflare/runtime first so deploy skew fails
closed as Labs unavailable instead of calling a removed Web route.

For the first OpenAI/Venice provider-choice release, keep
`HOSTED_VENICE_ENABLED` disabled until both Web and Cloudflare/runtime are
deployed. A new runtime accepts the preceding provider-less assistant
configuration response as OpenAI, so either deploy order preserves ordinary
replies while the flag is closed. Deploy Web before enabling Venice, deploy
Cloudflare/runtime immediately afterward with `container_rollout=immediate`,
then enable the Web flag only after managed-container smoke reports the new
runner fingerprint. Roll back by disabling the Web flag first.
The Cloudflare automation private JWK is only used to unwrap the `cloudflare-automation-secret` recipient on signed ingress/runtime domain-root envelopes returned by hosted web.
`OPENAI_API_KEY` is required by the standard Worker deploy preflight because the hosted assistant provider path expects Worker-owned OpenAI egress interception. The runner container still receives only an injected-credential placeholder; the raw key stays in the Worker.
`HOSTED_LOG_FINGERPRINT_SECRET` is required so prompt-cache diagnostics can persist stable, Worker-owned request fingerprints without logging prompts, messages, request bodies, headers, or raw identifiers. It must stay out of hosted runtime env.
`MURPH_DATA_API_KEY` is required so the Worker can authorize the internal `murph-data-api.worker` product label lookup endpoints (`/api/foods` and `/api/supplements`) without exposing the key to the runner. Hosted web must have `MURPH_LABELS_DB_URL` before serving either route; `MURPH_SUPPLEMENT_DB_URL` is not a runtime fallback.
Hosted message images do not use Cloudflare Images. The runner stores generated bytes as canonical vault captures and final delivery uses Linq attachments or Telegram multipart upload. Linq group avatars remain available through the narrow `results.worker/private-image-urls` boundary: the Worker passes only validated bytes and MIME type to the existing per-user `UserRunner`, which serializes the write-fence check and deterministic application-encrypted R2 staging with account deletion, then returns an opaque at-most-one-day capability on the current deployment's exact `CF_PUBLIC_BASE_URL` origin for the immediate avatar mutation. Hosted Web accepts that capability only when its origin matches `HOSTED_EXECUTION_CONTROL_URL`; production and preview therefore reject one another's capabilities while the isolated preview Worker, R2 bucket, secret, and Web boundary complete the same journey. The capability hides the member id, R2 key, storage namespace, and image hash. Its canonical path ends in `group-avatar.<ext>`, with the extension derived from the verified MIME type; the public GET/HEAD route also accepts the already-shipped extensionless path during rolling deployment and rollback, decrypts and verifies the object, rejects an extension/MIME mismatch, returns matching successful content headers with no HEAD body, and responds with `private, no-store`. A retry reuses the deterministic object only while its original lifecycle window remains and cannot extend capability validity past that boundary; at or after the boundary, the mutation-locked `UserRunner` replaces the same key before returning another capability. Account deletion makes the existing bounded Cloudflare cleanup attempt before acknowledging completion and synchronously sweeps the member prefix when that attempt succeeds; its encrypted receipt and retention cron retain retry ownership on timeout or provider failure. The R2 lifecycle makes any remaining object eligible for asynchronous deletion after 24 hours rather than guaranteeing physical deletion by that age. Neither cleanup path relies on Linq fetch timing. `HOSTED_PRIVATE_MEDIA_CAPABILITY_SECRET` is Worker-only, must contain at least 32 characters, and must not enter runner env. During this cutover, the workflow maps the existing GitHub environment secret named `CLOUDFLARE_IMAGES_SIGNING_KEY` into that new Worker variable so no secret value is copied or exposed; rename the GitHub secret in a later coordinated deploy. The legacy `results.worker/generated-images` route remains a `410 Gone` rolling-deploy tombstone.

For the private-media cutover, deploy hosted Web and Cloudflare/runner as a
tandem change, with Web first and Cloudflare immediately afterward using
`container_rollout=immediate`. Web temporarily accepts both legacy avatar
shapes emitted by versions in the rollback window: the previous signed Images
URL and the exact queryless
`https://imagedelivery.net/<account>/<image>/public` variant. It rejects other
queryless variants, extra path segments, query parameters on the public variant,
and non-Images origins. The new Worker creates only encrypted R2 capabilities.
Verify the generated-image Linq attachment smoke, an R2-backed group-avatar
mutation, both legacy parser fixtures, the private-media GET response headers,
and the `410` tombstone. The Web deploy also switches the
explicit results-card flow to authenticated same-origin POST and tombstone both
legacy card GET routes. The two deployments are wire-compatible during the
brief window for either legacy avatar URL shape; an old generated-image runner
against the new Worker receives `410` and falls back to text, while a new
runner no longer calls the image-upload route. Once a
new runner persists a `vault_image` outbox descriptor, that reader-capable
runner bundle is the rollback floor; use a forward fix rather than rolling
containers below it. Keep both legacy avatar inputs only until every legacy
producer and rollback candidate has drained; remove them in a later coordinated
Web-first change. Do not roll hosted Web back to the data-bearing card URL
implementation.

For the extension-bearing group-avatar capability rollout, deploy hosted Web
first so its validator accepts both the extensionless and canonical Worker
paths, then deploy Cloudflare/runtime immediately afterward with
`container_rollout=immediate`. The new Worker continues serving both paths, so
old capability URLs remain usable for their one-day lifetime and warm old
runtime containers can still submit extensionless URLs during the brief deploy
window. The Web-first window changes only failed avatar diagnostics: an old
strict runtime may reject the new optional fields instead of seeing the same
generic unavailable result, while successful avatar mutation remains intact.
There is no persisted-state migration. Roll back canonical minting with a
forward Worker fix first; do not redeploy the pre-dual-route Worker. Keep
dual-shape Web validation and Worker serving through the capability lifetime,
and retain the runtime parser until warm containers have drained. Verify one
canonical and one extensionless GET plus HEAD, matching response headers, an
empty HEAD body, MIME/extension mismatch rejection, and the model-visible
allowlisted Linq failure code/fixed message. At the 2026-07-31 production snapshot only
six hosted groups could enter this owner-only avatar path; no per-action durable
counter exists, so bound rollout exposure by observed avatar attempts rather
than assuming one attempt per group.

## Optional Vars

Core execution tuning:

- `CF_COMPATIBILITY_DATE` defaults to `2026-03-27`
- `CF_CONTAINER_INSTANCE_TYPE` defaults to `{"vcpu":1,"memory_mib":3072,"disk_mb":6000}`. This restores the production shape used before the two-vCPU upgrade; heavier hosted reads can take longer on the smaller CPU and memory allocation, so deployment smoke proves function and recovery rather than claiming latency neutrality.
- `CF_CONTAINER_MAX_INSTANCES` defaults to `1000`
- `CF_MAX_EVENT_ATTEMPTS` defaults to `3`
- `CF_RETRY_DELAY_MS` defaults to `30000`
- `CF_WEB_CONTROL_TIMEOUT_MS` defaults to `30000`
- `CF_RUNNER_COMMIT_TIMEOUT_MS` defaults to `45000` and must exceed
  `CF_WEB_CONTROL_TIMEOUT_MS` by at least 5 seconds
- `CF_RUNNER_READY_TIMEOUT_MS` defaults to `20000`
- `CF_ALLOWED_RUNNER_SECRET_KEYS` to seed `HOSTED_EXECUTION_ALLOWED_RUNNER_SECRET_KEYS` in the rendered worker config
- `HOSTED_EXECUTION_CONTAINER_ROLLOUT` controls the one-off Wrangler container rollout flag during deploy. While the vault-share selector-scope migration is active, production deploy helpers default to `immediate` and production preflight rejects explicit `gradual`; use `gradual` only for non-production deploys or after the selector-scope rollout guard is removed.
- `HOSTED_EXECUTION_RUNNER_ENV_PROFILES` adds deploy-time profiles on top of the runtime's minimal `assistant` baseline; deploy automation defaults to `exa,hosted-email,linq,mapbox,telegram`. Hosted device-sync runtime config is resolved from worker env directly rather than a runtime-env profile.
- `HOSTED_EXECUTION_RUNNER_IDLE_TTL_MS` defaults to `300000` (production sets `600000`) and controls the post-completion warm lease minted only by observed conversation activity. Reducing production from 20 minutes to 10 minutes means a follow-up in the former 11–20 minute warm window can take the existing cold-start path instead. `HOSTED_EXECUTION_RUNNER_LIFECYCLE_REEVALUATION_MS` defaults to the idle TTL when absent for rollback compatibility. Leave it unset for the additive code deploy and one legacy-TTL observation window, drain old containers, then set it to `60000` for a canary before widening the rollout. Device sync, system maintenance, replay, and generic runner activity do not extend conversation warmth. RunnerContainer derives the lease directly from the resident child process's private health watermark on every expiry, re-arms the platform timeout while the lease or active work remains, yields on uncertain cleanup state, and otherwise destroys the idle shell. An inactive old child without the watermark is cleanup-eligible; active old-child work remains protected by its independent active-work count. A replacement child starts without inheriting the old process's warmth. Dirty foreground runtime state is checkpointed by the runtime-owned idle-floor—or last-chance shutdown—`idle_shutdown` path before the invocation returns; RunnerContainer never records pending checkpoint intent.
- `HOSTED_EXECUTION_VERCEL_OIDC_ENVIRONMENT` defaults to `production` for
  direct/local artifact rendering. The manual deploy workflow derives it from
  the selected `preview` or `production` target; do not configure a conflicting
  GitHub Environment value.
- `HOSTED_R2_PRESIGN_ENDPOINT` optionally overrides the default account-scoped
  R2 S3 endpoint for direct snapshot presign URLs. Normally leave it unset. If
  set for deploys, it must be `https://<account-id>.r2.cloudflarestorage.com`.
  Hosted-local dev, worker-only, and E2E profiles inject local MinIO flags;
  those local flags must not be set for deploys.

`CF_MAX_EVENT_ATTEMPTS` renders to `HOSTED_EXECUTION_MAX_EVENT_ATTEMPTS` and is
the per-user Durable Object consecutive failure cap. Exhausted runners stop
scheduling retry alarms until fresh nudge/manual input resets the counter.

Observability:

- `CF_LOG_HEAD_SAMPLING_RATE` defaults to `1`
- `CF_TRACE_HEAD_SAMPLING_RATE` defaults to `1`

Signed hosted-web callback metadata:

- `HOSTED_WEB_CALLBACK_SIGNING_KEY_ID`

Hosted crypto authority metadata:

- `HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION`
- `HOSTED_CRYPTO_AUTHORITY_SIGN_PUBLIC_KEY_PEM`
- `HOSTED_CRYPTO_AUTHORITY_VERIFY_KEYRING_JSON` for additional `verify_only` or
  `disabled` public verification keys
- `HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID`
- `HOSTED_CRYPTO_ENV`

### Hosted crypto standby-key preload

Treat a hosted authority or Cloudflare automation key change as a reader-first
compatibility rollout. The protected GitHub Environment is the Cloudflare
deploy source of truth: store
`HOSTED_CRYPTO_AUTHORITY_VERIFY_KEYRING_JSON` as an environment variable and
`HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_KEYRING_JSON` as an environment
secret. Vercel Production must receive the same authority verify keyring plus
`HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PUBLIC_KEYRING_JSON`. Updating Vercel
configuration is incomplete until the Web app is redeployed; updating the
GitHub Environment is incomplete until the protected Cloudflare workflow
renders, syncs, deploys, and proves the live Worker bindings.

For a non-active preload, create a new non-exportable version on the existing
GCP KMS asymmetric signing key and add its public key as `verify_only` on both
Web and Worker. Generate the P-256 Cloudflare recipient keypair with an
operating-system cryptographic random source, retain the private JWK only in an
approved local secret store during transfer, add its public entry to Web as
`disabled`, and add its private entry to Cloudflare as `decrypt_only`. Keep all
required single-key variables unchanged, deploy Web first, then deploy
Cloudflare, and confirm production envelope key-reference aggregates are
unchanged. Provider inspection and logs must show names, scopes, statuses, and
counts only—not keyring JSON, PEM bodies, JWKs, or production rows.

Web build and Worker deploy preflight must use the same runtime-state standby
acceptance contract before either provider can promote code. It rejects
malformed or active optional entries, rejects private material in Web's public
ring or a private keyring in Web runtime, and permits Cloudflare entries only
for `cloudflare-automation-secret`. Both provider gates also reject an optional
entry that collides with the required active authority or Cloudflare key ID,
because runtime overlay would otherwise replace it. Before either provider
gate accepts a ring, identifiers must also remain unique after the same trimming
used by runtime constructors. Web public entries and their JWKs use closed raw
schemas, and a duplicate-aware scan runs before the first `JSON.parse` for all
three rings. Duplicate raw members, sibling private material, and undeclared
fields fail before Vercel.
Before any provider mutation, load all three proposed payloads from approved
secret stores into the process environment together with the current active
IDs and the operator-only
`HOSTED_CRYPTO_STANDBY_AUTHORITY_KEY_VERSION` and
`HOSTED_CRYPTO_STANDBY_CLOUDFLARE_AUTOMATION_KEY_ID`. Run the Web
`hosted-crypto:env-check` script with `--require-complete-preload`; complete
mode requires the intended `verify_only` / `disabled` / `decrypt_only` entries
to survive under distinct proposed IDs, imports the exact proposed authority
PEM as a P-256 ECDSA verification key, and wraps then unwraps an ephemeral
challenge through the exact proposed Cloudflare public/private JWKs. The two
proposed ID inputs are non-secret one-shot validation metadata; do not add them
to a provider runtime.
Validation errors identify only the configuration field. Do not put values in
arguments or bypass either gate.

Record the current ready Vercel production deployment before preload. Deploy
Web first, then prove the unchanged active Web crypto-context path against
current envelopes before changing the Worker. A successful build alone is not
proof; restore the recorded Web deployment if that live check fails. After the
protected Cloudflare deploy, require Worker preflight, managed-container smoke,
and unchanged privacy-safe envelope-reference aggregates. The current active
Vercel deployment and unchanged active single-key bindings remain the rollback
floor throughout standby preload.

The Cloudflare private keyring's canonical deploy hop renders the ignored
`apps/cloudflare/.deploy/worker-secrets.json` payload under a mode-`0700`
directory with mode `0600`, then supplies that file only as Wrangler's
`--secrets-file`. The protected production workflow runs on an ephemeral
worker, so worker disposal removes the payload. A direct or local deploy must
remove that exact generated file after both success and failure. It is an
ephemeral transport, not a source of truth; the approved local secret store and
protected GitHub Environment secret remain the owners. Never place private JWK
values in CLI argument values, logs, tracked or review artifacts, or any other
plaintext file.

Standby preload is not authority activation or envelope rotation. Do not change
an active key id/version, re-sign or rewrap domain-root envelopes, disable a
current key, or remove compatibility entries until a separately reviewed
production mutation owner exists. That later operation must deploy all readers
first, preserve the current Cloudflare private key for the entire compatibility
window, migrate in bounded batches, prove healthy reads, and prove zero active
or `decrypt_only` envelope references before retirement.

Hosted assistant config:

- `HOSTED_ASSISTANT_PROVIDER`; keep the fleet default `openai`. A per-member
  Venice selection arrives through the signed workspace projection rather than
  this deploy default.
- `HOSTED_ASSISTANT_MODEL`; worker deploy preflight requires an explicit allowance-priced direct OpenAI model slug. Supported slugs are `gpt-5.6-sol`, `gpt-5.6-terra`, and `gpt-5.6-luna`. Production deploys require `HOSTED_ASSISTANT_REASONING_EFFORT=low`.
- `HOSTED_ASSISTANT_APPROVAL_POLICY`
- `HOSTED_ASSISTANT_REASONING_EFFORT`
- `HOSTED_ASSISTANT_SANDBOX`
- Optional Venice core inference uses the `VENICE_API_KEY` GitHub Environment
  secret. The regular provider model ids are code-owned rather than deploy
  variables.

When changing hosted assistant model pricing or allowance enforcement, deploy the
Cloudflare Worker/runner model contract before or atomically with the hosted web
allowance logic so runtime usage callbacks keep using an allowance-priced model.
For the Venice provider-aware pricing rollout, deploy Cloudflare first so the
exact upstream mappings are active, complete the all-tier direct/tool/compact
proof above, then deploy Web so new immutable usage rows select the Venice rate
table. Historical immutable usage rows are not repriced.

Vault-share selector-scope production deploys must also use
`container_rollout=immediate` until the distance/count selector-scope runner
bundle has fully rolled out and the rollback window to a bundle without exact
scope support has closed. The destination mailbox importer does not negotiate
projection-scope capability, so a gradual rollout could leave a warm old runner
importing a selector-scoped delivery wake it cannot preserve.

Opt-in runtime integrations:

- `HOSTED_EMAIL_DEFAULT_SUBJECT`
- `HOSTED_EMAIL_DOMAIN`
- `HOSTED_EMAIL_FROM_ADDRESS`
- `HOSTED_EMAIL_LOCAL_PART`
- `HOSTED_PHYSICAL_NOTES_ENABLED`
- `MURPH_ANDROID_APP_ENABLED`
- `LINQ_API_BASE_URL`
- `TELEGRAM_API_BASE_URL`
- `TELEGRAM_BOT_USERNAME`
- `TELEGRAM_FILE_BASE_URL`
- `DEVICE_SYNC_PUBLIC_BASE_URL`
- `JUNCTION_ENV`
- `JUNCTION_REGION`
- `JUNCTION_PROVIDER_FILTER`
- `JUNCTION_SUMMARY_RESOURCES`
- `JUNCTION_SUMMARY_BACKFILL_DAYS`
- `JUNCTION_TIMESERIES_BACKFILL_DAYS`
- `JUNCTION_RECONCILE_DAYS`
- `JUNCTION_RECONCILE_INTERVAL_MS`
- `JUNCTION_REQUEST_TIMEOUT_MS`

`HOSTED_PHYSICAL_NOTES_ENABLED` exposes the hosted physical-note tool only when
set to exactly `true`; leave it unset to keep the tool disabled. Set it as a
GitHub `production` environment variable, and only after Web's Lob
configuration is live (see `agent-docs/product-specs/physical-notes.md`,
Deployment).

`DEVICE_SYNC_PUBLIC_BASE_URL` is optional. When set, it may select a stable
provider callback/webhook path on the hosted Web hostname, but it must not use a
separate device-sync hostname. Both production and preview preflight reject the
explicit split-host shape before render, secret sync, lifecycle mutation, or
deploy. When it is unset, hosted Web build validation—not Cloudflare
preflight—proves the derived callback hostname against every configured browser
surface.
Correct the callback hostname before either Web or Worker deployment, and ship
the Web start/build guard with the Cloudflare preflight change. During a skewed
rollout the Web start guard still fails closed before OAuth state or provider
authorization; do not bypass it to recover an invalid split-host environment.

Device-webhook burst transport requires a main Queue and DLQ named from the
deployed Worker (`<worker>-device-webhooks` and
`<worker>-device-webhooks-dlq`). Create both before deploying the Worker config.
Keep Web's comma-separated `HOSTED_DEVICE_WEBHOOK_QUEUE_PROVIDERS` rollout gate
empty while deploying the callback and consumer. Deploy Web first: an old
Worker sends callbacks of at most 25 entries, which the new Web reader accepts.
Then deploy the Queue-capable Worker, which may send up to 100 entries; deploying
that Worker against old Web would make callbacks above 25 fail closed and retry.
Start with one provider and prove Queue depth returns to zero, no DLQ rows
appear, no more than four independent account lanes run, and each account stays
serial before expanding. To roll back, clear the Web gate first, drain the main
Queue through the still-deployed consumer, retain the encrypted DLQ for bounded
recovery, and remove the consumer/bindings last.
During Cloudflare automation-key rotation, keep the prior private key as
`decrypt_only` until Web uses the new public key and both the main Queue and
encrypted DLQ are proven free of envelopes wrapped to the prior key. Queue/DLQ
retention is part of the key-retirement floor; elapsed rollout time alone is not
proof that the old key is safe to disable.
Prepared webhook parsers have the same retention floor: keep every decoder for
an emitted `murph.device-sync-prepared-webhook.*` schema readable until both
Queues and all supported redrive paths are proven free of that version. A
provider signing-secret or parser rotation needs no overlap for already queued
events because Web froze verified prepared meaning before provider acknowledgement.

The Queue-health Durable Object reads only native main-Queue and DLQ metrics.
It pages both configured operator chats immediately when the DLQ is nonempty,
when the oldest main-Queue message reaches 15 minutes, or after two consecutive
metric failures. A failed first page retains its exact body and Linq
idempotency key for the next five-minute check, while hourly pacing applies
only to successful repeat pages in the same continuously open incident. Keep
`HOSTED_DATABASE_ALERT_ENABLED=1` and the existing Linq alert secrets configured
for production so both independent monitors run.

For encrypted DLQ recovery, first fix the admission failure and retain every
Cloudflare automation private key still referenced by either Queue. Pause the
main Queue consumer while producers continue writing. Temporarily configure the
same Worker as the DLQ consumer with batch size 100, five-second batching,
concurrency one, ten retries, a 30-second retry delay, and the paused main Queue
as that temporary consumer's dead-letter target. Wait until DLQ metrics report
zero, remove the temporary DLQ consumer, resume the ordinary main consumer, and
verify that main depth returns to zero while the DLQ stays empty. Do not purge,
download, decrypt, or manually copy messages. This redrive acknowledges only
successful canonical admissions; work that still fails returns encrypted to the
paused main Queue instead of being deleted. Keep both Queues at the configured
14-day retention throughout recovery.

Native parser binaries are owned by the runner image and passed to the hosted runtime through explicit parser toolchain config, not deploy-time env overrides. Hosted audio transcription has no in-image model: the parser toolchain points at the Worker-mediated `murph-transcribe.worker` host and the Worker calls the Workers AI `AI` binding (`@cf/openai/whisper-large-v3-turbo`).

Device-sync provider runtime overrides:

- `OURA_API_BASE_URL`
- `OURA_AUTH_BASE_URL`
- `OURA_BACKFILL_DAYS`
- `OURA_RECONCILE_DAYS`
- `OURA_RECONCILE_INTERVAL_MS`
- `OURA_REQUEST_TIMEOUT_MS`
- `OURA_SCOPES`
- `OURA_WEBHOOK_TIMESTAMP_TOLERANCE_MS`
- `STRAVA_API_BASE_URL`
- `STRAVA_AUTH_BASE_URL`
- `STRAVA_BACKFILL_DAYS`
- `STRAVA_RECONCILE_DAYS`
- `STRAVA_RECONCILE_INTERVAL_MS`
- `STRAVA_REQUEST_TIMEOUT_MS`
- `STRAVA_SCOPES`
- `WHOOP_BACKFILL_DAYS`
- `WHOOP_BASE_URL`
- `WHOOP_RECONCILE_DAYS`
- `WHOOP_RECONCILE_INTERVAL_MS`
- `WHOOP_REQUEST_TIMEOUT_MS`
- `WHOOP_SCOPES`
- `WHOOP_WEBHOOK_TIMESTAMP_TOLERANCE_MS`

If the selected GitHub environment already defines container sizing overrides, update these existing vars there as well:

- `CF_CONTAINER_INSTANCE_TYPE={"vcpu":1,"memory_mib":3072,"disk_mb":6000}`
- `CF_CONTAINER_MAX_INSTANCES=1000`

When hosted email sender identity is configured, deploy automation renders one native `send_email` binding named `HOSTED_EMAIL` and constrains it with `allowed_sender_addresses` to that resolved sender address. Hosted email outbound send no longer requires a runtime Cloudflare account id or email-send API token inside the Worker.

## Optional Secrets

Hosted assistant provider and channel secrets:

- `EXA_API_KEY`, `MAPBOX_ACCESS_TOKEN`, and `TELEGRAM_BOT_TOKEN` when those
  hosted runtime integrations are enabled. `LINQ_API_TOKEN` is no longer
  optional because the independent database-health page owner uses it. These
  are Worker-owned credentials, not raw child-container env. Exa egress is
  limited to `POST /search`.

Hosted usage-reporting secrets:

- `HOSTED_AI_USAGE_REPORTING_SECRET` when stable anonymized usage attribution should be added by the Worker/web-control proxy before records reach hosted web. This secret must stay Worker-owned and must not be forwarded into the hosted runtime env.
- Cloudflare runner start authority accepts neither signed usage-allowance
  decisions nor a live Web usage-gate callback. Web preserves conversation
  mailbox input before admission, Temporal/runtime admission gates model-capable
  work, and runtime/provider spend enforcement still happens before model calls.
- Cloudflare/runner #587 or newer is the permanent rollback floor before
  deploying or rolling back a Web build that omits the retired callback route.
  A Web rollback that restores the unused route is safe; rolling Cloudflare
  below that floor while the route is absent is not.

Hosted web data API secrets:

- `MURPH_DATA_API_KEY` when hosted runner product-label lookup should call
  `${HOSTED_WEB_BASE_URL}/api/foods` or
  `${HOSTED_WEB_BASE_URL}/api/supplements`. This secret is injected by the
  Worker intercept and must not be forwarded into the hosted runtime env. Hosted
  web must have `MURPH_LABELS_DB_URL` configured for both food and supplement
  lookup; `MURPH_SUPPLEMENT_DB_URL` is not a runtime fallback.

Opt-in execution integrations:

- `HOSTED_EMAIL_SIGNING_SECRET`
- `DEVICE_SYNC_SECRET`
- `EXA_API_KEY`
- `JUNCTION_API_KEY`
- `JUNCTION_CLIENT_USER_ID_SECRET`
- `JUNCTION_WEBHOOK_SECRET`
- `LINQ_WEBHOOK_SECRET`
- `MAPBOX_ACCESS_TOKEN`
- `OURA_CLIENT_ID`
- `OURA_CLIENT_SECRET`
- `STRAVA_CLIENT_ID`
- `STRAVA_CLIENT_SECRET`
- `TELEGRAM_BOT_TOKEN`
- `WHOOP_CLIENT_ID`
- `WHOOP_CLIENT_SECRET`
The documented deploy surface is intentionally limited to the vars and secrets above for the narrowed execution plane and its opt-in runtime integrations.

### Inbound message-content retention rollout

This rollout has an irreversible transcript cutover and must use two phases:

1. Deploy the Cloudflare Worker and stamping-capable runner bundle with
   `container_rollout=immediate`. Drain old warm bundles, prove the deployed
   fingerprint, and verify that newly written user transcript entries carry
   `contentReceivedAt`. This Worker/runner version is also the rollout floor:
   its ambiguous-completion recovery requires both a workspace-version advance
   and a changed checkpoint timestamp before it releases a runtime fence.
2. Before the Web migration, count persisted workspace snapshots and compare
   the aggregate with the existing retention-cron capacity of five snapshots
   per successful hourly run plus an explicit full-run signal-failure
   allowance. Stop if that queue cannot drain safely in the rollout window; do
   not add a second dispatcher as part of this release.
3. Record the verified runner-convergence instant, then deploy Web with the
   additive mailbox retention columns. The phase-one migration re-arms every
   persisted workspace snapshot once, advances the workspace CAS version, and
   leaves checkpoint time unchanged. A runtime that read the pre-rearm version
   must conflict and retry instead of clearing the wake; the Worker must not
   treat that migration-only version advance as runtime progress. Monitor the
   existing cron until no due snapshot remains; each restored runtime scrubs
   receipt-backed captures, parser output, projections, inputs, and stamped
   transcripts while preserving every unstamped legacy transcript entry.
   Phase one is incomplete until the queue reaches zero.
   If the Web migration was applied before runner convergence, first prove the
   stamping-capable runner fingerprint across the fleet, then ship the additive
   `20260728050000_rearm_hosted_mailbox_content_retention` recovery migration.
   It repeats only the wake, attempt-marker reset, and CAS advance; it does not
   alter content or checkpoint time. Start the drain window from that recovery
   migration and keep monitoring the same due queue to zero.
4. Keep legacy unstamped transcript entries intact for 14 complete days after
   the convergence instant and until phase one has drained, whichever is later.
   Newly stamped entries and the other receipt-owned message carriers use their
   exact inclusive 14-day deadlines after their initial snapshot drain.
5. Only after both gates, ship a separate phase-two migration that
   re-arms persisted snapshots again and enables retirement of every remaining
   unstamped user transcript entry. Verify retention wake convergence,
   checkpoint publication, policy-non-reply counts, and content-retirement
   counts before declaring the cutover complete.

Do not infer legacy receipt time from transcript creation, accepted-turn
journals, or input events, and do not enable the phase-two legacy scrub early.
Normal snapshot cleanup can discard those joins, so an early scrub can
irreversibly erase recent user context while leaving the paired assistant
reply. The phase-one rearm and drain gate are required: omitting either one
strands other receipt-backed message carriers in dormant snapshots beyond
their deadline.

### Generated-image capture retention rollout

Generated-image retirement reuses the existing retention wake and bounded
hourly dispatcher. Roll it out in this order:

1. Deploy the generated-image-retention-capable Worker and runner bundle with
   `container_rollout=immediate`. Prove the deployed runner fingerprint and
   drain old warm bundles before changing workspace wake state. Prove that new
   captures checkpoint the earliest exact retention cutoff and that an
   interrupted tombstone receipt replays from the prior snapshot.
2. Count persisted snapshots and compare that total with the existing
   retention-cron capacity of five snapshots per successful hourly run plus an
   explicit signal-failure allowance. Stop if the queue cannot drain safely in
   the rollout window; do not add a second dispatcher.
3. Deploy Web with
   `20260805010000_rearm_generated_image_capture_retention`. The migration
   re-arms every persisted snapshot on `inbox_media_retention`, clears the prior
   signal-attempt marker, advances the workspace CAS version, and leaves
   checkpoint time unchanged. A runtime that read the previous version must
   conflict and retry instead of clearing the new wake.
4. Monitor the existing cron until the due snapshot queue reaches zero. Verify
   generated-image tombstone checkpoints, deleted lookup replay, blocked-image
   retry counts, and the absence of retention failures before declaring the
   rollout complete.

### Retired WhatsApp configuration

Removing WhatsApp bindings from the deploy workflow does not delete values that
are already stored by Cloudflare or Vercel. Roll this removal out in this order:

1. Deploy Web first so `/api/whatsapp/webhook` can no longer append new mailbox
   rows.
2. Before deploying the Worker or runner, prove there are zero unconsumed,
   nonterminal hosted-mailbox rows whose dedupe key starts
   `whatsapp:message:`. Let the old runner drain them; if zero-row proof cannot
   be obtained, stop the rollout rather than making the new runtime decode old
   payloads.
3. Deploy the Worker and runner with `container_rollout=immediate`, prove runner
   bundle convergence, and confirm there are no mailbox-payload decode failures.
4. Revoke the upstream WhatsApp access token and disable the Meta webhook and
   phone-number integration so the provider can no longer deliver messages or
   accept API calls for Murph.
5. Delete the retired `WHATSAPP_*` vars and secrets from every deployed
   environment through the provider CLI or dashboard without downloading their
   values.

This operational cleanup must not delete or rewrite historical hosted-consent
events: the removed consent scope is inert, and current launch consent remains
valid without asking members to consent again.

## Local Validation And Artifact Render

From the repo root:

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm --dir apps/cloudflare typecheck
```

Render deploy artifacts with the minimum execution-plane env:

```bash
export CF_WORKER_NAME=hosted-runner-staging
export CF_BUNDLES_BUCKET=hosted-execution-bundles-staging
export CF_BUNDLES_PREVIEW_BUCKET=hosted-execution-bundles-staging-preview
export CF_PUBLIC_BASE_URL=https://hosted-runner-staging.example.workers.dev
export HOSTED_EXECUTION_DEPLOY_CONTEXT=preview
export HOSTED_EXECUTION_VERCEL_OIDC_ENVIRONMENT=preview
export HOSTED_WEB_BASE_URL=https://web-staging.example.test
export HOSTED_WEB_PRODUCTION_BASE_URL=https://web.example.test
export HOSTED_EXECUTION_VERCEL_OIDC_TEAM_SLUG=your-team
export HOSTED_EXECUTION_VERCEL_OIDC_PROJECT_NAME=your-project
export HOSTED_R2_PRESIGN_ACCOUNT_ID=your-cloudflare-account-id
export HOSTED_R2_PRESIGN_BUCKET_NAME=hosted-execution-bundles-staging
export HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID=cloudflare-automation:v1
export HOSTED_CRYPTO_ENV=preview
export HOSTED_ASSISTANT_PROVIDER=openai
export HOSTED_ASSISTANT_MODEL=gpt-5.6-terra
export HOSTED_ASSISTANT_REASONING_EFFORT=low

# Set required secret-valued variables outside this snippet before running:
# HOSTED_R2_PRESIGN_ACCESS_KEY_ID, HOSTED_R2_PRESIGN_SECRET_ACCESS_KEY,
# HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION,
# HOSTED_CRYPTO_AUTHORITY_SIGN_PUBLIC_KEY_PEM,
# HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK,
# HOSTED_LOG_FINGERPRINT_SECRET,
# HOSTED_PROVIDER_EGRESS_CREDENTIAL_SIGNING_SECRET,
# HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK, MURPH_DATA_API_KEY, OPENAI_API_KEY.
pnpm --dir apps/cloudflare deploy:preflight
pnpm --dir apps/cloudflare deploy:artifacts
```

To inspect the runner bundle and generated Wrangler config independently:

```bash
pnpm --dir apps/cloudflare runner:bundle
pnpm --dir apps/cloudflare deploy:config:render
```

Local deploys and Docker smoke checks also prepare the stable native base image:

```bash
pnpm --dir apps/cloudflare runner:docker:base
```

That image is prepared in the local Docker cache under the stable GHCR tag
`ghcr.io/cobuildwithus/murph-cloudflare-runner-base:node24.14.1-codex0.147.0`,
which is also the final app-layer Dockerfile default. Using the pullable GHCR
name avoids BuildKit treating the prepared base as a Docker Hub `library/*`
image during local Wrangler container builds.
It contains Node, Python 3 exposed as both `python3` and `python`, pinned `@openai/codex` with its bundled Linux sandbox resources, `jq`, `ripgrep`, `ffmpeg`, and PDF tooling from Poppler plus `file` and `qpdf`, but no app bundle, worker secrets, or local speech models.
The final app-layer image generates a patched Codex model catalog from `codex debug models --bundled`, adds OpenAI flex service-tier support for `gpt-5.6-sol`, `gpt-5.6-terra`, and `gpt-5.6-luna`, validates those entries with `jq`, and exposes it through `MURPH_HOSTED_CODEX_MODEL_CATALOG_JSON` so hosted app-server cron turns can send OpenAI `service_tier: flex` and the deploy smoke can exercise Terra through the same model catalog. Hosted Codex MultiAgent V2 is enabled through the generated `[features.multi_agent_v2]` config table, which also carries Murph's proactive-delegation tool and mode hints: delegate bounded background work that would otherwise block the immediate reply. Hosted launches must not pass a boolean `features.multi_agent_v2` override because that would replace the table and drop those hints. The Codex App Server stays warm for the container lifetime; configuration changes take effect through normal container or process replacement, not per-turn restart.
The runner bundle is root-owned and mode-normalized in an intermediate image
stage, then copied once into a fresh final base stage. Keep that normalized-copy
boundary instead of applying a recursive permission change after the final
bundle copy: a post-copy `chmod` creates another application-content layer while
the runtime still needs only one immutable `/app` tree.
`runner:docker:base` first reuses a GHCR-published base image when its source-fingerprint label matches the checked-out `Dockerfile.cloudflare-hosted-runner-base`; otherwise it rebuilds locally. Pass `-- --force` to rebuild from the checked-out Dockerfile without adopting a GHCR base image; deploy-capable production paths use that forced path so GHCR stays a CI/local cache instead of production image authority. Pull-request hosted-local E2E does not authenticate to GHCR before running PR-controlled code, so the GHCR runner base package must be public for fast anonymous PR cache pulls. The protected-main `.github/workflows/cloudflare-runner-base-image.yml` workflow publishes the base image with `GITHUB_TOKEN`.
The base image build runs `python3 --version`, `python --version`, `jq --version`, `rg --version`, `zstd --version`, `codex --version`, `codex app-server --help`, and `codex doctor --help` under the runner user, and the Docker smoke repeats the Python and ripgrep checks inside the final image before deploy while also proving `file`, `pdfinfo`, `pdftotext`, `pdftoppm`, and `qpdf` against the restored smoke PDF fixture.
Run `pnpm --dir apps/cloudflare test:e2e:runner-python:local` when you specifically want the actual final hosted-runner app image `PATH` proof for Python. It assembles the runner bundle, builds the same `linux/amd64` app-layer Dockerfile used by the Cloudflare container, starts the image with its normal entrypoint, waits for `/health`, then checks Python as the non-root `runner` user from immutable `/app` with the baked runner env. Run `pnpm --dir apps/cloudflare runner:docker:smoke` when you want the broader final-image native smoke. That disposable, networkless smoke relaxes the outer Docker seccomp profile so Codex can create its inner user namespace, matching the namespace capability available in Cloudflare's dedicated Linux VM. The nested Codex seccomp proof requires a native `linux/amd64` Docker host; AMD64 emulation on an ARM64 Docker daemon does not support that inner seccomp layer.

After first publish, make the GHCR runner base package public so PR CI can use
anonymous pulls without exposing package credentials to PR-controlled commands.

## Preview Staging Lane

The private protected-main workflow has one non-production target: `preview`.
It uses the same generated config, secret renderer, Wrangler deploy, lifecycle
application, and smoke owner as production, but attaches the existing GitHub
`Preview` Environment. Do not add a second Wrangler config or deploy workflow.

Before the first preview Worker deploy:

1. Make the Vercel `preview` target an isolated hosted-Web boundary. It needs
   its own database, crypto environment and keys, callback-signing keys,
   Temporal namespace/task queue, and any provider sandbox credentials used by
   the rehearsal. Use a stable preview URL whose hostname contains `preview` or
   `staging`. Keep production database, crypto, persistent computer profile,
   messaging routes, and provider credentials out of this target.
2. Configure the GitHub `Preview` Environment with the vars and secrets in this
   document. Use a Worker name and both configured R2 bucket names containing
   a `preview` or `staging` segment. `HOSTED_CRYPTO_ENV` must be `preview`.
   `HOSTED_WEB_BASE_URL` must be the isolated preview origin and
   `HOSTED_WEB_PRODUCTION_BASE_URL` must be the production origin used only for
   the inequality guard. The Worker and Web origins must be distinct. If device
   sync is enabled, `DEVICE_SYNC_PUBLIC_BASE_URL` must be a public staging HTTPS
   URL on the same hostname as preview `HOSTED_WEB_BASE_URL`; its callback path
   is allowed, but a separate callback hostname is not.
3. Use ENAM for both staging buckets. Issue the direct-R2 key against the
   canonical buckets and apply the checked-in lifecycle rules before stateful
   use. Preview has no OC binding or retirement role.
4. Dispatch from protected `main`:

   ```bash
   gh workflow run deploy-cloudflare-hosted.yml \
     --repo cobuildwithus/murph-cloud \
     --ref main \
     -f environment=preview \
     -f sync_worker_secrets=true \
     -f deploy_worker=true \
     -f container_rollout=immediate \
     -f live_model_turn=false
   ```

The workflow derives
`HOSTED_EXECUTION_VERCEL_OIDC_ENVIRONMENT=preview` from the selected target.
Preflight runs before artifact rendering, secret sync, lifecycle changes, or
Worker deployment and rejects a mismatched crypto/OIDC context, unscoped
Worker or R2 name, non-staging Worker/Web origin, production Web alias, local
or private-network origin, private-network DNS resolution, Worker/Web
self-routing, or a device-sync callback whose hostname differs from hosted Web.
Preview deploys never run
the paid live-model deploy smoke; endpoint, managed-container, runner-bundle,
assistant CLI, and immediate direct-R2 smoke still run.

If the isolated Vercel preview boundary is incomplete, stop before dispatch.
Pointing the preview Worker at production Web or copying production stateful
secrets is not a bootstrap shortcut.

Normal worker deploys apply the checked-in lifecycle rules before `wrangler deploy`. When you need to repair or verify the bucket lifecycle separately:

```bash
pnpm --dir apps/cloudflare r2:lifecycle:apply
```

That command reads `CF_BUNDLES_BUCKET` and `CF_BUNDLES_PREVIEW_BUCKET` and applies the checked-in execution-transient rules to whichever of those buckets are configured.

## Deploy

For the normal direct path:

```bash
pnpm --dir apps/cloudflare deploy:worker
```

That command:

- runs deploy preflight inside the apply step before artifact validation and upload
- renders the deploy config and worker secrets payload
- assembles the runner bundle, building and packing the runner workspace closure with bounded parallelism (`MURPH_RUNNER_BUNDLE_BUILD_CONCURRENCY` and `MURPH_RUNNER_BUNDLE_PACK_CONCURRENCY`, both defaulting to `4`); runner-specific CLI and Health Commons tarballs keep the deployed `murph` / `vault-cli`, compact protocol artifacts, and compact biomarker desired-direction projection without the public npm package's nested bundled workspace payload or web-only Health Commons artifacts
- prepares the stable native runner base image with Docker's local cache; production deploy paths force that build from source, while hosted-local E2E lanes may reuse the GHCR-published runner base image when the source fingerprint matches the current checkout
- deploys the Worker directly with Wrangler; production deploys currently default to immediate container rollout for the vault-share selector-scope migration, while non-production deploys default to gradual and build only the small app image layer from the prepared runner bundle

The gradual container rollout keeps the production `RunnerContainer` `rollout_active_grace_period` at 300 seconds and rolls runner instances through `10`, `25`, `50`, then `100` percent. The isolated `DeploySmokeRunnerContainer` uses zero active grace and a single 100 percent step: it carries no user work, and smoke probes must not defer the image replacement they are trying to verify. The manual workflow exposes a `container_rollout` input; its production default is currently `immediate` because selector-scoped vault-share deliveries are unsafe under gradual runner rollout. Selecting `immediate` passes Wrangler's `--containers-rollout=immediate` flag and can interrupt active runner containers.
Worker replacement is checkpoint-safe at the runtime fence rather than through rollout timing alone. The snapshot-session handshake has one six-second total deadline; the runtime starts its first exact durable upload-session heartbeat immediately after that response, then keeps serialized attempts on a two-second start-to-start cadence throughout publication. `UserRunner` retains the fence and retries after one second only for that exact attempt and lease generation while its heartbeat is less than 10 seconds old and completion is absent. Successful foreground preemption bypasses this preservation and stops heartbeat liveness before detached cleanup. After Web accepts the checkpoint, the runtime stops heartbeating and best-effort marks completion; marker failure falls back to stale-heartbeat expiry. Other starts remain immediate; live snapshots have no artificial publication deadline, while a dead runtime can defer replacement for the 10-second liveness window plus at most one additional retry interval (one second) after its final heartbeat.
During gradual rollout, Worker code and runner container state may disagree for the rollout window. A newly deployed Worker version can handle provider egress or internal-host traffic from an already-running warm runner process whose bundle, process env, or provider-credential shape was created before the deploy. Treat this as expected rollout behavior, not proof that traffic is reaching an old Worker version. Any PR that changes a Worker/container contract, runner env shape, hosted provider credential, internal host route, parser/toolchain path, or bundle-owned runtime assumption must document the compatibility window in its PR description and final `DEPLOYMENT CONCERNS:` handoff: whether old containers can safely talk to new Worker code, whether new containers can safely talk to old web/control-plane code, whether `container_rollout=immediate` is required, and which deploy-smoke or Workers Observability checks prove the fleet has converged.

The Junction scalar-timeseries continuation cutover is runner-only and requires
`container_rollout=immediate`. The preceding production bundle could persist a
canonical v1 `{v,a,i}` resource envelope in a hosted wake hint or local
`device_job`; the compatible runner validates that exact envelope, projects
only `a` into the existing scalar resource coordinate, and writes scalar
successors. It does not restore phase or completed-resource state. Require
managed-container smoke to report the compatible runner-bundle fingerprint
before considering the fleet converged. Once any scalar successor has been
written, that bundle is the rollback floor because the preceding runner cannot
read the scalar shape. Keep the narrow v1 reader until separate aggregate proof
shows no retained hosted wake hint or local device job can contain the envelope;
without that proof, retain the reader rather than adding a migration or another
state owner. Vercel/Web has no deployment ordering dependency for this cutover.

The non-expiring Starter plan-usage schema was a bidirectional hard cut between
Web and the runner bundle. Its production rollout is complete: compatible Web
and Cloudflare code from the same current public `main` deployed without an
intentional Render or execution pause, the protected Cloudflare workflow used
`container_rollout=immediate`, managed-container and live-model smoke proved the
new runner, and the post-deploy contract-migration workflow applied the
migration after its declared drain.

Do not remove `HOSTED_EXECUTION_CONTROL_URL` for a future plan-usage rollout.
The value also authorizes privacy, export, media, and account-deletion paths, so
removing it is not a route-scoped runtime-start pause and would disable
unrelated operations. The migrated ledger is now a forward-only floor: repair
or redeploy a compatible current Web/runner pair. Neither pre-Starter plane is
a resumable target against the migrated database. The one-time legacy Stripe
object drain is complete; the remaining delayed-event compatibility and final
removal gate are owned by `agent-docs/product-specs/starter-usage.md`.

The accepted group-message participant rollout is Web-first. Deploy the Web
release that accepts both new exact `groupRequester` / `participant` evidence
and the legacy mailbox / self-opt-out fallbacks before deploying the Worker and
runner that send only the new fields. Roll back Worker/runner first. After
managed-container smoke proves the new runner fingerprint and all warm old
runners have drained, the legacy Web-only fields may be removed in a separate
contracting release. This order also covers optional group-speaker provenance:
old runners may leave owner-contact labels unnamed when new Web emits the
additive source field, but conversation and exact participant authorization
remain available. After convergence, smoke one profile-name label, one
unverified owner-contact label, and one participant-scoped action selected by
an opaque accepted-message ref.

Member-reported daily metrics add the
`health.daily-metric.reported` Web producer to that existing exact-participant
path. An old runtime quarantines this kind and can stop its ordered system lane,
so this release is consumer-first:

1. Deploy Cloudflare and the runner with `container_rollout=immediate`. Do not
   deploy Web until managed-container smoke reports the exact new runner-bundle
   fingerprint and the immediate rollout has converged across eligible runtime
   targets.
2. Deploy Web, then run one synthetic granted `steps-days.v0` correction. The
   action must return `accepted`; the member's system-lane consumed counter and
   workspace checkpoint must advance; a later exact-scope `read_shared` must
   retain the device record and add one `Manual` record. Confirm aggregate
   runtime evidence contains no `unsupported_kind` route and no unconsumed
   `health.daily-metric.reported` item behind its system-lane counter.
3. The first Web producer enablement or imported report makes this exact
   contracts/query/runner bundle a hard rollback floor. The canonical
   observation permanently retains the strict `qualifiers` field and its
   mailbox causal sequence after the transient mailbox item drains. Web may
   roll back first to stop new reports, but never roll the runner below this
   floor afterward; forward-fix on this bundle or newer. A pre-floor runner can
   reject the persisted event while scanning the vault and cannot preserve the
   report ordering during projection rebuild.

If the post-commit signal fails, keep the accepted mailbox write and let the
existing scheduled `/api/internal/device-sync/recovery-sweep` handoff select and
signal the exact pending item. For a bounded manual repair, keep or redeploy the
compatible runner, roll Web back to stop new production, invoke that existing
recovery sweep once, and verify the system-lane counter advances before
redeploying Web. Do not delete the item, edit a mailbox counter, send an
unrelated member message, or add another repair queue.

After a Web rollback, keep the exact compatible runner fingerprint and prove
one existing meal-photo import, one ordinary conversation, and one projection
rebuild against a vault containing a consumed report. The Manual correction
must remain authoritative, existing canonical imports must still scan the
strict event ledger, and restoring compatible Web must require no event rewrite
or migration. Mailbox drain is progress evidence only; it never relaxes this
persisted-state rollback floor.

The scheduled Linq authority release has a Web-first hard gate. Deploy and
verify Web's concrete-target/directness response before deploying Cloudflare
with `container_rollout=immediate`. After that deploy, runner admission rejects
and restarts a warm runner whose bundle fingerprint is stale; require managed
container smoke to report the expected new fingerprint before considering the
fleet converged. A new runner against old Web fails closed and retries before
model or provider work, but a misordered or slow rollout can exhaust the bounded
retry window and let an occurrence expire. Keep the new Web response as the
rollback floor while the new runner is active. If rollback is unavoidable,
roll back Cloudflare first, prove the old runner fingerprint, and only then roll
back Web; this restores the prior cron failure risk, so a forward fix is
preferred. After convergence, smoke one personal scheduled reminder and one
group automation, and confirm there are no new
`ASSISTANT_LINQ_ENGAGEMENT_ASSERT_UNAVAILABLE` or
`ASSISTANT_LINQ_AUDIENCE_AUTHORITY_UNAVAILABLE` failures.

The activity/workout semantic-marker rollout is producer-first and has no
feature flag. Deploy its compatibility release to Web before Cloudflare so Web
preserves the optional markers in encrypted share snapshots. Then deploy
Cloudflare with `container_rollout=immediate`, prove the new runner fingerprint,
and confirm a canary projection contains `broad-movement` activity and
`canonical-workout-day` workout records. Use `/ops/runtime-maintenance` in its
existing bounded batches to wake every current checkpointed grantor, retry
failures, and verify with aggregate evidence that all current activity/workout
snapshots were replaced after cutover. Readers remain legacy-compatible during
this drain. Deploy exact-marker rejection only as a separate consumer release
after the legacy count is zero. Do not replace this sequence with a rollout
flag, read-triggered member fanout, polling, or another backfill owner.

The first automatic meal-photo release must deploy Cloudflare Worker and runner support with `container_rollout=immediate` and pass managed-container smoke before enabling or deploying the web producer that appends `meal-photo.captured`. The first runner bundle that parses and imports that mailbox kind is the rollback floor while any meal-photo item can remain retained; do not roll below it independently. The web-to-Worker staging/deletion routes are additive, so the new Worker may safely precede web. After deployment, verify the runner-bundle fingerprint and absence of hosted mailbox parse failures before exercising the physical-device opt-in/upload smoke.

Shared preference causal writes are hard-cut. Web always emits sparse deltas,
Settings always exposes personality controls, and the runtime forwards only the
terminal input id from a locally revalidated bounded exact-successor provider
batch. The Web callback accepts no numeric sequence fallback: inside the
mutation transaction it resolves the callback member and keyed assistant-input
lookup to one live conversation-lane row, then derives that row's canonical
sequence. The retired direct-vault causal-sequence action and legacy snapshot
producer path stay deleted. Keep Web at the hard-cut floor during any runner
rollback. Deploy behavior-changing consumer updates with
`container_rollout=immediate`, prove the runner fingerprint, and smoke Settings
and conversational changes to the same field so the later accepted intent wins
in both the Web projection and canonical vault.

The first production release that writes `murph.inbox-capture.v2` records or
`parser-result` assistant-input evidence must use
`container_rollout=immediate`. Once either durable shape has been written, that
release is the runner rollback floor: do not deploy an older runner that lacks
both readers. An incident rollback may move web or Worker code independently
only while the runner bundle stays at or above that floor. Before enabling
traffic, require managed-container smoke to report the new runner-bundle
fingerprint; afterward, smoke one capture, projection rebuild, and assistant
candidate scan so both durable readers are proved on the deployed bundle.

Approval-outcome mailbox wakes are unconditional. Keep Web at the permanent
read-route floor or newer while compatible runtime or pending approval work can
depend on it, and do not roll Cloudflare/runner below the first bundle that parses
`runtime.pending-effects-reconcile-requested`. System-lane lag records import
progress only: the imported wake may remain pending in
`hosted-system-mailbox.json` and in a committed hot workspace snapshot after lag
reaches zero. Roll back to that compatible bundle or newer, or forward-fix. A
below-floor rollback needs a separate migration and proof covering server rows,
imported local pending items, committed snapshots, and in-flight producers;
zero lag is not sufficient. Removing the web floor also requires a
separate migration or forward runtime that removes the read-route dependency.

Archived integration-ingest amendment receipts are a runner-bundle restore format change. The first production deploy that can emit `allowArchivedIntegrationIngestAmendment` hosted canonical write receipts must deploy Cloudflare/runner with `container_rollout=immediate`; Vercel/web has no ordering dependency for that change. Gradual container rollout is unsafe for the first deploy because warm old runner bundles can still restore a workspace checkpoint that carries a legacy or interrupted receipt-log ref without preserving the archived-amendment flag. New idle checkpoints snapshot the canonical vault state and omit pending receipt-log refs from committed workspace status, so the rollback floor only applies if a production workspace already has a committed archived-amendment receipt-log ref. After deployed managed-container smoke reports the new runner-bundle fingerprint, later ordinary deploys may return to gradual rollout. Post-deploy checks: run managed-container smoke and inspect hosted runtime restore logs for archived-ingest append-base mismatch or `INTEGRATION_INGEST_SHARD_ARCHIVED` errors.

Before the private production deploy job attaches the GitHub environment, protected-main-only Blacksmith predeploy gates run the hosted-local E2E checks against one immutable public Murph revision and the private worker. Worker deploy runs also run a Blacksmith runner smoke gate, which assembles the runner bundle from that revision, prepares the stable base image, then runs the focused Cloudflare checks in parallel with `pnpm --dir apps/cloudflare runner:docker:smoke:prepared-base`. That smoke builds the app smoke image, overlays test entrypoints into an isolated `.deploy/runner-smoke-bundle/`, and executes the hosted runner inside Docker without production secrets.
The private workflow's explicit immediate path may skip the slower E2E and runner smoke gates only while retaining the protected-main hosted Codex auth regression with `MURPH_RUN_HOSTED_CODEX_AUTH_E2E=1`; normal production dispatches keep the full gates.
The Blacksmith production deploy job verifies both protected-main checkouts, assembles and validates `.deploy/runner-bundle/`, and prepares the stable native base image in the same job for every Worker deploy. Build steps do not receive production secrets. The job then renders env-specific deploy config and Worker secrets, dry-runs the generated Wrangler deploy bundle, deploys directly with Wrangler, and runs deployed endpoint smoke. Render-only workflow runs skip the runner build while still executing focused Cloudflare checks in the deploy job.

Gradual deploys run managed-container smoke with a longer retry window so Cloudflare has time to surface a container running the newly deployed version and expected runner-bundle fingerprint. The direct-R2 deployed smoke still runs only for `container_rollout=immediate`. The normal deploy path also proves the runner image with the protected-main runner smoke gate before the production environment attaches.

## Smoke

`pnpm --dir apps/cloudflare deploy:smoke` validates only the surviving execution-plane surface:

- `GET /`
- `GET /health`
- if `HOSTED_EXECUTION_SMOKE_RUNNER_CONTAINER=true`, one signed `POST /internal/deploy/container-smoke` that waits until the Cloudflare-managed runner container reports the expected runner-bundle fingerprint and assistant CLI surface hot-path schema proof
- the managed-container runner smoke also proves the native
  `murph-group-read` profile and thread-start attestation used by Assistant Ask:
  intended root reads succeed while writes, `.runtime/**`, `.codex/**`, environment
  files, other roots, inherited shell secrets, and tool network are denied
- if `HOSTED_EXECUTION_SMOKE_DIRECT_R2_PRESIGNED_PUT=true`, a managed-container smoke uploads a deterministic payload through a direct R2 presigned `PUT`, verifies it through the Worker R2 binding, and deletes the object
- if `HOSTED_EXECUTION_SMOKE_LIVE_MODEL_TURN=true`, the managed-container smoke runs one real `gpt-5.6-terra` turn via `codex exec` inside the deployed container through the Worker OpenAI egress intercept
- if `HOSTED_EXECUTION_SMOKE_USER_ID` is configured, one authenticated `GET /internal/users/:userId/status`

The GitHub deploy workflow enables `HOSTED_EXECUTION_SMOKE_RUNNER_CONTAINER` for every Worker deploy and sets a longer managed-container retry window for gradual rollouts. It enables `HOSTED_EXECUTION_SMOKE_DIRECT_R2_PRESIGNED_PUT` only when `container_rollout=immediate`, and `HOSTED_EXECUTION_SMOKE_LIVE_MODEL_TURN` per the `live_model_turn` input (default on).

Optional smoke env:

- `HOSTED_EXECUTION_SMOKE_WORKER_BASE_URL` to target a non-default public Worker URL
- `HOSTED_EXECUTION_SMOKE_USER_ID` to enable the authenticated status check
- `HOSTED_EXECUTION_SMOKE_OIDC_TOKEN` or `VERCEL_OIDC_TOKEN` for authenticated status auth
- `HOSTED_EXECUTION_SMOKE_RUNNER_CONTAINER=true` to run the deploy-signed managed-container health/fingerprint smoke
- `HOSTED_EXECUTION_SMOKE_DIRECT_R2_PRESIGNED_PUT=true` to extend the managed-container smoke with the direct R2 presigned upload check; requires `HOSTED_EXECUTION_SMOKE_RUNNER_CONTAINER=true`
- `HOSTED_EXECUTION_SMOKE_LIVE_MODEL_TURN=true` to extend the managed-container smoke with one real `gpt-5.6-terra` turn; requires `HOSTED_EXECUTION_SMOKE_RUNNER_CONTAINER=true`
- `HOSTED_EXECUTION_SMOKE_VERSION_ID` to pin smoke requests to a version in the active deployment; the deploy workflow passes the freshly deployed version
- `HOSTED_EXECUTION_SMOKE_RUNNER_MAX_ATTEMPTS` and `HOSTED_EXECUTION_SMOKE_RUNNER_RETRY_DELAY_MS` to override the managed-container rollout wait
- `HOSTED_EXECUTION_SMOKE_RUNNER_MAX_WAIT_MS` to bound that wait by wall clock (default 20 minutes). The Node smoke client disables its dispatcher's implicit response-header and response-body timers for this long-running request and applies this wall-clock budget as the explicit abort deadline. Keep it under the deploy job timeout: the attempt ceiling alone can outlast the job, which makes a non-converging rollout surface as a cancelled job with no reason instead of a named smoke failure. Each attempt addresses its own smoke Durable Object, so retries get a fresh container instead of re-reading one pre-rollout container for the whole run.

If neither managed-container smoke nor `HOSTED_EXECUTION_SMOKE_USER_ID` is configured, smoke stops after the public banner and health checks.

## Container Operator Access

Wrangler SSH is intentionally disabled for both runner Container classes. The
checked-in scaffold and generated deploy config must set `ssh.enabled` to
`false`, contain no `authorized_keys`, and expose no environment input that can
re-enable the capability. This explicit setting is required because Cloudflare
enables Wrangler SSH by default.

Keep `containers_pid_namespace` enabled independently of SSH. Murph's current
compatibility date predates Cloudflare's default for isolated Container PID
namespaces, and removing the flag would change process topology and widen
`/proc` visibility rather than merely remove operator access.

Use bounded structured runtime logs, Durable Object status, Container
application and instance inventory, and the managed deploy smoke for production
diagnosis. Do not add an operator shell or per-deploy SSH key escape hatch.
