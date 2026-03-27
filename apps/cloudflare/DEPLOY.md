# Deploying the Cloudflare-hosted Healthy Bob execution plane

This document is the concrete deploy path for the current hosted architecture:

- `apps/web` stays the public onboarding, billing, passkey, and webhook control plane.
- `apps/cloudflare` owns per-user orchestration, encrypted bundle persistence, and manual/operator control routes.
- the separate hosted runner container materializes the encrypted `vault` + `agent-state` bundles, runs one-shot Healthy Bob work, and commits the next encrypted bundle versions back through the Worker.

This deploy flow intentionally keeps the local-first agent largely unchanged. The hosted layer wraps the same local filesystem-oriented runtime instead of inventing a second persistence model.

## What the deploy automation covers

This repo now includes:

- `Dockerfile.cloudflare-hosted-runner`
- `.dockerignore`
- generated deploy artifacts under `apps/cloudflare/.deploy/`
- a manual GitHub Actions deploy workflow at `.github/workflows/deploy-cloudflare-hosted.yml`
- scripts to render:
  - `wrangler.generated.jsonc`
  - `worker-secrets.json`
  - `runner.env`
- a smoke-test script that verifies the Worker and runner health endpoints and optionally triggers a manual hosted run

## What it does not automate yet

The workflow publishes the runner image to GHCR and deploys the Worker, but it does not roll your runner service on Railway, Fly, Cloud Run, or another container host for you. That part still depends on the runner platform you choose.

That split is deliberate: the current architecture still uses a separate Node runner service, and the long-term runner platform is still operator-chosen.

## Prerequisites

Before your first deploy, you still need to do three one-time setup tasks in Cloudflare:

1. Create a Workers Paid account.
2. Create the R2 buckets that will hold the encrypted bundles.
3. Decide the public Worker URL you want to use:
   - a `*.workers.dev` URL, or
   - a custom domain.

The current Worker stores only encrypted bundle blobs in R2 and only tiny coordination state in the Durable Object.

## Required GitHub environment variables and secrets

Use GitHub Environments such as `staging` and `production`.

The workflow is parameterized by `workflow_dispatch.environment`, and the deploy job is attached to that GitHub environment. That means you can keep staging and production values isolated without editing the workflow.

### Required environment variables

Set these in the selected GitHub environment as variables:

- `CF_WORKER_NAME`
- `CF_BUNDLES_BUCKET`
- `CF_BUNDLES_PREVIEW_BUCKET`
- `CF_PUBLIC_BASE_URL`
- `CF_RUNNER_BASE_URL`

Optional tuning variables:

- `CF_BUNDLE_KEY_ID` (default `v1`)
- `CF_COMPATIBILITY_DATE` (default `2026-03-26`)
- `CF_DEFAULT_ALARM_DELAY_MS` (default `900000`)
- `CF_MAX_EVENT_ATTEMPTS` (default `3`)
- `CF_RETRY_DELAY_MS` (default `30000`)
- `CF_RUNNER_TIMEOUT_MS` (default `60000`)
- `CF_RUNNER_COMMIT_TIMEOUT_MS` (default `30000`)
- `CF_ALLOWED_USER_ENV_KEYS`
- `CF_ALLOWED_USER_ENV_PREFIXES`
- `INSTALL_PADDLEOCR` (`0` or `1`)
- `WHISPER_MODEL`
- `WHISPER_MODEL_DIR`
- `PADDLEOCR_MODEL_DIR`
- `PARSER_FFMPEG_PATH`

### Required environment secrets

Set these in the selected GitHub environment as secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `HOSTED_EXECUTION_SIGNING_SECRET`
- `HOSTED_EXECUTION_BUNDLE_ENCRYPTION_KEY`
- `HOSTED_EXECUTION_CONTROL_TOKEN`
- `HOSTED_EXECUTION_RUNNER_CONTROL_TOKEN`

Those are the minimum secrets that the generated deploy config expects.

### Optional runner and provider secrets

Add whichever hosted features you actually want the runner to support globally:

- `DEVICE_SYNC_SECRET`
- `WHOOP_CLIENT_ID`
- `WHOOP_CLIENT_SECRET`
- `OURA_CLIENT_ID`
- `OURA_CLIENT_SECRET`
- `LINQ_API_TOKEN`
- `HEALTHYBOB_LINQ_API_TOKEN`
- `LINQ_WEBHOOK_SECRET`
- `HEALTHYBOB_LINQ_WEBHOOK_SECRET`
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

Optional runner and provider variables:

- `DEVICE_SYNC_PUBLIC_BASE_URL`
- `LINQ_API_BASE_URL`
- `HEALTHYBOB_LINQ_API_BASE_URL`
- `AGENTMAIL_API_BASE_URL`
- `TELEGRAM_BOT_USERNAME`

## Local dry run before touching production

From the repo root:

```bash
pnpm install
pnpm --dir apps/cloudflare test
```

Render the generated deploy artifacts from your shell environment:

```bash
export CF_WORKER_NAME=healthybob-hosted-staging
export CF_BUNDLES_BUCKET=healthybob-hosted-bundles-staging
export CF_BUNDLES_PREVIEW_BUCKET=healthybob-hosted-bundles-staging-preview
export CF_PUBLIC_BASE_URL=https://healthybob-hosted-staging.example.workers.dev
export CF_RUNNER_BASE_URL=https://healthybob-runner-staging.internal.example.com
export HOSTED_EXECUTION_SIGNING_SECRET=...
export HOSTED_EXECUTION_BUNDLE_ENCRYPTION_KEY=...
export HOSTED_EXECUTION_CONTROL_TOKEN=...
export HOSTED_EXECUTION_RUNNER_CONTROL_TOKEN=...

pnpm --dir apps/cloudflare deploy:config:render
pnpm --dir apps/cloudflare deploy:secrets:render
pnpm --dir apps/cloudflare deploy:runner-env:render
```

You should now have:

- `apps/cloudflare/.deploy/wrangler.generated.jsonc`
- `apps/cloudflare/.deploy/worker-secrets.json`
- `apps/cloudflare/.deploy/runner.env`

## Running the hosted runner locally

Build and run the local runner image:

```bash
pnpm --dir apps/cloudflare runner:docker:build
cp apps/cloudflare/.deploy/runner.env apps/cloudflare/.runner.env
pnpm --dir apps/cloudflare runner:docker:run
```

The runner listens on port `8080` by default.

## Deploying the Worker manually

If you want to stage manually before GitHub Actions:

```bash
pnpm --dir apps/cloudflare worker:secret:bulk -- ./.deploy/worker-secrets.json --config ./.deploy/wrangler.generated.jsonc
pnpm --dir apps/cloudflare worker:deploy -- --config ./.deploy/wrangler.generated.jsonc
```

Then smoke test the Worker and the runner:

```bash
export HOSTED_EXECUTION_SMOKE_WORKER_BASE_URL="$CF_PUBLIC_BASE_URL"
export HOSTED_EXECUTION_SMOKE_RUNNER_BASE_URL="$CF_RUNNER_BASE_URL"
export HOSTED_EXECUTION_SMOKE_USER_ID=member_test_123
pnpm --dir apps/cloudflare deploy:smoke
```

If you do not want the script to trigger a manual hosted run, omit `HOSTED_EXECUTION_SMOKE_USER_ID`.

## Using the GitHub Actions workflow

The workflow is intentionally manual (`workflow_dispatch`) so you do not accidentally push a half-configured deploy.

Open Actions, then Deploy Cloudflare Hosted Execution, and choose:

- `environment`: `staging` or `production`
- `publish_runner_image`: whether to build and push the runner image to GHCR
- `sync_worker_secrets`: whether to upload Worker secrets with Wrangler before deploy
- `deploy_worker`: whether to actually deploy the Worker
- `smoke_user_id`: optional hosted user id to trigger one manual `/run` smoke test

The workflow does this in order:

1. checks out the repo
2. installs pnpm and Node 22
3. installs workspace dependencies
4. runs the focused `apps/cloudflare` test suite
5. renders the generated deploy artifacts
6. optionally builds and pushes `ghcr.io/<owner>/healthybob-cloudflare-runner:<environment>`
7. optionally uploads Worker secrets with `wrangler secret bulk`
8. optionally deploys the Worker with `wrangler deploy`
9. runs the health and smoke checks
10. writes a deployment summary into the GitHub Actions step summary

## Pointing a runner host at the published image

The workflow pushes the runner image to GHCR, but you still need your runner host to pull that image.

Use the environment tag for the long-lived service:

- `ghcr.io/<owner>/healthybob-cloudflare-runner:staging`
- `ghcr.io/<owner>/healthybob-cloudflare-runner:production`

Use the generated `apps/cloudflare/.deploy/runner.env` file contents as the runner service env set.

If your runner platform cannot pull private GHCR images, either:

- grant that platform permission to read GHCR, or
- switch the workflow's image push target to a registry it can pull from more easily.

## First production deploy checklist

Before the first real production deploy, confirm all of these are true:

- the Worker and runner each answer `GET /health`
- `CF_PUBLIC_BASE_URL` is the exact URL the runner can call back to
- the runner is reachable from Cloudflare over HTTPS
- `HOSTED_EXECUTION_CONTROL_TOKEN` is set
- `HOSTED_EXECUTION_RUNNER_CONTROL_TOKEN` is set and matches both sides
- the R2 bucket names in the generated config are correct
- the bundle encryption key is present and stable
- one seeded hosted user can complete:
  - manual `/run`
  - a Linq inbound message
  - a cron tick
  - a device-sync wake

## What to do right after first deploy

This deploy automation gets you to a reliable staging or canary posture, but two production-hardening items still matter:

1. add an outbound action outbox and idempotency layer so retries cannot duplicate side effects
2. decide whether you want to keep the separate runner service or later collapse into Cloudflare's native container-backed Durable Object flow

Until the outbox exists, treat this as suitable for canaries and controlled rollout rather than a giant blind production launch.
