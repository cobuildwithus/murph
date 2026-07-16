# Deploying The Cloudflare Execution Plane

This document covers the narrow Cloudflare deploy surface for hosted execution.

- `apps/web` remains the canonical owner of hosted product facts and lifecycle state.
- `apps/cloudflare` owns execution coordination, encrypted runtime blobs, the native runner container, and the public/internal execution routes described in [README.md](./README.md).

## What The Deploy Flow Produces

`pnpm --dir apps/cloudflare deploy:artifacts` renders:

- `apps/cloudflare/.deploy/wrangler.generated.jsonc`
- `apps/cloudflare/.deploy/worker-secrets.json`
- `apps/cloudflare/.deploy/runner-bundle/`

That rendered surface is then used by:

- `pnpm --dir apps/cloudflare r2:lifecycle:apply`
- `pnpm --dir apps/cloudflare deploy:worker`
- `pnpm --dir apps/cloudflare deploy:smoke`

The rendered deploy helper path is the canonical direct Wrangler deploy contract. The checked-in Wrangler scaffold remains useful for local development, but production deploys should use the rendered config so hosted email send bindings stay environment-specific and sender-restricted.
`deploy:worker:apply` validates the generated Wrangler config, worker secrets payload, and `.deploy/runner-bundle/` manifest before invoking Wrangler. The runner bundle manifest records the assembled workspace closure and source/bundle fingerprints. Production assembly now builds the runner bundle first and renders those exact fingerprints into the Worker config; applying after a stale hosted-local bundle, a smoke-mutated bundle, or a config rendered for another bundle fails before upload.
The deploy helper also rejects generated config or secrets that no longer match the current environment, and rejects runner bundles assembled with `runner:bundle:assemble-only` so smoke-only build shortcuts cannot be uploaded as production artifacts.
Docker runner smoke derives a separate `.deploy/runner-smoke-bundle/` from the validated production bundle and overlays smoke-only entrypoints there, so the production `.deploy/runner-bundle/` remains the deploy artifact after smoke.
Runner bundle assembly esbuild-bundles two boot-critical surfaces with byte budgets and assembly-time probes: the in-container `vault-cli` binary (`scripts/runner-bundle/bundle-cli.ts`) and the container entrypoint itself (`scripts/runner-bundle/bundle-entrypoint.ts`, output `dist-bundled/`, run by the image CMD). The bundled entrypoint cuts cold-boot module loading from ~960 file reads to ~27 chunk reads on lazily pulled image layers; package resolvers that derive asset paths from their own module location are pinned to the installed package copies via Dockerfile ENV (`MURPH_ASSISTANT_SKILLS_ROOT`, `MURPH_ASSISTANT_CLI_SURFACE_PREBUILT_ARTIFACT_PATH`, `MURPH_HEALTH_COMMONS_PACKAGE_ROOT`). Health Commons stays installed in the runner bundle for its generated catalog payload, while its JS is inlined and assembly probes set the same package-root pin for bundled and unbundled parity.
The device-sync package boundary suite also walks the static source graph from the runner's runtime-config entrypoint and rejects provider runtime modules, importer modules, and the Junction SDK. This focused gate catches boot-closure ownership regressions before the packed-bundle guard validates the final esbuild metafile.
Hosted assistant delivery recovery now relies on committed side-effect state inside the encrypted workspace and the web-owned hosted workspace checkpoint.

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

## Assistant Ask Rollout

Assistant Ask adds paired mailbox kinds and a one-shot process inside the
existing runner container. It adds no Cloudflare binding, secret, Durable
Object state, second container, scheduler, or workflow. Roll out the first
release in this order:

1. Deploy the Assistant Ask consumers, isolated executor, and
   `murph-group-read` profile in the Cloudflare Worker and runner bundle with
   `container_rollout=immediate`. Keep the Web producer gate off.
