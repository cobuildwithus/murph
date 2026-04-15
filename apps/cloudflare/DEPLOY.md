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

Direct `wrangler deploy` is the normal path. The lower-level version helper still exists for recovery work, but it is not the primary rollout contract.

## One-Time Cloudflare Setup

Before the first deploy:

1. Create the Worker service and the two R2 buckets used for encrypted hosted bundles.
2. Apply `apps/cloudflare/r2-bundles-lifecycle.json` to the real bundles buckets.
3. Decide the public Worker URL, either `*.workers.dev` or a custom domain.

The checked-in lifecycle file only backstops execution-transient blobs:

- `transient/execution-journal/` expires after 6 hours
- `transient/dispatch-payloads/` expires after 6 hours
- `transient/side-effects/` expires after 6 hours
- `transient/hosted-email/messages/` expires after 1 hour

Other encrypted objects in `BUNDLES` are intentionally not lifecycle-expired by this file, including workspace snapshots, externalized artifact blobs, runner-env blobs, and execution-time device-sync runtime mirrors.

## Required GitHub Environment Vars

Set these in the selected GitHub environment as vars:

- `CF_WORKER_NAME`
- `CF_BUNDLES_BUCKET`
- `CF_BUNDLES_PREVIEW_BUCKET`
- `CF_PUBLIC_BASE_URL`
- `HOSTED_EXECUTION_VERCEL_OIDC_TEAM_SLUG`
- `HOSTED_EXECUTION_VERCEL_OIDC_PROJECT_NAME`

`CF_PUBLIC_BASE_URL` is required for the standard deploy-and-smoke flow because smoke targets the public Worker URL after deploy.

## Required GitHub Environment Secrets

Set these in the selected GitHub environment as secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `HOSTED_EXECUTION_PLATFORM_ENVELOPE_KEY`
- `HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PRIVATE_JWK`
- `HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PUBLIC_JWK`
- `HOSTED_EXECUTION_RECOVERY_RECIPIENT_PUBLIC_JWK`
- `HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK`

The callback-signing key remains part of the required worker secret surface because the runtime still imports the signer for narrow web-bound execution proxying. It is no longer documented as a broad lifecycle or correctness callback seam.

## Optional Vars

Core execution tuning:

- `CF_PLATFORM_ENVELOPE_KEY_ID` defaults to `v1`
- `CF_COMPATIBILITY_DATE` defaults to `2026-03-27`
- `CF_CONTAINER_INSTANCE_TYPE` defaults to `standard-1`
- `CF_CONTAINER_MAX_INSTANCES` defaults to `50`
- `CF_MAX_EVENT_ATTEMPTS` defaults to `3`
- `CF_RETRY_DELAY_MS` defaults to `30000`
- `CF_RUNNER_TIMEOUT_MS` defaults to `120000`
- `CF_RUNNER_COMMIT_TIMEOUT_MS` defaults to `30000`
- `CF_ALLOWED_USER_ENV_KEYS` to seed `HOSTED_EXECUTION_ALLOWED_USER_ENV_KEYS` in the rendered worker config
- `HOSTED_EXECUTION_RUNNER_ENV_PROFILES` adds deploy-time profiles on top of the runtime's minimal `assistant,parsers,web` baseline; deploy automation defaults to `hosted-email,linq,mapbox,telegram`
- `HOSTED_EXECUTION_RUNNER_IDLE_TTL_MS`
- `HOSTED_EXECUTION_VERCEL_OIDC_ENVIRONMENT` defaults to `production`

Observability:

- `CF_LOG_HEAD_SAMPLING_RATE` defaults to `1`
- `CF_TRACE_HEAD_SAMPLING_RATE` defaults to `1`

Narrow signed web proxy:

- `HOSTED_WEB_BASE_URL`
- `HOSTED_WEB_CALLBACK_SIGNING_KEY_ID`

Hosted assistant config:

- `HOSTED_ASSISTANT_PROVIDER`
- `HOSTED_ASSISTANT_MODEL`
- `HOSTED_ASSISTANT_API_KEY_ENV`
- the rest of the `HOSTED_ASSISTANT_*` profile vars when you want activation-time seeding of the platform-managed hosted assistant profile

Opt-in runtime integrations and tool overrides:

