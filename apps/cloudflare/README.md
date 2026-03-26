# @healthybob/cloudflare-runner

Cloudflare-hosted execution plane for the hosted Healthy Bob path.

This app is intentionally separate from `apps/web`:

- `apps/web` stays the public onboarding, billing, OAuth, and webhook control plane.
- `apps/cloudflare` handles signed internal dispatch, per-user coordination, encrypted hosted bundle storage, and one-shot execution against the existing Healthy Bob inbox and assistant runtime seams.

## Core responsibilities

- verify signed internal dispatch from `apps/web`
- coordinate per-user runs through a `USER_RUNNER` Durable Object
- store encrypted hosted vault and broader `agent-state` bundle snapshots in the `BUNDLES` R2 bucket
- restore a temporary execution context for one-shot runs
- run the existing Healthy Bob inbox, parser, assistant, device-sync, and hosted share-import seams for member activation, direct Linq messages, hosted share acceptance, hosted device-sync wake events, and periodic assistant ticks

## Non-goals

- public browser routes
- canonical hosted health-data storage outside the vault bundle
- a second inbox or assistant runtime model
- operator-blind privacy or TEE claims
- pretending the repo already has account-specific Cloudflare deploy automation

## Worker contract

Current worker bindings read directly by `src/index.ts`:

- `USER_RUNNER`: Durable Object namespace for per-user coordination
- `BUNDLES`: R2 bucket for encrypted `vault` and `agent-state` bundle blobs

Current worker env/config names read directly by `src/env.ts`:

- required secret: `HOSTED_EXECUTION_SIGNING_SECRET` (the worker also accepts the historical alias `HOSTED_EXECUTION_CLOUDFLARE_SIGNING_SECRET`)
- required secret: `HOSTED_EXECUTION_BUNDLE_ENCRYPTION_KEY` (the worker also accepts the historical alias `HB_HOSTED_BUNDLE_KEY`)
- optional non-secret: `HOSTED_EXECUTION_ALLOWED_USER_ENV_KEYS` extends the per-user encrypted env key allowlist in both the worker and runner
- optional non-secret: `HOSTED_EXECUTION_ALLOWED_USER_ENV_PREFIXES` extends the per-user encrypted env prefix allowlist in both the worker and runner
- optional non-secret: `HOSTED_EXECUTION_BUNDLE_ENCRYPTION_KEY_ID` defaults to `v1`
- optional secret: `HOSTED_EXECUTION_CONTROL_TOKEN` gates the operator control routes
- optional non-secret: `HOSTED_EXECUTION_DEFAULT_ALARM_DELAY_MS` defaults to `900000`
- optional non-secret: `HOSTED_EXECUTION_MAX_EVENT_ATTEMPTS` defaults to `3`
- optional non-secret: `HOSTED_EXECUTION_RETRY_DELAY_MS` defaults to `30000`
- required in practice for actual runs: `HOSTED_EXECUTION_RUNNER_BASE_URL`
- optional secret: `HOSTED_EXECUTION_RUNNER_CONTROL_TOKEN`
- optional non-secret: `HOSTED_EXECUTION_RUNNER_TIMEOUT_MS` defaults to `60000`

Current worker routes:

- `GET /health` returns a lightweight health payload and does not require the runtime secrets to be present
- `GET /` returns the service banner payload
- `POST /internal/dispatch` accepts only signed internal dispatch from `apps/web` for member activation, hosted share acceptance, Linq message fan-in, and later scheduled work
- `POST /internal/events` is an alias for the same signed internal dispatch contract
- `GET /internal/users/:userId/status` is an operator/internal status route guarded by `HOSTED_EXECUTION_CONTROL_TOKEN` when that token is configured
- `POST /internal/users/:userId/run` is an operator/internal manual-run route guarded by `HOSTED_EXECUTION_CONTROL_TOKEN` when that token is configured
- `GET /internal/users/:userId/env` returns the configured per-user encrypted runner env key names (never the secret values)
- `PUT /internal/users/:userId/env` merges or replaces encrypted per-user runner env overrides inside the user's `agent-state` bundle
- `DELETE /internal/users/:userId/env` clears the encrypted per-user runner env override file while preserving other `agent-state` contents

`apps/cloudflare/wrangler.jsonc` is the current manual scaffold for those bindings and env names. It intentionally leaves bucket names, service names, and secrets as explicit placeholders until a real Cloudflare account target exists.

## Runner container contract

The Durable Object calls a separate Node HTTP runner at:

- `GET /health`
- `POST /__internal/run`

Current expectations for that runner container:

- Node `>=22.16.0`
- workspace dependencies installed from this repo, because the current runner starts from source via `tsx` and `apps/cloudflare/src/runner-server.ts`
- writable temp storage for ephemeral hosted bundle restore/snapshot work
- `PORT` to choose the listen port, defaulting to `8080`
- `HOSTED_EXECUTION_RUNNER_CONTROL_TOKEN` when the internal runner endpoint should require bearer auth
- optional provider/runtime env such as `WHOOP_CLIENT_ID`, `WHOOP_CLIENT_SECRET`, `OURA_CLIENT_ID`, `OURA_CLIENT_SECRET`, `DEVICE_SYNC_PUBLIC_BASE_URL`, `DEVICE_SYNC_SECRET`, `LINQ_API_BASE_URL`, `LINQ_API_TOKEN`, `AGENTMAIL_API_KEY`, `TELEGRAM_BOT_TOKEN`, `OPENAI_API_KEY`, and related model-provider keys when the one-shot runner should execute hosted device-sync work and assistant replies instead of skipping them
- optional allowlist extension vars `HOSTED_EXECUTION_ALLOWED_USER_ENV_KEYS` and `HOSTED_EXECUTION_ALLOWED_USER_ENV_PREFIXES` when encrypted per-user env overrides need to cover additional key names
- encrypted per-user overrides are loaded from `.healthybob/hosted/user-env.json` inside the user's `agent-state` bundle, applied only for the duration of that user's one-shot run, and then removed from process env again before the worker goes idle
- any additional operator/provider env needed by the reused Healthy Bob CLI and inbox runtime seams remains operator-supplied and is intentionally not hard-coded here

`Dockerfile.cloudflare-hosted-runner` is the current manual scaffold for that container. It installs the repo workspace plus common Linux parser dependencies (`ffmpeg`, `poppler-utils`, Python tooling) so the runtime does not reinstall those packages on each wake. Large model weights and any custom toolchain artifacts are still expected to be mounted or baked in separately under `/root/.healthybob`.

## Deployment status

Current scaffold files:

- `apps/cloudflare/wrangler.jsonc`
- `apps/cloudflare/.dev.vars.example`
- `apps/cloudflare/.runner.env.example`
- `Dockerfile.cloudflare-hosted-runner`
- `.dockerignore`

Still intentionally placeholder:

- real Cloudflare account ids, domains, and service names
- final bucket names
- secret provisioning automation
- CI/CD deploy jobs
- a slim production image or standalone built runner entrypoint

## Setup

1. Create or choose a Cloudflare Workers Paid account and create the R2 bucket names you want for hosted bundles.
2. Update `apps/cloudflare/wrangler.jsonc` with the real bucket names and the real worker name.
3. Copy `apps/cloudflare/.dev.vars.example` to `apps/cloudflare/.dev.vars` for local development, or set the same values through the Cloudflare secret/vars UI for deployed environments. Generate `HOSTED_EXECUTION_BUNDLE_ENCRYPTION_KEY` with a 32-byte base64 value such as `openssl rand -base64 32`.
4. Build and run the separate hosted runner container:
   - `cp apps/cloudflare/.runner.env.example apps/cloudflare/.runner.env`
   - `pnpm --dir apps/cloudflare runner:docker:build`
   - `pnpm --dir apps/cloudflare runner:docker:run`
5. Point `HOSTED_EXECUTION_RUNNER_BASE_URL` at the runner container's internal HTTPS URL.
6. Deploy the worker with Wrangler from `apps/cloudflare`:
   - `pnpm --dir apps/cloudflare worker:deploy`
7. In `apps/web` / Vercel, set:
   - `HOSTED_EXECUTION_CLOUDFLARE_BASE_URL`
   - `HOSTED_EXECUTION_CLOUDFLARE_SIGNING_SECRET`
8. Confirm the Cloudflare worker answers `GET /health` and the runner container answers `GET /health`, then trigger `POST /internal/users/:userId/run` with the operator token for a smoke run.
9. When a hosted user needs their own Telegram bot/model-provider/AgentMail credentials, call `PUT /internal/users/:userId/env` with a body like `{ "mode": "merge", "env": { "TELEGRAM_BOT_TOKEN": "...", "OPENAI_API_KEY": "..." } }`. Those values are stored only inside the encrypted `agent-state` bundle and are reapplied automatically on future cron/webhook runs.

## Operational notes

- The worker never stores plaintext vault material in Durable Object storage. It stores only per-user coordination state plus encrypted bundle references.
- `vault` and `agent-state` are always written back as encrypted R2 blobs. `agent-state` now includes sibling `assistant-state`, hosted `.runtime/**`, the minimal operator-home config needed for bootstrap, and the encrypted per-user runner env file when one is configured.
- Bundle writes are skipped when the bundle content hash and byte length are unchanged, which helps avoid unnecessary R2 write churn on no-op assistant/device-sync passes.
- The operator control routes are internal surfaces only. Put them behind service-to-service auth and keep `HOSTED_EXECUTION_CONTROL_TOKEN` set outside source control.

## Typecheck note

The app-local no-emit typecheck excludes the Node runner bridge files that import the current `healthybob` runtime directly. Those files are still exercised by the app Vitest suite; the exclusion keeps this app's typecheck scoped to its own source while unrelated in-flight CLI typing issues remain elsewhere in the workspace.