2. Require managed-container smoke to report the new runner-bundle fingerprint
   and prove the named profile can read the intended committed group context
   while writes, `.runtime/**`, `.codex/**`, environment files, other roots,
   inherited shell secrets, and tool network fail closed. The thread-start
   attestation must confirm the effective profile, exact roots, empty working
   directory, empty instruction sources, and approval policy.
3. Deploy the Web producer and completion control path with
   `HOSTED_ASSISTANT_ASK_PRODUCER_ENABLED` unset or `0`.
4. After the consumer fleet and sandbox proof converge, set the Web gate to
   exact `1` and redeploy Web. Smoke one private-to-group ask while the group
   runtime is idle and one while its foreground Murph is replying; neither may
   create group-visible activity or delay the foreground reply.

An old runner cannot parse the new mailbox kinds, so the producer must not be
enabled before immediate runner convergence. After enablement, the first
compatible runner bundle is the rollback floor while an Ask request or
completion can remain in a mailbox or restored workspace. To roll back, set the
Web producer gate to `0` and redeploy Web first, wait at least the full ten-minute
request lifetime, verify pending Ask work has drained or expired, then roll back
the consumers. A forward fix is preferred if any imported item remains.

## Consented Group Disclosure Rollout

The group-to-member adapter reuses Assistant Ask and adds no Cloudflare binding,
secret, Durable Object state, scheduler, workflow, or second container. Its
producer gate is distinct from the original private-to-group Ask gate.

1. Deploy Cloudflare/runner consumers for the `consented_member` request target,
   prepare disclosure context, the private candidate plus fresh outgoing
   reviewer, and `deliveryMode: "reviewed_exact"` group completion with
   `container_rollout=immediate`. Keep the Web producer gate off.
2. Deploy the Web storage, consent-reaction, admission, prepare, and completion
   paths with `HOSTED_GROUP_DISCLOSURE_PRODUCER_ENABLED` unset or `0`. The
   deployment must remain able to consume both old Assistant Ask payloads and
   the additive new shapes.
3. Require managed-container smoke to report the new runner-bundle fingerprint
   and preserve the existing `murph-group-read` confinement proof. Verify the
   outgoing reviewer starts with an empty runtime root and no personal
   workspace, application tools, delivery route, inherited secrets, or network.
4. After Web and the immediate runner fleet converge, set the gate to exact `1`
   and redeploy Web. Smoke one exact permission-message Like by a current
   member, one allowed ask whose bytes reach the originating group unchanged,
   one out-of-permission denial, and one revoke followed by a rejected ask.

To roll back, set the Web gate to `0` and redeploy Web first. Do not delete
permission or grant rows: they remain member-managed product truth and cannot
erase already shared answers. Keep compatible Web and runner consumers until
every consented request and reviewed-exact completion has drained or expired
from Web mailboxes, imported local pending items, and committed workspace
snapshots. Wait at least the full ten-minute request lifetime and prefer a
forward fix if any imported item remains.

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
and imports the synthetic `Yes.` as an ordinary message.

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

1. Create the Worker service and the two R2 buckets used for encrypted hosted runtime objects.
2. Apply `apps/cloudflare/r2-bundles-lifecycle.json` to the real bundles buckets, or run the normal worker deploy path, which reapplies it before deploying the Worker.
3. Decide the public Worker URL, either `*.workers.dev` or a custom domain.

The checked-in lifecycle file contains two narrow backstops. Raw hosted-email blobs and their encrypted recovery refs under `hosted-email/messages/` become deletion-eligible after 24 hours. Encrypted automatic meal-photo staging under `hosted-meal-photos/images/` becomes deletion-eligible after 31 days, one day beyond canonical mailbox recovery retention; successful imports still delete those objects immediately after checkpoint. R2 deletes eligible objects asynchronously. Raw email cleanup is lifecycle-backed plus account-deletion cleanup, and meal-photo staging is post-checkpoint deleted plus lifecycle- and account-deletion-backed; the rest of the encrypted objects in `BUNDLES` remain owner-cleaned or durable by design.

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
- `HOSTED_R2_PRESIGN_ACCOUNT_ID`
- `HOSTED_R2_PRESIGN_BUCKET_NAME`