- `HOSTED_EMAIL_CLOUDFLARE_ACCOUNT_ID`
- `HOSTED_EMAIL_CLOUDFLARE_API_BASE_URL`
- `HOSTED_EMAIL_DEFAULT_SUBJECT`
- `HOSTED_EMAIL_DOMAIN`
- `HOSTED_EMAIL_FROM_ADDRESS`
- `HOSTED_EMAIL_LOCAL_PART`
- `MURPH_WEB_FETCH_ENABLED`
- `MURPH_WEB_SEARCH_PROVIDER`
- `MURPH_WEB_SEARCH_MAX_RESULTS`
- `MURPH_WEB_SEARCH_TIMEOUT_MS`
- `LINQ_API_BASE_URL`
- `TELEGRAM_API_BASE_URL`
- `TELEGRAM_BOT_USERNAME`
- `TELEGRAM_FILE_BASE_URL`
- `FFMPEG_COMMAND`
- `WHISPER_COMMAND`
- `WHISPER_MODEL_PATH`

## Optional Secrets

Key rotation and future envelope lanes:

- `HOSTED_EXECUTION_PLATFORM_ENVELOPE_KEYRING_JSON`
- `HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PRIVATE_KEYRING_JSON`
- `HOSTED_EXECUTION_TEE_AUTOMATION_RECIPIENT_PUBLIC_JWK`

Hosted assistant provider secrets:

- any provider key referenced by `HOSTED_ASSISTANT_API_KEY_ENV`
- supported examples include `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY`, `VENICE_API_KEY`, `TOGETHER_API_KEY`, `GROQ_API_KEY`, `XAI_API_KEY`, `MISTRAL_API_KEY`, `GOOGLE_API_KEY`, and `GOOGLE_GENERATIVE_AI_API_KEY`

Opt-in execution integrations:

- `HOSTED_EMAIL_CLOUDFLARE_API_TOKEN`
- `HOSTED_EMAIL_SIGNING_SECRET`
- `LINQ_API_TOKEN`
- `LINQ_WEBHOOK_SECRET`
- `MAPBOX_ACCESS_TOKEN`
- `TELEGRAM_BOT_TOKEN`
- `BRAVE_API_KEY` when `MURPH_WEB_SEARCH_PROVIDER=brave`

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
export HOSTED_EXECUTION_VERCEL_OIDC_TEAM_SLUG=your-team
export HOSTED_EXECUTION_VERCEL_OIDC_PROJECT_NAME=your-project
export HOSTED_EXECUTION_PLATFORM_ENVELOPE_KEY=...
export HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PRIVATE_JWK=...
export HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PUBLIC_JWK=...
export HOSTED_EXECUTION_RECOVERY_RECIPIENT_PUBLIC_JWK=...
export HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK=...

pnpm --dir apps/cloudflare deploy:preflight
pnpm --dir apps/cloudflare deploy:config:render
pnpm --dir apps/cloudflare deploy:secrets:render
pnpm --dir apps/cloudflare runner:bundle
```

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

- renders the deploy config and worker secrets payload
- assembles the runner bundle
- deploys the Worker directly with Wrangler

## Smoke

`pnpm --dir apps/cloudflare deploy:smoke` validates only the surviving execution-plane surface:

- `GET /`
- `GET /health`
- if `HOSTED_EXECUTION_SMOKE_USER_ID` is configured, `POST /internal/users/:userId/run`
- if `HOSTED_EXECUTION_SMOKE_USER_ID` is configured, `GET /internal/users/:userId/status` until:
  - `pendingEventCount=0`
  - `inFlight=false`
  - `lastRunAt` advances
  - `bundleRef` is non-null

Optional smoke env:

- `HOSTED_EXECUTION_SMOKE_WORKER_BASE_URL` to target a non-default public Worker URL
- `HOSTED_EXECUTION_SMOKE_USER_ID` to enable the manual run/status path
- `HOSTED_EXECUTION_SMOKE_OIDC_TOKEN` or `VERCEL_OIDC_TOKEN` for manual run/status auth
- `HOSTED_EXECUTION_SMOKE_STATUS_POLL_INTERVAL_MS`
- `HOSTED_EXECUTION_SMOKE_STATUS_TIMEOUT_MS`
- `HOSTED_EXECUTION_SMOKE_VERSION_ID` only when intentionally smoke-testing a recovery deployment version override

If `HOSTED_EXECUTION_SMOKE_USER_ID` is unset, smoke stops after the public banner and health checks.
