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
Hosted assistant delivery recovery now relies on committed side-effect state inside the encrypted workspace plus the web-owned hosted-run recovery record.

## One-Time Cloudflare Setup

Before the first deploy:

1. Create the Worker service and the two R2 buckets used for encrypted hosted bundles.
2. Apply `apps/cloudflare/r2-bundles-lifecycle.json` to the real bundles buckets.
3. Decide the public Worker URL, either `*.workers.dev` or a custom domain.

The checked-in lifecycle file now contains one narrow backstop rule for `hosted-email/messages/`: delete raw hosted-email blobs after 1 hour if eager cleanup missed them. Runner cleanup after terminal completion or quarantine remains the normal path, and the rest of the encrypted objects in `BUNDLES` remain owner-cleaned or durable by design.

## Required GitHub Environment Vars

Set these in the selected GitHub environment as vars:

- `CF_WORKER_NAME`
- `CF_BUNDLES_BUCKET`
- `CF_BUNDLES_PREVIEW_BUCKET`
- `CF_PUBLIC_BASE_URL`
- `HOSTED_WEB_BASE_URL`
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
- `HOSTED_WAKE_ENCRYPTION_KEY`
- `HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK`

The callback-signing key remains part of the required worker secret surface because the canonical hosted ingress append and hosted-run acquire/commit/finalize flow now goes through the signed hosted-web boundary. It is no longer documented as a broad lifecycle or correctness callback seam.
The wake encryption key is execution-only and should decrypt hosted execution ingress payloads only. Do not reuse the broader web-owned `HOSTED_WEB_ENCRYPTION_*` private-field lane in Cloudflare.

## Optional Vars

Core execution tuning:

- `CF_PLATFORM_ENVELOPE_KEY_ID` defaults to `v1`
- `CF_COMPATIBILITY_DATE` defaults to `2026-03-27`
- `CF_CONTAINER_INSTANCE_TYPE` defaults to `{"vcpu":1,"memory_mib":3072,"disk_mb":6000}`
- `CF_CONTAINER_MAX_INSTANCES` defaults to `1000`
- `CF_MAX_EVENT_ATTEMPTS` defaults to `3`
- `CF_RETRY_DELAY_MS` defaults to `30000`
- `CF_RUNNER_TIMEOUT_MS` defaults to `120000`
- `CF_RUNNER_COMMIT_TIMEOUT_MS` defaults to `30000`
- `CF_RUNNER_READY_TIMEOUT_MS` defaults to `20000`
- `CF_ALLOWED_RUNNER_SECRET_KEYS` to seed `HOSTED_EXECUTION_ALLOWED_RUNNER_SECRET_KEYS` in the rendered worker config
- `HOSTED_EXECUTION_RUNNER_ENV_PROFILES` adds deploy-time profiles on top of the runtime's minimal `assistant,parsers,web` baseline; deploy automation defaults to `hosted-email,linq,mapbox,telegram`. Hosted device-sync runtime config is resolved from worker env directly rather than a child-env profile.
- `HOSTED_EXECUTION_RUNNER_IDLE_TTL_MS` defaults to `300000`
- `HOSTED_EXECUTION_VERCEL_OIDC_ENVIRONMENT` defaults to `production`

Observability:

- `CF_LOG_HEAD_SAMPLING_RATE` defaults to `1`
- `CF_TRACE_HEAD_SAMPLING_RATE` defaults to `1`

Signed hosted-web callback metadata:

- `HOSTED_WEB_CALLBACK_SIGNING_KEY_ID`

Hosted ingress encryption rotation metadata:

- `HOSTED_WAKE_ENCRYPTION_KEY_VERSION`

Hosted assistant config:

- `HOSTED_ASSISTANT_PROVIDER`
- `HOSTED_ASSISTANT_MODEL`
- `HOSTED_ASSISTANT_API_KEY_ENV`
- `HOSTED_AI_USAGE_VERCEL_STRIPE_BILLING_ENABLED` when delegated Vercel AI Gateway billing is enabled
- the rest of the `HOSTED_ASSISTANT_*` profile vars when you want activation-time seeding of the platform-managed hosted assistant profile

Opt-in runtime integrations and tool overrides:

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
- `DEVICE_SYNC_PUBLIC_BASE_URL`

If the selected GitHub environment already defines container sizing overrides, update these existing vars there as well:

- `CF_CONTAINER_INSTANCE_TYPE={"vcpu":1,"memory_mib":3072,"disk_mb":6000}`
- `CF_CONTAINER_MAX_INSTANCES=1000`

When hosted email sender identity is configured, deploy automation renders one native `send_email` binding named `HOSTED_EMAIL` and constrains it with `allowed_sender_addresses` to that resolved sender address. Hosted email outbound send no longer requires a runtime Cloudflare account id or email-send API token inside the Worker.

## Optional Secrets

Key rotation and future envelope lanes:

- `HOSTED_EXECUTION_PLATFORM_ENVELOPE_KEYRING_JSON`
- `HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PRIVATE_KEYRING_JSON`
- `HOSTED_EXECUTION_TEE_AUTOMATION_RECIPIENT_PUBLIC_JWK`
- `HOSTED_WAKE_ENCRYPTION_KEYRING_JSON`

Hosted assistant provider secrets:

- any provider key referenced by `HOSTED_ASSISTANT_API_KEY_ENV`
- `HOSTED_AI_USAGE_STRIPE_RESTRICTED_ACCESS_KEY` when Vercel AI Gateway should emit Stripe meter events directly
- supported examples include `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY`, `VENICE_API_KEY`, `TOGETHER_API_KEY`, `GROQ_API_KEY`, `XAI_API_KEY`, `MISTRAL_API_KEY`, `GOOGLE_API_KEY`, and `GOOGLE_GENERATIVE_AI_API_KEY`

Opt-in execution integrations:

- `HOSTED_EMAIL_SIGNING_SECRET`
- `DEVICE_SYNC_SECRET`
- `GARMIN_CLIENT_ID`
- `GARMIN_CLIENT_SECRET`
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
export HOSTED_WEB_BASE_URL=https://web.example.test
export HOSTED_EXECUTION_VERCEL_OIDC_TEAM_SLUG=your-team
export HOSTED_EXECUTION_VERCEL_OIDC_PROJECT_NAME=your-project
export HOSTED_EXECUTION_PLATFORM_ENVELOPE_KEY=...
export HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PRIVATE_JWK=...
export HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PUBLIC_JWK=...
export HOSTED_EXECUTION_RECOVERY_RECIPIENT_PUBLIC_JWK=...
export HOSTED_WAKE_ENCRYPTION_KEY=...
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
- if `HOSTED_EXECUTION_SMOKE_USER_ID` is configured, one authenticated `GET /internal/users/:userId/status`

Optional smoke env:

- `HOSTED_EXECUTION_SMOKE_WORKER_BASE_URL` to target a non-default public Worker URL
- `HOSTED_EXECUTION_SMOKE_USER_ID` to enable the authenticated status check
- `HOSTED_EXECUTION_SMOKE_OIDC_TOKEN` or `VERCEL_OIDC_TOKEN` for authenticated status auth
- `HOSTED_EXECUTION_SMOKE_VERSION_ID` only when intentionally smoke-testing a recovery deployment version override

If `HOSTED_EXECUTION_SMOKE_USER_ID` is unset, smoke stops after the public banner and health checks.
