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

The rendered deploy helper path is the canonical rollout contract. The lower-level version helper still exists for recovery work, and the checked-in Wrangler scaffold remains useful for local development, but production deploys should use the rendered config so hosted email send bindings stay environment-specific and sender-restricted.
`deploy:worker:apply` validates the generated Wrangler config, worker secrets payload, and `.deploy/runner-bundle/` manifest before invoking Wrangler. The runner bundle manifest records the assembled workspace closure and source/bundle fingerprints, so applying after a stale hosted-local bundle, a smoke-mutated bundle, or a config/secrets render newer than the bundle fails before upload.
The deploy helper also rejects generated config or secrets that no longer match the current environment, and rejects runner bundles assembled with `runner:bundle:assemble-only` so smoke-only build shortcuts cannot be uploaded as production artifacts.
Docker runner smoke derives a separate `.deploy/runner-smoke-bundle/` from the validated production bundle and overlays smoke-only entrypoints there, so the production `.deploy/runner-bundle/` remains the deploy artifact after smoke.
Hosted assistant delivery recovery now relies on committed side-effect state inside the encrypted workspace and the web-owned hosted workspace checkpoint.

## One-Time Cloudflare Setup

Before the first deploy:

1. Create the Worker service and the two R2 buckets used for encrypted hosted bundles.
2. Apply `apps/cloudflare/r2-bundles-lifecycle.json` to the real bundles buckets.
3. Decide the public Worker URL, either `*.workers.dev` or a custom domain.

The checked-in lifecycle file now contains one narrow backstop rule for `hosted-email/messages/`: delete raw hosted-email blobs after 1 hour if eager cleanup missed them. Current writes use the root-independent `hosted-email/messages/{storageNamespaceId}/` shape; removed pre-launch root-derived raw-email paths are not read during this greenfield hard cut and are bounded by the same lifecycle prefix. Runner cleanup after terminal completion or quarantine remains the normal path, and the rest of the encrypted objects in `BUNDLES` remain owner-cleaned or durable by design.

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

`CF_PUBLIC_BASE_URL` is required for the standard deploy-and-smoke flow because smoke targets the public Worker URL after deploy.
For production deploys, `HOSTED_WEB_BASE_URL` must exactly match the normalized
origin in `HOSTED_WEB_PRODUCTION_BASE_URL`; production preflight also rejects
HTTP, localhost, `host.docker.internal`, loopback, preview/development, and
private-network Worker, hosted web, and callback origins, including DNS names
that resolve to private-network addresses.
The workflow enables `HOSTED_EXECUTION_SMOKE_RUNNER_CONTAINER=true`; deploy smoke signs `/internal/deploy/container-smoke`, starts the Cloudflare-managed runner container, and compares its reported runner-bundle fingerprint with the freshly rendered `.deploy/runner-bundle` manifest.
Because Cloudflare updates Worker code before container instances finish rolling, the runner-container smoke retries through the container rollout window and does not pass until the managed container reports the freshly deployed runner bundle.

## Required GitHub Environment Secrets

