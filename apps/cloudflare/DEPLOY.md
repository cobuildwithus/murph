# Deploying the Cloudflare-hosted Murph execution plane

This document is the concrete deploy path for the current hosted architecture:

- `apps/web` stays the public onboarding, billing, auth, and webhook control plane.
- `apps/cloudflare` owns per-user orchestration, encrypted bundle persistence, and operator/internal control routes.
- `UserRunnerDurableObject` now orchestrates per-user work while a companion `RunnerContainer` class handles the native Cloudflare container lifecycle, startup readiness, and per-run env injection before running the one-shot Murph job and calling back into the worker for commit/finalize/outbox durability.

This deploy flow intentionally keeps the local-first agent largely unchanged. The hosted layer wraps the same filesystem-oriented runtime instead of inventing a second persistence model.

## What the deploy automation covers

This repo now includes:

- `Dockerfile.cloudflare-hosted-runner`
- `.dockerignore`
- `apps/cloudflare/r2-bundles-lifecycle.json`
- generated deploy artifacts under `apps/cloudflare/.deploy/`
- a manual GitHub Actions deploy workflow at `.github/workflows/deploy-cloudflare-hosted.yml`
- a rollout helper that can either:
  - upload a new Worker version and create a gradual deployment, or
  - fall back to a direct `wrangler deploy` for first deploys and Durable Object migrations
- scripts to render:
  - `wrangler.generated.jsonc`
  - `worker-secrets.json`
- an R2 lifecycle helper that applies the checked-in transient cleanup rules to the configured bundles buckets
- explicit Wrangler observability config for Workers Logs and Workers Traces
- checked-in and generated Wrangler config that declares the four required runtime secrets through Wrangler's experimental `secrets.required` support
- a smoke-test script that verifies worker health and, when configured with a user id, triggers one manual hosted run and waits for queue drain, `lastRunAt` advance, and durable bundle refs, pinned to the candidate version during gradual rollouts

## What it does not automate yet

- real Cloudflare account provisioning
- bucket creation
- automatic promotion from canary to 100% without an operator decision
- post-deploy application-level smoke scenarios beyond one manual `/run`
- broader hosted side-effect hardening beyond the current hosted assistant outbox path

## Prerequisites

Before your first deploy, you still need to do four one-time setup tasks in Cloudflare:

1. Create a Workers Paid account.
2. Create the R2 buckets that will hold the encrypted hosted bundles.
3. Apply the repo's transient-object lifecycle rules to those buckets:
   - `transient/execution-journal/` expires after 30 days
   - `transient/side-effects/` expires after 30 days
4. Decide the public Worker URL you want to use:
   - a `*.workers.dev` URL, or
   - a custom domain.

The current worker stores only encrypted bundle blobs in R2 and only small coordination state in Durable Object storage.

Cloudflare-specific rollout constraints still apply:

- first deploys must use `wrangler deploy`; `wrangler versions upload` cannot create the service for the first time
- Durable Object migrations must use `wrangler deploy`; version uploads do not support DO migrations
- gradual deployments only support one or two active versions, so finish or roll back an existing split before introducing another candidate

## Required GitHub environment variables and secrets

Use GitHub Environments such as `staging` and `production`.

The workflow is parameterized by `workflow_dispatch.environment`, and the deploy job is attached to that GitHub environment so staging and production values can stay isolated.

### Required environment variables

Set these in the selected GitHub environment as variables:

- `CF_WORKER_NAME`
- `CF_BUNDLES_BUCKET`
- `CF_BUNDLES_PREVIEW_BUCKET`
- `CF_PUBLIC_BASE_URL` for deploys that run the post-deploy smoke step; the GitHub workflow now fails early with a clear error when `deploy_worker=true` and this value is unset

Optional tuning variables:

- `CF_BUNDLE_KEY_ID` (default `v1`; metadata only today, because runtime reads still support one active key id at a time)
- `CF_COMPATIBILITY_DATE` (default `2026-03-27`)
- `CF_CONTAINER_INSTANCE_TYPE` (default `standard-1`; also accepts a custom JSON object with `vcpu`, `memory_mib`, and `disk_mb`)
- `CF_CONTAINER_MAX_INSTANCES` (default `50`)
- `HOSTED_EXECUTION_CONTAINER_SLEEP_AFTER` (default `1m`)
- `CF_DEFAULT_ALARM_DELAY_MS` (default `21600000`)
- `CF_LOG_HEAD_SAMPLING_RATE` (default `1`)
- `CF_MAX_EVENT_ATTEMPTS` (default `3`)
- `CF_RETRY_DELAY_MS` (default `30000`)
- `CF_RUNNER_TIMEOUT_MS` (default `120000`)
- `CF_RUNNER_COMMIT_TIMEOUT_MS` (default `30000`)
- `CF_TRACE_HEAD_SAMPLING_RATE` (default `0.1`)
- `CF_ALLOWED_USER_ENV_KEYS`
- `CF_ALLOWED_USER_ENV_PREFIXES`
- `HOSTED_ASSISTANT_PROVIDER`, `HOSTED_ASSISTANT_MODEL`, and the rest of the `HOSTED_ASSISTANT_*` seed vars when you want hosted member activation to persist one explicit platform-managed assistant profile into `~/.murph/config.json` instead of relying on runtime fallback

Optional non-secret worker variables:

- `DEVICE_SYNC_PUBLIC_BASE_URL`
- `HOSTED_EMAIL_CLOUDFLARE_ACCOUNT_ID`
- `HOSTED_EMAIL_CLOUDFLARE_API_BASE_URL`
- `HOSTED_EMAIL_DEFAULT_SUBJECT`
- `HOSTED_EMAIL_DOMAIN`
- `HOSTED_EMAIL_FROM_ADDRESS`
- `HOSTED_EMAIL_LOCAL_PART`
- `HOSTED_WEB_BASE_URL`
- `HOSTED_DEVICE_SYNC_CONTROL_BASE_URL`
- `HOSTED_AI_USAGE_BASE_URL`
- `HOSTED_SHARE_API_BASE_URL`

The hosted-web control-plane URLs above are consumed by the worker-side runner proxy layer. They must stay on the same host as `HOSTED_WEB_BASE_URL`. Only the subset allowlisted in `apps/cloudflare/src/runner-env.ts` is forwarded into the native container runtime.

Optional non-secret provider/toolchain variables to expose through the worker and forward into the container:

- `HOSTED_ASSISTANT_API_KEY_ENV` points at the env var name to read for the active hosted assistant profile. Keep the actual secret in Worker secrets or the encrypted per-user env object, not in the hosted config document.
- `LINQ_API_BASE_URL`
- `TELEGRAM_BOT_USERNAME`
- `TELEGRAM_API_BASE_URL`
- `TELEGRAM_FILE_BASE_URL`
- `FFMPEG_COMMAND`
- `PDFTOTEXT_COMMAND`
- `WHISPER_MODEL_PATH`
- `WHISPER_COMMAND`

The default container image already installs `ffmpeg`, `pdftotext`, a pinned `whisper.cpp` `whisper-cli`, and the default `base.en` model, and it sets `FFMPEG_COMMAND`, `PDFTOTEXT_COMMAND`, `WHISPER_COMMAND`, and `WHISPER_MODEL_PATH` inside the image. Only set those vars in Worker config when you want to override the baked defaults.

### Required environment secrets

Set these in the selected GitHub environment as secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `HOSTED_EXECUTION_SIGNING_SECRET`
- `HOSTED_EXECUTION_BUNDLE_ENCRYPTION_KEY`
- `HOSTED_EXECUTION_CONTROL_TOKEN`
- `HOSTED_EXECUTION_RUNNER_CONTROL_TOKEN`

Optional secret for staged bundle-key rotation:

- `HOSTED_EXECUTION_BUNDLE_ENCRYPTION_KEYRING_JSON`

Additional hosted-web control-plane secrets:

- `HOSTED_EXECUTION_INTERNAL_TOKEN`
- `HOSTED_SHARE_INTERNAL_TOKEN`

Optional hosted email bridge secrets:

- `HOSTED_EMAIL_CLOUDFLARE_API_TOKEN`
- `HOSTED_EMAIL_SIGNING_SECRET`

The checked-in scaffold and rendered deploy config both declare those four names in Wrangler's experimental `secrets.required` field, so `wrangler deploy` and `wrangler versions upload` fail early when any of them are missing from the Worker.

Both control tokens are treated as required runtime inputs now, not just deploy-time placeholders:

- missing `HOSTED_EXECUTION_CONTROL_TOKEN` makes `/internal/users/:userId/{status,run,env}` fail closed
- missing `HOSTED_EXECUTION_RUNNER_CONTROL_TOKEN` makes native container invoke requests fail closed before the runner job starts
- missing `HOSTED_EXECUTION_INTERNAL_TOKEN` makes runner proxy calls to hosted web internal device-sync and usage routes fail closed
- missing `HOSTED_SHARE_INTERNAL_TOKEN` makes hosted share payload fetches fail closed
- changing `HOSTED_EXECUTION_BUNDLE_ENCRYPTION_KEY` or `CF_BUNDLE_KEY_ID` in place still requires staging older keys in `HOSTED_EXECUTION_BUNDLE_ENCRYPTION_KEYRING_JSON`; missing keyring entries fail closed on `keyId` mismatch

### Optional provider/runtime secrets

Add whichever hosted features you actually want the containerized runner to support globally:

- `DEVICE_SYNC_SECRET`
- `WHOOP_CLIENT_ID`
- `WHOOP_CLIENT_SECRET`
- `OURA_CLIENT_ID`
- `OURA_CLIENT_SECRET`
- `LINQ_API_TOKEN`
- `LINQ_WEBHOOK_SECRET`
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

Hosted email on this path is Cloudflare-native. Keep `HOSTED_EMAIL_*` configured when you want hosted ingress or sends; `AGENTMAIL_*` is intentionally not part of the hosted deploy surface.

## Local dry run before touching production

From the repo root:

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm --dir apps/cloudflare verify
```

If you want the faster Node-only loop or just the Workers-runtime lane locally, run:

```bash
pnpm --dir apps/cloudflare test
pnpm --dir apps/cloudflare test:workers
```

Render the generated deploy artifacts from your shell environment:

```bash
export CF_WORKER_NAME=hosted-runner-staging
export CF_BUNDLES_BUCKET=hosted-execution-bundles-staging
export CF_BUNDLES_PREVIEW_BUCKET=hosted-execution-bundles-staging-preview
export CF_CONTAINER_INSTANCE_TYPE=standard-1
export HOSTED_EXECUTION_CONTAINER_SLEEP_AFTER=1m
export HOSTED_EXECUTION_SIGNING_SECRET=...
export HOSTED_EXECUTION_BUNDLE_ENCRYPTION_KEY=...
export HOSTED_EXECUTION_CONTROL_TOKEN=...
export HOSTED_EXECUTION_INTERNAL_TOKEN=...
export HOSTED_EXECUTION_RUNNER_CONTROL_TOKEN=...
export HOSTED_EMAIL_CLOUDFLARE_ACCOUNT_ID=...
export HOSTED_EMAIL_CLOUDFLARE_API_TOKEN=...
export HOSTED_EMAIL_DOMAIN=mail.example.test
export HOSTED_EMAIL_LOCAL_PART=assistant
export HOSTED_EMAIL_SIGNING_SECRET=...
export HOSTED_WEB_BASE_URL=https://your-hosted-web.example.com
export HOSTED_SHARE_INTERNAL_TOKEN=...
export CF_RUNNER_TIMEOUT_MS=120000
export CF_LOG_HEAD_SAMPLING_RATE=1
export CF_TRACE_HEAD_SAMPLING_RATE=0.1

