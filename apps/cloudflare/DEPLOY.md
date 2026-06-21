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
`deploy:worker:apply` validates the generated Wrangler config, worker secrets payload, and `.deploy/runner-bundle/` manifest before invoking Wrangler. The runner bundle manifest records the assembled workspace closure and source/bundle fingerprints, so applying after a stale hosted-local bundle, a smoke-mutated bundle, or a config/secrets render newer than the bundle fails before upload.
The deploy helper also rejects generated config or secrets that no longer match the current environment, and rejects runner bundles assembled with `runner:bundle:assemble-only` so smoke-only build shortcuts cannot be uploaded as production artifacts.
Docker runner smoke derives a separate `.deploy/runner-smoke-bundle/` from the validated production bundle and overlays smoke-only entrypoints there, so the production `.deploy/runner-bundle/` remains the deploy artifact after smoke.
Runner bundle assembly esbuild-bundles two boot-critical surfaces with byte budgets and assembly-time probes: the in-container `vault-cli` binary (`scripts/runner-bundle/bundle-cli.ts`) and the container entrypoint itself (`scripts/runner-bundle/bundle-entrypoint.ts`, output `dist-bundled/`, run by the image CMD). The bundled entrypoint cuts cold-boot module loading from ~960 file reads to ~27 chunk reads on lazily pulled image layers; the two assistant-engine resolvers that derive asset paths from their own module location are pinned to the installed package copies via Dockerfile ENV (`MURPH_ASSISTANT_SKILLS_ROOT`, `MURPH_ASSISTANT_CLI_SURFACE_PREBUILT_ARTIFACT_PATH`).
Hosted assistant delivery recovery now relies on committed side-effect state inside the encrypted workspace and the web-owned hosted workspace checkpoint.

## One-Time Cloudflare Setup

Before the first deploy:

1. Create the Worker service and the two R2 buckets used for encrypted hosted runtime objects.
2. Apply `apps/cloudflare/r2-bundles-lifecycle.json` to the real bundles buckets, or run the normal worker deploy path, which reapplies it before deploying the Worker.
3. Decide the public Worker URL, either `*.workers.dev` or a custom domain.

The checked-in lifecycle file now contains one narrow backstop rule for `hosted-email/messages/`: raw hosted-email blobs and their encrypted recovery refs become deletion-eligible after 24 hours, and R2 deletes eligible objects asynchronously. Current writes use the root-independent `hosted-email/messages/{storageNamespaceId}/` shape; recovery uses the append-failure structured log's user id plus the `.recovery.json` object under that prefix, without exposing raw message ids in object paths. Removed pre-launch root-derived raw-email paths are not read during this greenfield hard cut and are bounded by the same lifecycle prefix. Raw email cleanup is lifecycle-backed plus account-deletion cleanup; the rest of the encrypted objects in `BUNDLES` remain owner-cleaned or durable by design.

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