`CF_PUBLIC_BASE_URL` is required for the standard deploy-and-smoke flow because smoke targets the public Worker URL after deploy. Runner internal-host requests use Cloudflare Container outbound interception instead of a public Worker callback route.
`HOSTED_R2_PRESIGN_ACCOUNT_ID` must match `CLOUDFLARE_ACCOUNT_ID`, and `HOSTED_R2_PRESIGN_BUCKET_NAME` must match `CF_BUNDLES_BUCKET`; direct-R2 workspace snapshots upload and restore through presigned URLs and are verified through the Worker R2 binding. Local S3-compatible endpoint flags are hosted-local only and must not be set for deploys.
For production deploys, `HOSTED_WEB_BASE_URL` must exactly match the normalized
origin in `HOSTED_WEB_PRODUCTION_BASE_URL`; production preflight also rejects
HTTP, localhost, `host.docker.internal`, loopback, preview/development, and
private-network Worker and hosted web origins, including DNS names
that resolve to private-network addresses.
The single member-scoped computer-use profile change is a greenfield hard cut,
not an old-Web/old-Worker compatibility rollout. Keep hosted computer-use
traffic paused during the Web/Worker skew window and finish the Worker deploy
immediately after the hosted web deploy.
Normal deploy smoke targets the public Worker banner and health endpoints after deploy, then runs managed-container smoke for both gradual and immediate rollouts: `deploy:smoke` signs `/internal/deploy/container-smoke`, starts the Cloudflare-managed runner container, verifies the deployed assistant CLI surface contract still includes detailed hot-path schemas for onboarding saves and device setup, and compares the reported runner-bundle fingerprint with the freshly rendered `.deploy/runner-bundle` manifest. When the workflow runs with `container_rollout=immediate`, managed-container smoke also runs the direct-R2 upload check.

The Worker also enforces that fingerprint contract on the normal user path. Before a warm or newly started runner receives a workspace invocation, its `/health` response must report the bundle and source fingerprints embedded in the generated Worker config. A stale warm shell is destroyed and restarted; a cold shell that still mismatches fails closed without receiving user work. Post-deploy smoke remains the rollout proof, while per-invocation admission prevents the window between a direct Worker deploy and that smoke from serving work through an old runner.