pnpm --dir apps/cloudflare r2:lifecycle:apply
pnpm --dir apps/cloudflare deploy:config:render
pnpm --dir apps/cloudflare deploy:secrets:render
```

You should now have:

- `apps/cloudflare/.deploy/wrangler.generated.jsonc`
- `apps/cloudflare/.deploy/worker-secrets.json`

`pnpm --dir apps/cloudflare r2:lifecycle:apply` reads `CF_BUNDLES_BUCKET` and `CF_BUNDLES_PREVIEW_BUCKET` from your environment and applies the checked-in `apps/cloudflare/r2-bundles-lifecycle.json` rules to whichever of those buckets are configured. The Wrangler command requires Cloudflare auth with R2 write access.

## Deploying the worker manually

If you want to stage manually before GitHub Actions:

### First deploys and Durable Object migrations

Use a direct deploy when the Worker does not exist yet or the generated config includes a new Durable Object migration:

```bash
pnpm --dir apps/cloudflare worker:deploy -- \
  --config ./.deploy/wrangler.generated.jsonc \
  --secrets-file ./.deploy/worker-secrets.json
```

`wrangler deploy` builds the native container image from `Dockerfile.cloudflare-hosted-runner`, pushes it through Cloudflare's deploy path, and deploys the worker. Docker needs to be available on the machine running that command.

### Normal rollouts after the first deploy

Once the Worker already exists and no Durable Object migration is being applied, use the rollout helper so the version upload and deployment stay separate:

```bash
export HOSTED_EXECUTION_DEPLOYMENT_MODE=gradual
export HOSTED_EXECUTION_GRADUAL_ROLLOUT_PERCENTAGE=10
export HOSTED_EXECUTION_INCLUDE_SECRETS=true

pnpm --dir apps/cloudflare deploy:rollout -- --config ./.deploy/wrangler.generated.jsonc
```

The rollout helper uploads a new Worker version, creates a gradual deployment, and writes a deployment result summary under `apps/cloudflare/.deploy/deployment-result.json`.
It also fails fast if the rendered config introduces a newer Durable Object migration tag than the gradual rollout helper currently allows, so a migration rollout cannot accidentally take the versions/deployments path.

## Cleaning up old container images

Cloudflare's managed registry keeps old image tags until you delete them. If you deploy frequently with the hosted runner image, clean up stale tags periodically so the registry does not quietly accumulate garbage.

Start with a dry run:

```bash
pnpm --dir apps/cloudflare images:cleanup -- --filter '<repo-regex>' --keep 10
```

Then apply it once the plan looks correct:

```bash
pnpm --dir apps/cloudflare images:cleanup -- --filter '<repo-regex>' --keep 10 --apply
```

Notes:

- cleanup is intentionally explicit and operator-driven; the normal deploy path does not auto-delete images
- the script keeps the newest tags per repository by reverse lexicographic tag order, so it works best with the default timestamp-style deploy tags
- deleting an image tag that an older Worker version still references will break rollback to that version

To promote an already-uploaded candidate instead of uploading a new version:

```bash
export HOSTED_EXECUTION_DEPLOYMENT_MODE=gradual
export HOSTED_EXECUTION_DEPLOY_VERSION_ID=<candidate-version-id>
export HOSTED_EXECUTION_GRADUAL_ROLLOUT_PERCENTAGE=100