The production smoke also runs one real `gpt-5.4-nano` model turn inside the deployed runner container (`HOSTED_EXECUTION_SMOKE_LIVE_MODEL_TURN=true`, set by the deploy workflow's `live_model_turn` input, default on). The container runs a single non-interactive `codex exec` in a scratch workspace with the injected-credential placeholder; the Worker egress intercept authorizes exactly one deploy-smoke fenced `POST /v1/responses` request for `gpt-5.4-nano` and injects the real Worker-owned `OPENAI_API_KEY`, so the smoke proves the only otherwise-uncovered boundary (real OpenAI auth, quota, and network on the production egress path) without the raw key ever entering the container. The container accepts the smoke only when Codex JSONL reports the final agent output as exactly `OK`. Cost posture: exactly one bounded model turn per production deploy; the flag is never set in per-PR CI or hosted-local E2E, so those paths are byte-for-byte unchanged.

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
- `CF_RUNNER_COMMIT_TIMEOUT_MS` defaults to `30000`
- `CF_RUNNER_READY_TIMEOUT_MS` defaults to `20000`
- `CF_ALLOWED_RUNNER_SECRET_KEYS` to seed `HOSTED_EXECUTION_ALLOWED_RUNNER_SECRET_KEYS` in the rendered worker config
- `HOSTED_EXECUTION_CONTAINER_ROLLOUT` controls the one-off Wrangler container rollout flag during deploy; omit it or set `gradual` for normal deploys, and use `immediate` only for emergency hotfixes that may interrupt active runner containers.
- `HOSTED_EXECUTION_RUNNER_ENV_PROFILES` adds deploy-time profiles on top of the runtime's minimal `assistant` baseline; deploy automation defaults to `exa,hosted-email,linq,mapbox,telegram,whatsapp`. Hosted device-sync runtime config is resolved from worker env directly rather than a runtime-env profile.
- `HOSTED_EXECUTION_RUNNER_IDLE_TTL_MS` defaults to `300000` (production `wrangler.jsonc` sets `1200000`) and controls runner container activity expiry for native shell cleanup. Dirty foreground runtime state is checkpointed by the runtime-owned idle/scheduled-wake `idle_shutdown` path before the invocation returns. RunnerContainer activity expiry only yields to active foreground work or tears down an idle warm shell; it never records pending checkpoint intent.
- `HOSTED_EXECUTION_RUNNER_RECYCLE_AFTER_SUCCESS_COUNT` defaults to `100` and recycles the native runner shell after that many clean invocations.
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
- `HOSTED_ASSISTANT_MODEL`; worker deploy preflight requires the explicit allowance-priced direct OpenAI launch model `gpt-5.5`. Production deploys must use `gpt-5.5` with `HOSTED_ASSISTANT_REASONING_EFFORT=low`.
- `HOSTED_ASSISTANT_APPROVAL_POLICY`
- `HOSTED_ASSISTANT_REASONING_EFFORT`
- `HOSTED_ASSISTANT_SANDBOX`

When changing hosted assistant model pricing or allowance enforcement, deploy the
Cloudflare Worker/runner model config before or atomically with the hosted web
allowance logic so runtime usage callbacks keep using an allowance-priced model.

Opt-in runtime integrations:

- `HOSTED_EMAIL_DEFAULT_SUBJECT`
- `HOSTED_EMAIL_DOMAIN`
- `HOSTED_EMAIL_FROM_ADDRESS`
- `HOSTED_EMAIL_LOCAL_PART`
- `LINQ_API_BASE_URL`
- `TELEGRAM_API_BASE_URL`
- `TELEGRAM_BOT_USERNAME`
- `TELEGRAM_FILE_BASE_URL`
- `WHATSAPP_API_BASE_URL`
- `WHATSAPP_GRAPH_VERSION`
- `DEVICE_SYNC_PUBLIC_BASE_URL`
- `JUNCTION_ENV`
- `JUNCTION_REGION`
- `JUNCTION_PROVIDER_FILTER`
- `JUNCTION_SUMMARY_RESOURCES`
- `JUNCTION_TIMESERIES_RESOURCES`
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

- `EXA_API_KEY`, `LINQ_API_TOKEN`, `MAPBOX_ACCESS_TOKEN`, `TELEGRAM_BOT_TOKEN`, `WHATSAPP_ACCESS_TOKEN`, and `WHATSAPP_PHONE_NUMBER_ID` when those hosted runtime integrations are enabled. These are Worker-owned intercept credentials, not raw child-container env. Exa egress is limited to `POST /search`.

Hosted usage-reporting secrets:

- `HOSTED_AI_USAGE_REPORTING_SECRET` when stable anonymized usage attribution should be added by the Worker/web-control proxy before records reach hosted web. This secret must stay Worker-owned and must not be forwarded into the hosted runtime env.
- Cloudflare runner start authority does not accept signed usage-allowance
  decisions and does not fall back to a live web usage-gate call. Web gates
  model-capable work before appending/signaling Temporal, and runtime/provider spend
  enforcement still happens before model calls.

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
- `WHATSAPP_ACCESS_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`
- `WHOOP_CLIENT_ID`
- `WHOOP_CLIENT_SECRET`
The documented deploy surface is intentionally limited to the vars and secrets above for the narrowed execution plane and its opt-in runtime integrations.

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
export HOSTED_ASSISTANT_MODEL=gpt-5.5
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
pnpm --dir apps/cloudflare deploy:config:render
pnpm --dir apps/cloudflare deploy:secrets:render
pnpm --dir apps/cloudflare runner:bundle
pnpm --dir apps/cloudflare deploy:artifacts:validate
```

Local deploys and Docker smoke checks also prepare the stable native base image:

```bash
pnpm --dir apps/cloudflare runner:docker:base
```

That image is prepared in the local Docker cache under the stable GHCR tag
`ghcr.io/cobuildwithus/murph-cloudflare-runner-base:node24.14.1-codex0.135.0`,
which is also the final app-layer Dockerfile default. Using the pullable GHCR
name avoids BuildKit treating the prepared base as a Docker Hub `library/*`
image during local Wrangler container builds.
It contains Node, Python 3 exposed as both `python3` and `python`, pinned `@openai/codex`, `jq`, `ripgrep`, `ffmpeg`, and PDF tooling from Poppler plus `file`, `qpdf`, and MuPDF tools, but no app bundle, worker secrets, or local speech models.
The final app-layer image generates a patched Codex model catalog from `codex debug models --bundled`, adds `gpt-5.5` flex service-tier support plus the `gpt-5.4-nano` deploy-smoke slug as a Responses-lite/no-search entry, validates those entries with `jq`, and exposes it through `MURPH_HOSTED_CODEX_MODEL_CATALOG_JSON` so hosted app-server turns can send OpenAI `service_tier: flex` and deploy smoke can run its bounded nano turn without unsupported hosted search tools.
`runner:docker:base` first reuses a GHCR-published base image when its source-fingerprint label matches the checked-out `Dockerfile.cloudflare-hosted-runner-base`; otherwise it rebuilds locally. Pass `-- --force` to rebuild from the checked-out Dockerfile without adopting a GHCR base image; deploy-capable production paths use that forced path so GHCR stays a CI/local cache instead of production image authority. Pull-request hosted-local E2E does not authenticate to GHCR before running PR-controlled code, so the GHCR runner base package must be public for fast anonymous PR cache pulls. The protected-main `.github/workflows/cloudflare-runner-base-image.yml` workflow publishes the base image with `GITHUB_TOKEN`.
The base image build runs `python3 --version`, `python --version`, `jq --version`, `rg --version`, `zstd --version`, `codex --version`, `codex app-server --help`, and `codex doctor --help` under the runner user, and the Docker smoke repeats the Python and ripgrep checks inside the final image before deploy while also proving `file`, `pdfinfo`, `pdftotext`, `pdftoppm`, `qpdf`, and `mutool` against the restored smoke PDF fixture.
Run `pnpm --dir apps/cloudflare test:e2e:runner-python:local` when you specifically want the actual final hosted-runner app image `PATH` proof for Python. It assembles the runner bundle, builds the same `linux/amd64` app-layer Dockerfile used by the Cloudflare container, starts the image with its normal entrypoint, waits for `/health`, then checks Python as the non-root `runner` user from immutable `/app` with the baked runner env. Run `pnpm --dir apps/cloudflare runner:docker:smoke` when you want the broader final-image native smoke.

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
- deploys the Worker directly with Wrangler, relying on the configured gradual container rollout by default, which builds only the small app image layer from the prepared runner bundle

The normal container rollout keeps `rollout_active_grace_period` at 300 seconds and rolls runner instances through `10`, `25`, `50`, then `100` percent. The manual workflow exposes a `container_rollout` input; leave it at `gradual` for ordinary deploys. Selecting `immediate` passes Wrangler's `--containers-rollout=immediate` flag and should be reserved for hotfixes where interrupting active runner containers is acceptable.

Before the production deploy job attaches the GitHub environment, protected-main-only GitHub-hosted predeploy gates run the hosted-local E2E checks. Worker deploy runs also run a GitHub-hosted runner smoke gate, which assembles the runner bundle from the same commit, prepares the stable base image, then runs the focused Cloudflare checks in parallel with `pnpm --dir apps/cloudflare runner:docker:smoke:prepared-base`. That smoke builds the app smoke image, overlays test entrypoints into an isolated `.deploy/runner-smoke-bundle/`, and executes the hosted runner inside Docker without production secrets.
For `pnpm cf:deploy:immediate`, the workflow skips the slower E2E gates but still runs a protected-main-only Blacksmith build-prep handoff. That job installs the pinned Codex CLI version declared by the runner base Dockerfile, runs the hosted Codex auth regression with `MURPH_RUN_HOSTED_CODEX_AUTH_E2E=1`, assembles `.deploy/runner-bundle/`, prepares the stable base image, and uploads only the runner bundle plus a saved base-image tarball. It does not attach the production GitHub environment and does not receive Cloudflare credentials, Worker secrets, private JWKs, or provider API keys.
The GitHub-hosted production deploy job downloads that immediate handoff only for break-glass Worker deploys, validates the runner-bundle tar entries before extraction, rejects unsafe archive entry types and symlink targets, loads the base image into Docker, validates the downloaded runner-bundle manifest against the protected-main checkout before any secret-bearing deploy preflight, renders env-specific deploy config and Worker secrets itself, refreshes the manifest timestamp for the newly rendered config, dry-runs the generated Wrangler deploy bundle, deploys directly with Wrangler, and runs the deployed endpoint smoke. This immediate path intentionally trusts protected-main Blacksmith runners for no-secret production artifact integrity, while production GitHub environment access, Worker secret rendering, Wrangler deploy, and deployed endpoint smoke remain on GitHub-hosted Ubuntu. Normal non-immediate deploys keep assembling and validating their own `.deploy/runner-bundle/` and base image inside the production deploy job after the predeploy gates pass, and render-only workflow runs skip the runner smoke/build-prep gates while still executing focused Cloudflare checks in the deploy job.

Gradual deploys run managed-container smoke with a longer retry window so Cloudflare has time to surface a container running the newly deployed version and expected runner-bundle fingerprint. The direct-R2 deployed smoke still runs only for `container_rollout=immediate`. The normal deploy path also proves the runner image with the protected-main runner smoke gate before production secrets are attached.

## Smoke

`pnpm --dir apps/cloudflare deploy:smoke` validates only the surviving execution-plane surface:

- `GET /`
- `GET /health`
- if `HOSTED_EXECUTION_SMOKE_RUNNER_CONTAINER=true`, one signed `POST /internal/deploy/container-smoke` that waits until the Cloudflare-managed runner container reports the expected runner-bundle fingerprint and assistant CLI surface hot-path schema proof
- if `HOSTED_EXECUTION_SMOKE_DIRECT_R2_PRESIGNED_PUT=true`, a managed-container smoke uploads a deterministic payload through a direct R2 presigned `PUT`, verifies it through the Worker R2 binding, and deletes the object
- if `HOSTED_EXECUTION_SMOKE_LIVE_MODEL_TURN=true`, the managed-container smoke runs one real `gpt-5.4-nano` turn via `codex exec` inside the deployed container through the Worker OpenAI egress intercept
- if `HOSTED_EXECUTION_SMOKE_USER_ID` is configured, one authenticated `GET /internal/users/:userId/status`

The GitHub deploy workflow enables `HOSTED_EXECUTION_SMOKE_RUNNER_CONTAINER` for every Worker deploy and sets a longer managed-container retry window for gradual rollouts. It enables `HOSTED_EXECUTION_SMOKE_DIRECT_R2_PRESIGNED_PUT` only when `container_rollout=immediate`, and `HOSTED_EXECUTION_SMOKE_LIVE_MODEL_TURN` per the `live_model_turn` input (default on).

Optional smoke env:

- `HOSTED_EXECUTION_SMOKE_WORKER_BASE_URL` to target a non-default public Worker URL
- `HOSTED_EXECUTION_SMOKE_USER_ID` to enable the authenticated status check
- `HOSTED_EXECUTION_SMOKE_OIDC_TOKEN` or `VERCEL_OIDC_TOKEN` for authenticated status auth
- `HOSTED_EXECUTION_SMOKE_RUNNER_CONTAINER=true` to run the deploy-signed managed-container health/fingerprint smoke
- `HOSTED_EXECUTION_SMOKE_DIRECT_R2_PRESIGNED_PUT=true` to extend the managed-container smoke with the direct R2 presigned upload check; requires `HOSTED_EXECUTION_SMOKE_RUNNER_CONTAINER=true`
- `HOSTED_EXECUTION_SMOKE_LIVE_MODEL_TURN=true` to extend the managed-container smoke with one real `gpt-5.4-nano` turn; requires `HOSTED_EXECUTION_SMOKE_RUNNER_CONTAINER=true`
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
