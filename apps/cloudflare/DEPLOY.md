# Deploying the Cloudflare-hosted Healthy Bob execution plane

This document is the concrete deploy path for the current hosted architecture:

- `apps/web` stays the public onboarding, billing, auth, and webhook control plane.
- `apps/cloudflare` owns per-user orchestration, encrypted bundle persistence, and operator/internal control routes.
- the same `UserRunnerDurableObject` now launches its native Cloudflare container to materialize the encrypted `vault` + `agent-state` bundles, run one-shot Healthy Bob work, call back into the worker for commit/finalize/outbox durability, and return the final hosted bundle state.

This deploy flow intentionally keeps the local-first agent largely unchanged. The hosted layer wraps the same filesystem-oriented runtime instead of inventing a second persistence model.

## What the deploy automation covers

This repo now includes:

- `Dockerfile.cloudflare-hosted-runner`
- `.dockerignore`
- generated deploy artifacts under `apps/cloudflare/.deploy/`
- a manual GitHub Actions deploy workflow at `.github/workflows/deploy-cloudflare-hosted.yml`
- scripts to render:
  - `wrangler.generated.jsonc`
  - `worker-secrets.json`
- a smoke-test script that verifies worker health and optionally triggers one manual hosted run

## What it does not automate yet

- real Cloudflare account provisioning
- bucket creation
- post-deploy application-level smoke scenarios beyond one manual `/run`
- broader hosted side-effect hardening beyond the current hosted assistant outbox path

## Prerequisites

Before your first deploy, you still need to do three one-time setup tasks in Cloudflare:

1. Create a Workers Paid account.
2. Create the R2 buckets that will hold the encrypted hosted bundles.
3. Decide the public Worker URL you want to use:
   - a `*.workers.dev` URL, or
   - a custom domain.

The current worker stores only encrypted bundle blobs in R2 and only small coordination state in Durable Object storage.

## Required GitHub environment variables and secrets

Use GitHub Environments such as `staging` and `production`.

The workflow is parameterized by `workflow_dispatch.environment`, and the deploy job is attached to that GitHub environment so staging and production values can stay isolated.

### Required environment variables

Set these in the selected GitHub environment as variables:

- `CF_WORKER_NAME`
- `CF_BUNDLES_BUCKET`
- `CF_BUNDLES_PREVIEW_BUCKET`
- `CF_PUBLIC_BASE_URL`

Optional tuning variables:

- `CF_BUNDLE_KEY_ID` (default `v1`)
- `CF_COMPATIBILITY_DATE` (default `2026-03-27`)
- `CF_CONTAINER_MAX_INSTANCES` (default `1000`)
- `INSTALL_PADDLEOCR` (default `0`, passed to Wrangler as a container `image_vars` build-time input)
- `CF_DEFAULT_ALARM_DELAY_MS` (default `21600000`)
- `CF_MAX_EVENT_ATTEMPTS` (default `3`)
- `CF_RETRY_DELAY_MS` (default `30000`)
- `CF_RUNNER_TIMEOUT_MS` (default `60000`)
- `CF_RUNNER_COMMIT_TIMEOUT_MS` (default `30000`)
- `CF_ALLOWED_USER_ENV_KEYS`
- `CF_ALLOWED_USER_ENV_PREFIXES`

Optional non-secret provider/toolchain variables to expose through the worker and forward into the container:

- `DEVICE_SYNC_PUBLIC_BASE_URL`
- `LINQ_API_BASE_URL`
- `AGENTMAIL_API_BASE_URL`
- `AGENTMAIL_BASE_URL`
- `TELEGRAM_BOT_USERNAME`
- `TELEGRAM_API_BASE_URL`
- `TELEGRAM_FILE_BASE_URL`
- `WHISPER_MODEL`
- `WHISPER_MODEL_DIR`
- `WHISPER_MODEL_PATH`
- `PADDLEOCR_MODEL_DIR`
- `PARSER_FFMPEG_PATH`
- `FFMPEG_COMMAND`
- `PDFTOTEXT_COMMAND`
- `PADDLEOCR_COMMAND`
- `WHISPER_COMMAND`

### Required environment secrets

Set these in the selected GitHub environment as secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `HOSTED_EXECUTION_SIGNING_SECRET`
- `HOSTED_EXECUTION_BUNDLE_ENCRYPTION_KEY`
- `HOSTED_EXECUTION_CONTROL_TOKEN`
- `HOSTED_EXECUTION_RUNNER_CONTROL_TOKEN`

### Optional provider/runtime secrets

Add whichever hosted features you actually want the containerized runner to support globally:

- `DEVICE_SYNC_SECRET`
- `WHOOP_CLIENT_ID`
- `WHOOP_CLIENT_SECRET`
- `OURA_CLIENT_ID`
- `OURA_CLIENT_SECRET`
- `LINQ_API_TOKEN`
- `LINQ_WEBHOOK_SECRET`
- `AGENTMAIL_API_KEY`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET`
- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `GOOGLE_API_KEY`
- `GOOGLE_GENERATIVE_AI_API_KEY`
- `OPENROUTER_API_KEY`
- `TOGETHER_API_KEY`
- `GROQ_API_KEY`
- `XAI_API_KEY`
- `MISTRAL_API_KEY`

## Local dry run before touching production

From the repo root:

```bash
pnpm install
pnpm --dir apps/cloudflare test
```

If the package-local typecheck is blocked by unrelated in-flight workspace errors, the app-local runtime signal is:

```bash
pnpm --dir ../.. exec vitest run --config apps/cloudflare/vitest.config.ts --no-coverage --maxWorkers 1
```

Render the generated deploy artifacts from your shell environment:

```bash
export CF_WORKER_NAME=healthybob-hosted-staging
export CF_BUNDLES_BUCKET=healthybob-hosted-bundles-staging
export CF_BUNDLES_PREVIEW_BUCKET=healthybob-hosted-bundles-staging-preview
export CF_PUBLIC_BASE_URL=https://healthybob-hosted-staging.example.workers.dev
export HOSTED_EXECUTION_SIGNING_SECRET=...
export HOSTED_EXECUTION_BUNDLE_ENCRYPTION_KEY=...
export HOSTED_EXECUTION_CONTROL_TOKEN=...
export HOSTED_EXECUTION_RUNNER_CONTROL_TOKEN=...

pnpm --dir apps/cloudflare deploy:config:render
pnpm --dir apps/cloudflare deploy:secrets:render
```

You should now have:

- `apps/cloudflare/.deploy/wrangler.generated.jsonc`
- `apps/cloudflare/.deploy/worker-secrets.json`

## Deploying the worker manually

If you want to stage manually before GitHub Actions:

```bash
pnpm --dir apps/cloudflare worker:secret:bulk -- ./.deploy/worker-secrets.json --config ./.deploy/wrangler.generated.jsonc
pnpm --dir apps/cloudflare worker:deploy -- --config ./.deploy/wrangler.generated.jsonc
```

`wrangler deploy` builds the native container image from `Dockerfile.cloudflare-hosted-runner`, pushes it through Cloudflare's deploy path, and deploys the worker. Docker needs to be available on the machine running that command.

Then smoke test the deployed worker:

```bash
export HOSTED_EXECUTION_SMOKE_WORKER_BASE_URL="$CF_PUBLIC_BASE_URL"
export HOSTED_EXECUTION_SMOKE_USER_ID=member_test_123
pnpm --dir apps/cloudflare deploy:smoke
```

If you do not want the script to trigger a manual hosted run, omit `HOSTED_EXECUTION_SMOKE_USER_ID`.

## Using the GitHub Actions workflow

The workflow is intentionally manual (`workflow_dispatch`) so you do not accidentally push a half-configured deploy.

Open Actions, then `Deploy Cloudflare Hosted Execution`, and choose:

- `environment`: `staging` or `production`
- `sync_worker_secrets`: whether to upload Worker secrets with Wrangler before deploy
- `deploy_worker`: whether to actually deploy the Worker
- `smoke_user_id`: optional hosted user id to trigger one manual `/run` smoke test

The workflow does this in order:

1. checks out the repo
2. installs pnpm and Node 22
3. installs workspace dependencies
4. runs the focused `apps/cloudflare` verification path
5. renders the generated deploy artifacts
6. optionally uploads Worker secrets with `wrangler secret bulk`
7. optionally deploys the Worker with `wrangler deploy`, which also builds the native container image from `Dockerfile.cloudflare-hosted-runner`
8. runs the worker health and smoke checks
9. writes a deployment summary into the GitHub Actions step summary

## First production deploy checklist

Before the first real production deploy, confirm all of these are true:

- Docker is running wherever `wrangler deploy` will execute
- the Worker answers `GET /health`
- `CF_PUBLIC_BASE_URL` is the exact externally reachable URL the container can call for commit/finalize/outbox durability
- `HOSTED_EXECUTION_CONTROL_TOKEN` is set
- `HOSTED_EXECUTION_RUNNER_CONTROL_TOKEN` is set and stable
- the R2 bucket names in the generated config are correct
- the bundle encryption key is present and stable
- one seeded hosted user can complete:
  - manual `/run`
  - a Linq inbound message
  - a cron tick
  - a device-sync wake

The first deploy can take a few minutes before native container starts succeed reliably, because Cloudflare has to provision the image the first time.

## What to do right after first deploy

This deploy automation gets you to a real native-container staging posture, but two production-hardening items still matter:

1. keep widening direct scenario coverage for the hosted execution lane, especially real Cloudflare deploy smoke paths
2. extend the current durable assistant outbox approach if other externally visible hosted side effects need the same replay-safe treatment

Until those broader guarantees exist, treat the current lane as controlled rollout infrastructure rather than an excuse to skip operational caution.