pnpm --dir apps/cloudflare deploy:rollout -- --config ./.deploy/wrangler.generated.jsonc
```

Then smoke test the deployed worker:

```bash
export HOSTED_EXECUTION_SMOKE_WORKER_BASE_URL=https://hosted-runner-staging.example.workers.dev
export HOSTED_EXECUTION_SMOKE_USER_ID=member_test_123
export HOSTED_EXECUTION_SMOKE_VERSION_ID=<candidate-version-id>
pnpm --dir apps/cloudflare deploy:smoke
```

If you do not want the script to trigger a manual hosted run, omit `HOSTED_EXECUTION_SMOKE_USER_ID`. If you are smoke testing a gradual rollout, set `HOSTED_EXECUTION_SMOKE_VERSION_ID` so the health check and manual run are pinned to the candidate version instead of the stable version. The smoke helper now polls `GET /internal/users/:id/status` after `POST /run` and fails if the queue never drains, `lastRunAt` does not advance, or no durable bundle refs exist.

## Using the GitHub Actions workflow

The workflow expects the selected GitHub environment to supply `CF_WORKER_NAME`, `CF_BUNDLES_BUCKET`, `CF_BUNDLES_PREVIEW_BUCKET`, and `CF_PUBLIC_BASE_URL` for normal deploy-and-smoke runs. It now validates those variables before install/deploy work begins so a missing public URL fails with a direct message instead of surfacing later as a confusing smoke failure.

The workflow is intentionally manual (`workflow_dispatch`) so you do not accidentally push a half-configured deploy.

Open Actions, then `Deploy Cloudflare Hosted Execution`, and choose:

- `environment`: `staging` or `production`
- `deployment_mode`: `gradual` for normal rollouts, `direct` for first deploys and Durable Object migration rollouts
- `gradual_rollout_percentage`: candidate-version traffic percentage for gradual deployments
- `existing_version_id`: optional already-uploaded version id to promote instead of uploading a fresh version
- `sync_worker_secrets`: whether to include the rendered Worker secrets file in the upload or deploy command
- `deploy_worker`: whether to actually deploy the Worker
- `smoke_user_id`: optional hosted user id to trigger one manual `/run` smoke test

The workflow does this in order:

1. checks out the repo
2. installs pnpm and Node 22
3. installs workspace dependencies
4. runs the focused `apps/cloudflare verify` path
5. renders the generated deploy artifacts
6. optionally uploads a new Worker version and creates a gradual deployment, or falls back to a direct `wrangler deploy` when `deployment_mode=direct`
7. runs the worker health and smoke checks, pinning the candidate version during gradual rollouts
8. writes the uploaded version id, candidate version id, and final traffic split into the GitHub Actions step summary

## First production deploy checklist

Before the first real production deploy, confirm all of these are true:

- Docker is running wherever `wrangler deploy` will execute
- the Worker answers `GET /health`
- `HOSTED_EXECUTION_CONTROL_TOKEN` is set
- `HOSTED_EXECUTION_RUNNER_CONTROL_TOKEN` is set and stable
- local `wrangler dev` also has those two tokens set before you test protected control flows
- `HOSTED_EXECUTION_SMOKE_WORKER_BASE_URL` is set when you plan to run smoke checks against a non-default public Worker URL
- `CF_CONTAINER_INSTANCE_TYPE` is set explicitly to at least `standard-1`, or to a custom JSON object if you have an enterprise plan and need higher fixed limits
- Workers Logs and Workers Traces are enabled and visible in the Cloudflare dashboard for the target Worker
- the R2 bucket names in the generated config are correct
- the bundle encryption key is present and stable
- the intended canary percentage is decided ahead of time, and you know which signal will be used to promote to 100% or roll back
- one seeded hosted user can complete:
  - manual `/run`
  - a Linq inbound message
  - a cron tick
  - a device-sync wake

The first deploy can take a few minutes before native container starts succeed reliably, because Cloudflare has to provision the image the first time.

## What to do right after first deploy

This deploy automation gets you to a real native-container staging posture, but two production-hardening items still matter:

1. keep widening direct scenario coverage for the hosted execution lane, especially real Cloudflare deploy smoke paths and promotion criteria for gradual rollouts
2. extend the current durable assistant outbox approach if other externally visible hosted side effects need the same replay-safe treatment

Until those broader guarantees exist, treat the current lane as controlled rollout infrastructure rather than an excuse to skip operational caution.