The production smoke also runs one real `gpt-5.6-terra` model turn inside the deployed runner container (`HOSTED_EXECUTION_SMOKE_LIVE_MODEL_TURN=true`, set by the deploy workflow's `live_model_turn` input, default on). The container runs a single non-interactive `codex exec` in a scratch workspace with the injected-credential placeholder; the Worker egress intercept authorizes exactly one deploy-smoke fenced `POST /v1/responses` request for `gpt-5.6-terra` and injects the real Worker-owned `OPENAI_API_KEY`, so the smoke proves the rollout target's OpenAI auth, account availability, quota, request compatibility, and network path without the raw key ever entering the container. The container accepts the smoke only when Codex JSONL reports the final agent output as exactly `OK`. Cost posture: exactly one bounded model turn per production deploy; the flag is never set in per-PR CI or hosted-local E2E, so those paths are byte-for-byte unchanged.

## Required GitHub Environment Secrets

Set these in the selected GitHub environment as secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK`
- `HOSTED_LOG_FINGERPRINT_SECRET`
- `HOSTED_R2_PRESIGN_ACCESS_KEY_ID`
- `HOSTED_R2_PRESIGN_SECRET_ACCESS_KEY`
- `HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK`
- `MURPH_DATA_API_KEY`
- `OPENAI_API_KEY`

The callback-signing key remains part of the required worker secret surface because Cloudflare reads mailbox items, side inputs, workspace checkpoints, and runtime logs through the signed hosted-web boundary. It is no longer documented as a broad lifecycle or correctness callback seam.
The Cloudflare automation private JWK is only used to unwrap the `cloudflare-automation-secret` recipient on signed ingress/runtime domain-root envelopes returned by hosted web.
`OPENAI_API_KEY` is required by the standard Worker deploy preflight because the hosted assistant provider path expects Worker-owned OpenAI egress interception. The runner container still receives only an injected-credential placeholder; the raw key stays in the Worker.
`HOSTED_LOG_FINGERPRINT_SECRET` is required so prompt-cache diagnostics can persist stable, Worker-owned request fingerprints without logging prompts, messages, request bodies, headers, or raw identifiers. It must stay out of hosted runtime env.
`MURPH_DATA_API_KEY` is required so the Worker can authorize the internal `murph-data-api.worker` product label lookup endpoints (`/api/foods` and `/api/supplements`) without exposing the key to the runner. Hosted web must have `MURPH_LABELS_DB_URL` before serving either route; `MURPH_SUPPLEMENT_DB_URL` is not a runtime fallback.
Hosted generated-image uploads additionally need optional Worker-owned Cloudflare Images config: `CLOUDFLARE_IMAGES_ACCOUNT_ID`, Worker secret `CLOUDFLARE_IMAGES_API_KEY`, and optional `CLOUDFLARE_IMAGES_VARIANT`. Cloudflare credentials are never forwarded into the runner. Without those values the generation call itself still runs and is billed; the subsequent upload fails with a clear `Generated image upload is not configured` error, so configure Images before enabling image generation in production. The runner cannot see Worker env, so a pre-generation availability check would need a worker-to-container capability field; add that plumbing only if unconfigured-deploy spend shows up in traces.

## Optional Vars

Core execution tuning:

- `CF_COMPATIBILITY_DATE` defaults to `2026-03-27`
- `CF_CONTAINER_INSTANCE_TYPE` defaults to `{"vcpu":1,"memory_mib":3072,"disk_mb":6000}`
- `CF_CONTAINER_MAX_INSTANCES` defaults to `1000`
- `CF_CONTAINER_SSH_PUBLIC_KEY` optionally adds one `ssh-ed25519` public key to
  both runner Container `authorized_keys` entries for Wrangler SSH debugging.
  The deploy renderer keeps only the key type and key body, so local key
  comments are not copied into the generated Wrangler config. When this is set,
  deploy automation also adds the `containers_pid_namespace` compatibility flag
  so SSH debug sessions do not see unrelated VM processes.
- `CF_CONTAINER_SSH_KEY_NAME` optionally sets the displayed key name for
  `CF_CONTAINER_SSH_PUBLIC_KEY`; use a neutral lowercase slug. Defaults to
  `local-debug`.
- `CF_MAX_EVENT_ATTEMPTS` defaults to `3`
- `CF_RETRY_DELAY_MS` defaults to `30000`
- `CF_WEB_CONTROL_TIMEOUT_MS` defaults to `30000`
- `CF_RUNNER_COMMIT_TIMEOUT_MS` defaults to `45000` and must exceed
  `CF_WEB_CONTROL_TIMEOUT_MS` by at least 5 seconds
- `CF_RUNNER_READY_TIMEOUT_MS` defaults to `20000`
- `CF_ALLOWED_RUNNER_SECRET_KEYS` to seed `HOSTED_EXECUTION_ALLOWED_RUNNER_SECRET_KEYS` in the rendered worker config
- `HOSTED_EXECUTION_CONTAINER_ROLLOUT` controls the one-off Wrangler container rollout flag during deploy. While the vault-share selector-scope migration is active, production deploy helpers default to `immediate` and production preflight rejects explicit `gradual`; use `gradual` only for non-production deploys or after the selector-scope rollout guard is removed.
- `HOSTED_EXECUTION_RUNNER_ENV_PROFILES` adds deploy-time profiles on top of the runtime's minimal `assistant` baseline; deploy automation defaults to `exa,hosted-email,linq,mapbox,telegram`. Hosted device-sync runtime config is resolved from worker env directly rather than a runtime-env profile.
- `HOSTED_EXECUTION_RUNNER_IDLE_TTL_MS` defaults to `300000` (production `wrangler.jsonc` sets `1200000`) and controls runner container activity expiry for native shell cleanup. Dirty foreground runtime state is checkpointed by the runtime-owned idle-floor—or last-chance shutdown—`idle_shutdown` path before the invocation returns. The exact assistant wake projected by the current foreground phase may run once before the floor without checkpointing; inherited or committed wakes and durability barriers remain checkpoint-first. RunnerContainer activity expiry only yields to active foreground work or tears down an idle warm shell; it never records pending checkpoint intent.
- `HOSTED_EXECUTION_VERCEL_OIDC_ENVIRONMENT` defaults to `production`
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
- `HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID`
- `HOSTED_CRYPTO_ENV`

Hosted assistant config:

- `HOSTED_ASSISTANT_PROVIDER`
- `HOSTED_ASSISTANT_MODEL`; worker deploy preflight requires an explicit allowance-priced direct OpenAI model slug. Supported slugs are `gpt-5.5`, `gpt-5.6-sol`, `gpt-5.6-terra`, and `gpt-5.6-luna`. Production deploys require `HOSTED_ASSISTANT_REASONING_EFFORT=low`.
- `HOSTED_ASSISTANT_APPROVAL_POLICY`
- `HOSTED_ASSISTANT_REASONING_EFFORT`
- `HOSTED_ASSISTANT_SANDBOX`

When changing hosted assistant model pricing or allowance enforcement, deploy the
Cloudflare Worker/runner model config before or atomically with the hosted web
allowance logic so runtime usage callbacks keep using an allowance-priced model.

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

- `EXA_API_KEY`, `LINQ_API_TOKEN`, `MAPBOX_ACCESS_TOKEN`, and `TELEGRAM_BOT_TOKEN` when those hosted runtime integrations are enabled. These are Worker-owned intercept credentials, not raw child-container env. Exa egress is limited to `POST /search`.

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
- `LINQ_API_TOKEN`
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
export HOSTED_WEB_BASE_URL=https://web.example.test
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
# HOSTED_LOG_FINGERPRINT_SECRET, HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK,
# OPENAI_API_KEY.
# Optional hosted generated-image upload support also uses
# CLOUDFLARE_IMAGES_ACCOUNT_ID, CLOUDFLARE_IMAGES_API_KEY, and optionally
# CLOUDFLARE_IMAGES_VARIANT.

pnpm --dir apps/cloudflare deploy:preflight
pnpm --dir apps/cloudflare deploy:artifacts
```

Local deploys and Docker smoke checks also prepare the stable native base image:

```bash
pnpm --dir apps/cloudflare runner:docker:base
```

That image is prepared in the local Docker cache under the stable GHCR tag
`ghcr.io/cobuildwithus/murph-cloudflare-runner-base:node24.14.1-codex0.144.0`,
which is also the final app-layer Dockerfile default. Using the pullable GHCR
name avoids BuildKit treating the prepared base as a Docker Hub `library/*`
image during local Wrangler container builds.
It contains Node, Python 3 exposed as both `python3` and `python`, pinned `@openai/codex` with its bundled Linux sandbox resources, `jq`, `ripgrep`, `ffmpeg`, and PDF tooling from Poppler plus `file`, `qpdf`, and MuPDF tools, but no app bundle, worker secrets, or local speech models.
The final app-layer image generates a patched Codex model catalog from `codex debug models --bundled`, adds OpenAI flex service-tier support for `gpt-5.5`, `gpt-5.6-sol`, `gpt-5.6-terra`, and `gpt-5.6-luna`, validates those entries with `jq`, and exposes it through `MURPH_HOSTED_CODEX_MODEL_CATALOG_JSON` so hosted app-server cron turns can send OpenAI `service_tier: flex` and the deploy smoke can exercise Terra through the same model catalog. Hosted Codex MultiAgent V2 is enabled by default in generated hosted Codex config, and hosted app-server launches also pass `--config features.multi_agent_v2=true` so warm app-server processes restart after the default changes.
`runner:docker:base` first reuses a GHCR-published base image when its source-fingerprint label matches the checked-out `Dockerfile.cloudflare-hosted-runner-base`; otherwise it rebuilds locally. Pass `-- --force` to rebuild from the checked-out Dockerfile without adopting a GHCR base image; deploy-capable production paths use that forced path so GHCR stays a CI/local cache instead of production image authority. Pull-request hosted-local E2E does not authenticate to GHCR before running PR-controlled code, so the GHCR runner base package must be public for fast anonymous PR cache pulls. The protected-main `.github/workflows/cloudflare-runner-base-image.yml` workflow publishes the base image with `GITHUB_TOKEN`.
The base image build runs `python3 --version`, `python --version`, `jq --version`, `rg --version`, `zstd --version`, `codex --version`, `codex app-server --help`, and `codex doctor --help` under the runner user, and the Docker smoke repeats the Python and ripgrep checks inside the final image before deploy while also proving `file`, `pdfinfo`, `pdftotext`, `pdftoppm`, `qpdf`, and `mutool` against the restored smoke PDF fixture.
Run `pnpm --dir apps/cloudflare test:e2e:runner-python:local` when you specifically want the actual final hosted-runner app image `PATH` proof for Python. It assembles the runner bundle, builds the same `linux/amd64` app-layer Dockerfile used by the Cloudflare container, starts the image with its normal entrypoint, waits for `/health`, then checks Python as the non-root `runner` user from immutable `/app` with the baked runner env. Run `pnpm --dir apps/cloudflare runner:docker:smoke` when you want the broader final-image native smoke. That disposable, networkless smoke relaxes the outer Docker seccomp profile so Codex can create its inner user namespace, matching the namespace capability available in Cloudflare's dedicated Linux VM. The nested Codex seccomp proof requires a native `linux/amd64` Docker host; AMD64 emulation on an ARM64 Docker daemon does not support that inner seccomp layer.

After first publish, make the GHCR runner base package public so PR CI can use
anonymous pulls without exposing package credentials to PR-controlled commands.

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
- assembles the runner bundle, building and packing the runner workspace closure with bounded parallelism (`MURPH_RUNNER_BUNDLE_BUILD_CONCURRENCY` and `MURPH_RUNNER_BUNDLE_PACK_CONCURRENCY`, both defaulting to `4`); runner-specific CLI and Health Commons tarballs keep the deployed `murph` / `vault-cli` and catalog surfaces without the public npm package's nested bundled workspace payload or web-only Health Commons artifacts
- prepares the stable native runner base image with Docker's local cache; production deploy paths force that build from source, while hosted-local E2E lanes may reuse the GHCR-published runner base image when the source fingerprint matches the current checkout
- deploys the Worker directly with Wrangler; production deploys currently default to immediate container rollout for the vault-share selector-scope migration, while non-production deploys default to gradual and build only the small app image layer from the prepared runner bundle

The gradual container rollout keeps `rollout_active_grace_period` at 300 seconds and rolls runner instances through `10`, `25`, `50`, then `100` percent. The manual workflow exposes a `container_rollout` input; its production default is currently `immediate` because selector-scoped vault-share deliveries are unsafe under gradual runner rollout. Selecting `immediate` passes Wrangler's `--containers-rollout=immediate` flag and can interrupt active runner containers.
During gradual rollout, Worker code and runner container state may disagree for the rollout window. A newly deployed Worker version can handle provider egress or internal-host traffic from an already-running warm runner process whose bundle, process env, or provider-credential shape was created before the deploy. Treat this as expected rollout behavior, not proof that traffic is reaching an old Worker version. Any PR that changes a Worker/container contract, runner env shape, hosted provider credential, internal host route, parser/toolchain path, or bundle-owned runtime assumption must document the compatibility window in its PR description and final `DEPLOYMENT CONCERNS:` handoff: whether old containers can safely talk to new Worker code, whether new containers can safely talk to old web/control-plane code, whether `container_rollout=immediate` is required, and which deploy-smoke or Workers Observability checks prove the fleet has converged.

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

The first automatic meal-photo release must deploy Cloudflare Worker and runner support with `container_rollout=immediate` and pass managed-container smoke before enabling or deploying the web producer that appends `meal-photo.captured`. The first runner bundle that parses and imports that mailbox kind is the rollback floor while any meal-photo item can remain retained; do not roll below it independently. The web-to-Worker staging/deletion routes are additive, so the new Worker may safely precede web. After deployment, verify the runner-bundle fingerprint and absence of hosted mailbox parse failures before exercising the physical-device opt-in/upload smoke.

The first shared preference-causal-sequence release uses a Web-first hard cut.
Vercel predeploy adds nullable `causal_seq` state, the nullable keyed
assistant-input lookup projection, and nullable Humor, Push, and Detail
projection watermarks, then deploys Web with
`MURPH_ASSISTANT_PERSONALITY_CAUSAL_WRITES_ENABLED=0`. New conversation rows
store a server-keyed lookup of their existing deterministic assistant input id,
never the raw id, without changing the mailbox wire, `sourceRef`, or event id.
The Web callback accepts no numeric sequence fallback: inside the mutation
transaction it derives every configured lookup-key candidate from the callback
id, resolves the callback member plus one matching key to one live
conversation-lane `conversation.message` row, and derives that row's canonical
sequence. The hard-cut route also rejects the retired direct-vault
causal-sequence action after old Vercel functions drain. This Web build is the
rollback floor. The post-deploy contract lane checks legacy work against the
system-lane `consumed_seq`, adds the new-write constraint `NOT VALID`, and seeds
all three personality watermarks to each member's current causal barrier,
including null projection values because historical Web values may differ from
canonical vault values and cannot be backfilled safely. Deploy this Cloudflare
worker and runner bundle next with `container_rollout=immediate` and prove fleet
convergence; for an update, it forwards only the terminal input id from a
locally revalidated bounded exact-successor provider batch. Then set the Vercel
gate to `1` and redeploy Web to switch Settings to sparse deltas and expose
personality controls plus hosted conversation convergence. Legacy runtimes
continue ordinary replies while style writes fail closed. Deploy Web and
Cloudflare/runtime in tandem to minimize that temporary unavailable-write
window, and keep Web at the hard-cut floor during any runner rollback.

The first production release that writes `murph.inbox-capture.v2` records or
`parser-result` assistant-input evidence must use
`container_rollout=immediate`. Once either durable shape has been written, that
release is the runner rollback floor: do not deploy an older runner that lacks
both readers. An incident rollback may move web or Worker code independently
only while the runner bundle stays at or above that floor. Before enabling
traffic, require managed-container smoke to report the new runner-bundle
fingerprint; afterward, smoke one capture, projection rebuild, and assistant
candidate scan so both durable readers are proved on the deployed bundle.

Approval-outcome mailbox wakes have a permanent runtime rollback floor after
`MURPH_HOSTED_ACTION_APPROVAL_OUTCOME_WAKE_ENABLED` is first enabled in
production. Before the first compatible Cloudflare deployment, deploy and verify
the gate-disabled web bundle that serves the action-approval read route. That
bundle is the matching permanent web rollback floor. Disable the web gate and
redeploy web before any rollback, but keep web at the read-route floor or newer
while compatible runtime or pending approval work can depend on it, and do
not roll Cloudflare/runner below the first bundle that parses
`runtime.pending-effects-reconcile-requested`. System-lane lag records import
progress only: the imported wake may remain pending in
`hosted-system-mailbox.json` and in a committed hot workspace snapshot after lag
reaches zero. Roll back to that compatible bundle or newer, or forward-fix. A
below-floor rollback needs a separate migration and proof covering server rows,
imported local pending items, committed snapshots, and in-flight producers;
gate-off plus zero lag is not sufficient. Removing the web floor also requires a
separate migration or forward runtime that removes the read-route dependency.

Archived integration-ingest amendment receipts are a runner-bundle restore format change. The first production deploy that can emit `allowArchivedIntegrationIngestAmendment` hosted canonical write receipts must deploy Cloudflare/runner with `container_rollout=immediate`; Vercel/web has no ordering dependency for that change. Gradual container rollout is unsafe for the first deploy because warm old runner bundles can still restore a workspace checkpoint that carries a legacy or interrupted receipt-log ref without preserving the archived-amendment flag. New idle checkpoints snapshot the canonical vault state and omit pending receipt-log refs from committed workspace status, so the rollback floor only applies if a production workspace already has a committed archived-amendment receipt-log ref. After deployed managed-container smoke reports the new runner-bundle fingerprint, later ordinary deploys may return to gradual rollout. Post-deploy checks: run managed-container smoke and inspect hosted runtime restore logs for archived-ingest append-base mismatch or `INTEGRATION_INGEST_SHARD_ARCHIVED` errors.

Before the production deploy job attaches the GitHub environment, protected-main-only Blacksmith predeploy gates run the hosted-local E2E checks. Worker deploy runs also run a Blacksmith runner smoke gate, which assembles the runner bundle from the same commit, prepares the stable base image, then runs the focused Cloudflare checks in parallel with `pnpm --dir apps/cloudflare runner:docker:smoke:prepared-base`. That smoke builds the app smoke image, overlays test entrypoints into an isolated `.deploy/runner-smoke-bundle/`, and executes the hosted runner inside Docker without production secrets.
For `pnpm cf:deploy:immediate`, the workflow skips the slower E2E and runner smoke gates but still runs the protected-main hosted Codex auth regression with `MURPH_RUN_HOSTED_CODEX_AUTH_E2E=1`. It otherwise inherits the same deploy defaults as `pnpm cf:deploy`, including the configured runner idle TTL and the default hosted-email send binding behavior.
The Blacksmith production deploy job verifies the protected-main checkout, assembles and validates `.deploy/runner-bundle/`, and prepares the stable native base image in the same job for every Worker deploy. Build steps do not receive production secrets. The job then renders env-specific deploy config and Worker secrets, dry-runs the generated Wrangler deploy bundle, deploys directly with Wrangler, and runs deployed endpoint smoke. Render-only workflow runs skip the runner build while still executing focused Cloudflare checks in the deploy job.

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

If neither managed-container smoke nor `HOSTED_EXECUTION_SMOKE_USER_ID` is configured, smoke stops after the public banner and health checks.

## Wrangler SSH Debugging

Wrangler SSH for Cloudflare Containers is an operator debug path only. It does
not expose a public port, but it does let Cloudflare account writers connect to
running Container instances when their local private key matches a public key in
the rendered Container `authorized_keys`.

Use a local `ssh-ed25519` key. If you create a dedicated key, use a neutral
comment and keep the private key outside source control:

```bash
ssh-keygen -t ed25519 -C murph-cloudflare-containers -f <SSH_PRIVATE_KEY>
ssh-add <SSH_PRIVATE_KEY>
```

Before rendering or deploying, export the public key without the local comment:

```bash
export CF_CONTAINER_SSH_PUBLIC_KEY="$(awk '{print $1 \" \" $2}' < <SSH_PUBLIC_KEY>)"
export CF_CONTAINER_SSH_KEY_NAME=local-debug
pnpm --dir apps/cloudflare runner:bundle
pnpm --dir apps/cloudflare deploy:config:render
```

`pnpm --dir apps/cloudflare deploy:worker` also renders the config, so keep
those env vars present for the deploy that should carry the debug key. After
deploying, find a running instance and connect:

```bash
pnpm --dir apps/cloudflare exec wrangler containers instances <APPLICATION>
pnpm --dir apps/cloudflare exec wrangler containers ssh <INSTANCE_ID>
```

SSH does not wake stopped Containers and does not keep an otherwise idle
Container alive. Unset `CF_CONTAINER_SSH_PUBLIC_KEY` and redeploy when the debug
window is over.