Set these in the selected GitHub environment as secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK`
- `HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK`

The callback-signing key remains part of the required worker secret surface because Cloudflare reads mailbox items, side inputs, workspace checkpoints, and runtime logs through the signed hosted-web boundary. It is no longer documented as a broad lifecycle or correctness callback seam.
The Cloudflare automation private JWK is only used to unwrap the `cloudflare-automation-secret` recipient on signed ingress/runtime domain-root envelopes returned by hosted web.

## Optional Vars

Core execution tuning:

- `CF_COMPATIBILITY_DATE` defaults to `2026-03-27`
- `CF_CONTAINER_INSTANCE_TYPE` defaults to `{"vcpu":1,"memory_mib":3072,"disk_mb":6000}`
- `CF_CONTAINER_MAX_INSTANCES` defaults to `1000`
- `CF_MAX_EVENT_ATTEMPTS` defaults to `3`
- `CF_RETRY_DELAY_MS` defaults to `30000`
- `CF_RUNNER_TIMEOUT_MS` defaults to `600000`
- `CF_WEB_CONTROL_TIMEOUT_MS` defaults to `30000`
- `CF_RUNNER_COMMIT_TIMEOUT_MS` defaults to `30000`
- `CF_RUNNER_READY_TIMEOUT_MS` defaults to `20000`
- `CF_ALLOWED_RUNNER_SECRET_KEYS` to seed `HOSTED_EXECUTION_ALLOWED_RUNNER_SECRET_KEYS` in the rendered worker config
- `HOSTED_EXECUTION_CONTAINER_ROLLOUT` controls the one-off Wrangler container rollout flag during deploy; omit it or set `gradual` for normal deploys, and use `immediate` only for emergency hotfixes that may interrupt active runner containers.
- `HOSTED_EXECUTION_RUNNER_ENV_PROFILES` adds deploy-time profiles on top of the runtime's minimal `assistant` baseline; deploy automation defaults to `hosted-email,linq,mapbox,telegram`. Hosted device-sync runtime config is resolved from worker env directly rather than a child-env profile.
- `HOSTED_EXECUTION_RUNNER_IDLE_TTL_MS` defaults to `300000`
- `HOSTED_EXECUTION_VERCEL_OIDC_ENVIRONMENT` defaults to `production`

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
- `HOSTED_ASSISTANT_MODEL`; worker deploy preflight requires an explicit allowance-priced launch model, currently `gpt-5.5` or `gpt-5.4-mini` for direct OpenAI
- `HOSTED_ASSISTANT_APPROVAL_POLICY`
- `HOSTED_ASSISTANT_REASONING_EFFORT`
- `HOSTED_ASSISTANT_SANDBOX`

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
- `JUNCTION_TIMESERIES_RESOURCES`
- `JUNCTION_SUMMARY_BACKFILL_DAYS`
- `JUNCTION_TIMESERIES_BACKFILL_DAYS`
- `JUNCTION_RECONCILE_DAYS`
- `JUNCTION_RECONCILE_INTERVAL_MS`
- `JUNCTION_REQUEST_TIMEOUT_MS`

Native parser binaries and the default Whisper model are owned by the runner image and passed to the hosted runtime through explicit parser toolchain config, not deploy-time env overrides.

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

Hosted assistant provider secrets:

- `OPENAI_API_KEY` when the hosted assistant should call OpenAI directly through Codex

Hosted usage-reporting secrets:

- `HOSTED_AI_USAGE_REPORTING_SECRET` when stable anonymized usage attribution should be forwarded to the hosted assistant and Gateway

Opt-in execution integrations:

- `HOSTED_EMAIL_SIGNING_SECRET`
- `DEVICE_SYNC_SECRET`
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
export HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION=...
export HOSTED_CRYPTO_AUTHORITY_SIGN_PUBLIC_KEY_PEM=...
export HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID=cloudflare-automation:v1
export HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK=...
export HOSTED_CRYPTO_ENV=prod
export HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK=...

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

That image is tagged `murph-cloudflare-runner-base:node24.14.1-whisper1.8.1-base-en`.
It contains Node, Python 3 exposed as both `python3` and `python`, pinned `@openai/codex`, `ffmpeg`, `whisper.cpp`, the default Whisper model, and PDF tooling from Poppler plus `file`, `qpdf`, and MuPDF tools, but no app bundle or worker secrets.
The base image build runs `python3 --version`, `python --version`, and `codex app-server --help` under the runner user, and the Docker smoke repeats the Python checks inside the final image before deploy while also proving `file`, `pdfinfo`, `pdftotext`, `pdftoppm`, `qpdf`, and `mutool` against the restored smoke PDF fixture.
Run `pnpm --dir apps/cloudflare test:e2e:runner-python:local` when you specifically want the actual final hosted-runner app image `PATH` proof for Python. It assembles the runner bundle, builds the same `linux/amd64` app-layer Dockerfile used by the Cloudflare container, starts the image with its normal entrypoint, waits for `/health`, then checks Python as the non-root `runner` user from immutable `/app` with the baked runner env. Run `pnpm --dir apps/cloudflare runner:docker:smoke` when you want the broader final-image native smoke.

When you need to backstop lifecycle rules locally or in CI:

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
- prepares the stable native runner base image with Docker's local cache
- deploys the Worker directly with Wrangler, relying on the configured gradual container rollout by default, which builds only the small app image layer from the prepared runner bundle

The normal container rollout keeps `rollout_active_grace_period` at 300 seconds and rolls runner instances through `10`, `25`, `50`, then `100` percent. The manual workflow exposes a `container_rollout` input; leave it at `gradual` for ordinary deploys. Selecting `immediate` passes Wrangler's `--containers-rollout=immediate` flag and should be reserved for hotfixes where interrupting active runner containers is acceptable.

The GitHub `Deploy Cloudflare Hosted Execution` workflow first installs the same pinned Codex CLI version declared by the runner base Dockerfile and runs the hosted Codex auth regression with `MURPH_RUN_HOSTED_CODEX_AUTH_E2E=1`, so deploys fail before Cloudflare preflight if generated OpenAI provider config stops authenticating through `OPENAI_API_KEY`.
The workflow then prepares the same base image with Docker Buildx and the GitHub Actions cache before `wrangler deploy`, so normal production deploys avoid rebuilding the stable native parser stack during the `Deploy Worker` step.
For deploy runs, the workflow then runs focused Cloudflare checks in parallel with `pnpm --dir apps/cloudflare runner:docker:smoke:prepared-base` before any deploy. That smoke builds the app image from an isolated `.deploy/runner-smoke-bundle/` copied from the prepared production bundle, overlays test entrypoints into that smoke-only bundle, and executes the hosted runner inside Docker. The production `.deploy/runner-bundle/` is not mutated, so the workflow can deploy the already validated artifacts without a second `deploy:artifacts` pass; `deploy:worker:apply` still rejects any smoke-mutated production bundle that reaches the deploy step. Render-only workflow runs still execute the focused Cloudflare checks.

## Smoke

`pnpm --dir apps/cloudflare deploy:smoke` validates only the surviving execution-plane surface:

- `GET /`
- `GET /health`
- if `HOSTED_EXECUTION_SMOKE_RUNNER_CONTAINER=true`, one signed `POST /internal/deploy/container-smoke` that waits until the Cloudflare-managed runner container reports the expected runner-bundle fingerprint
- if `HOSTED_EXECUTION_SMOKE_USER_ID` is configured, one authenticated `GET /internal/users/:userId/status`

Optional smoke env:

- `HOSTED_EXECUTION_SMOKE_WORKER_BASE_URL` to target a non-default public Worker URL
- `HOSTED_EXECUTION_SMOKE_USER_ID` to enable the authenticated status check
- `HOSTED_EXECUTION_SMOKE_OIDC_TOKEN` or `VERCEL_OIDC_TOKEN` for authenticated status auth
- `HOSTED_EXECUTION_SMOKE_VERSION_ID` to pin smoke requests to a version in the active deployment; the deploy workflow passes the freshly deployed version
- `HOSTED_EXECUTION_SMOKE_RUNNER_MAX_ATTEMPTS` and `HOSTED_EXECUTION_SMOKE_RUNNER_RETRY_DELAY_MS` to override the managed-container rollout wait

If `HOSTED_EXECUTION_SMOKE_USER_ID` is unset, smoke stops after the public banner and health checks.
