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
- run the existing Healthy Bob inbox, parser, assistant, and device-sync seams for member activation, direct Linq messages, hosted device-sync wake events, and periodic assistant ticks

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

- required secret: `HOSTED_EXECUTION_SIGNING_SECRET`
- required secret: `HOSTED_EXECUTION_BUNDLE_ENCRYPTION_KEY`
- optional non-secret: `HOSTED_EXECUTION_BUNDLE_ENCRYPTION_KEY_ID` defaults to `v1`
- optional secret: `HOSTED_EXECUTION_CONTROL_TOKEN` gates the operator control routes
- optional non-secret: `HOSTED_EXECUTION_DEFAULT_ALARM_DELAY_MS` defaults to `900000`
- optional non-secret: `HOSTED_EXECUTION_MAX_EVENT_ATTEMPTS` defaults to `3`
- optional non-secret: `HOSTED_EXECUTION_RETRY_DELAY_MS` defaults to `30000`
- required in practice for actual runs: `HOSTED_EXECUTION_RUNNER_BASE_URL`
- optional secret: `HOSTED_EXECUTION_RUNNER_CONTROL_TOKEN`

Current worker routes:

- `GET /health` returns a lightweight health payload
- `GET /` returns the service banner payload
- `POST /internal/dispatch` accepts only signed internal dispatch from `apps/web`
- `POST /internal/events` is an alias for the same signed internal dispatch contract
- `GET /internal/users/:userId/status` is an operator/internal status route guarded by `HOSTED_EXECUTION_CONTROL_TOKEN` when that token is configured
- `POST /internal/users/:userId/run` is an operator/internal manual-run route guarded by `HOSTED_EXECUTION_CONTROL_TOKEN` when that token is configured

`apps/cloudflare/wrangler.jsonc` is the current manual scaffold for those bindings and env names. It intentionally leaves bucket names, service names, and secrets as explicit placeholders until a real Cloudflare account target exists.

## Runner container contract

The Durable Object calls a separate Node HTTP runner at:

- `POST /__internal/run`

Current expectations for that runner container:

- Node `>=22.16.0`
- workspace dependencies installed from this repo, because the current runner starts from source via `tsx` and `apps/cloudflare/src/runner-server.ts`
- writable temp storage for ephemeral hosted bundle restore/snapshot work
- `PORT` to choose the listen port, defaulting to `8080`
- `HOSTED_EXECUTION_RUNNER_CONTROL_TOKEN` when the internal runner endpoint should require bearer auth
- optional provider/runtime env such as `WHOOP_CLIENT_ID`, `WHOOP_CLIENT_SECRET`, `OURA_CLIENT_ID`, `OURA_CLIENT_SECRET`, and `DEVICE_SYNC_PUBLIC_BASE_URL` when the one-shot runner should execute hosted device-sync work instead of skipping it
- any additional operator/provider env needed by the reused Healthy Bob CLI and inbox runtime seams remains operator-supplied and is intentionally not hard-coded here

`Dockerfile.cloudflare-hosted-runner` is the current manual scaffold for that container. It is intentionally unoptimized and repo-source-based because the repo does not yet expose a packaged standalone runner binary.

## Deployment status

Current scaffold files:

- `apps/cloudflare/wrangler.jsonc`
- `Dockerfile.cloudflare-hosted-runner`
- `.dockerignore`

Still intentionally placeholder:

- real Cloudflare account ids, domains, and service names
- final bucket names
- secret provisioning automation
- CI/CD deploy jobs
- a slim production image or standalone built runner entrypoint

## Typecheck note

The app-local no-emit typecheck excludes the Node runner bridge files that import the current `healthybob` runtime directly. Those files are still exercised by the app Vitest suite; the exclusion keeps this app's typecheck scoped to its own source while unrelated in-flight CLI typing issues remain elsewhere in the workspace.
