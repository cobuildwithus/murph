# @healthybob/cloudflare-runner

Cloudflare-hosted execution plane for the hosted Healthy Bob path.

This app is intentionally separate from `apps/web`:

- `apps/web` stays the public onboarding, billing, OAuth, and webhook control plane.
- `apps/cloudflare` handles signed internal dispatch, per-user coordination, encrypted hosted bundle storage, and one-shot execution through `@healthybob/assistant-runtime`.

## Core responsibilities

- verify signed internal dispatch from `apps/web`
- coordinate per-user runs through a `USER_RUNNER` Durable Object
- store encrypted hosted `vault` and broader `agent-state` bundle snapshots in the `BUNDLES` R2 bucket
- restore a temporary execution context for one-shot runs
- start the Durable Object's native Cloudflare container on demand for the runner process
- run the existing Healthy Bob inbox, parser, assistant, device-sync, and hosted share-import seams for member activation, direct Linq messages, hosted share acceptance, hosted device-sync wake events, and periodic assistant ticks through the headless `@healthybob/assistant-runtime` package

## Non-goals

- public browser routes
- canonical hosted health-data storage outside the vault bundle
- a second inbox or assistant runtime model
- operator-blind privacy or TEE claims
- pretending the repo already has fully automatic production rollout

## Worker contract

Current worker bindings read directly by `src/index.ts`:

- `USER_RUNNER`: Durable Object namespace for per-user coordination and container lifecycle
- `BUNDLES`: R2 bucket for encrypted `vault` and `agent-state` bundle blobs

Current worker env/config names read directly by `src/env.ts`:

- required secret: `HOSTED_EXECUTION_SIGNING_SECRET` (the worker also accepts the historical alias `HOSTED_EXECUTION_CLOUDFLARE_SIGNING_SECRET`)
- required secret: `HOSTED_EXECUTION_BUNDLE_ENCRYPTION_KEY`
- required in practice: `HOSTED_EXECUTION_CLOUDFLARE_BASE_URL` so the containerized runner can call the worker's internal commit/finalize/outbox routes
- optional secret: `HOSTED_EXECUTION_CONTROL_TOKEN` gates the operator control routes
- optional secret: `HOSTED_EXECUTION_RUNNER_CONTROL_TOKEN` gates the internal worker commit/finalize/outbox routes and the private container HTTP server
- optional non-secret: `HOSTED_EXECUTION_ALLOWED_USER_ENV_KEYS` extends the per-user encrypted env key allowlist in both the worker and container
- optional non-secret: `HOSTED_EXECUTION_ALLOWED_USER_ENV_PREFIXES` extends the per-user encrypted env prefix allowlist in both the worker and container
- optional non-secret: `HOSTED_EXECUTION_BUNDLE_ENCRYPTION_KEY_ID` defaults to `v1`
- optional non-secret: `HOSTED_EXECUTION_DEFAULT_ALARM_DELAY_MS` defaults to `21600000` in the checked-in Wrangler scaffold
- optional non-secret: `HOSTED_EXECUTION_MAX_EVENT_ATTEMPTS` defaults to `3`
- optional non-secret: `HOSTED_EXECUTION_RETRY_DELAY_MS` defaults to `30000`
- optional non-secret: `HOSTED_EXECUTION_RUNNER_TIMEOUT_MS` defaults to `60000`
- optional non-secret: `HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS` defaults to `30000` and is forwarded into the container runtime
- optional provider/toolchain vars and secrets configured on the Worker are forwarded into the container through `src/runner-env.ts`

Current worker routes:

- `GET /health` returns a lightweight health payload and does not require the runtime secrets to be present
- `GET /` returns the service banner payload
- `POST /internal/dispatch` accepts only signed internal dispatch from `apps/web`
- `POST /internal/events` is an alias for the same signed internal dispatch contract
- `GET /internal/users/:userId/status` is an operator/internal status route guarded by `HOSTED_EXECUTION_CONTROL_TOKEN` when that token is configured
- `POST /internal/users/:userId/run` is an operator/internal manual-run route guarded by `HOSTED_EXECUTION_CONTROL_TOKEN` when that token is configured
- `GET /internal/users/:userId/env` returns the configured per-user encrypted runner env key names (never the secret values)
- `PUT /internal/users/:userId/env` merges or replaces encrypted per-user env overrides inside the user's `agent-state` bundle
- `DELETE /internal/users/:userId/env` clears the encrypted per-user runner env override file while preserving other `agent-state` contents
- `POST /internal/runner-events/:userId/:eventId/commit` records the committed hosted bundles and per-event journal entry before assistant outbox drain
- `POST /internal/runner-events/:userId/:eventId/finalize` updates the committed journal entry with any bundle changes made after outbox drain
- `GET|PUT /internal/runner-outbox/:userId/:intentId` reads or records hosted assistant delivery reconciliation for the durable post-commit outbox path

`apps/cloudflare/wrangler.jsonc` is the checked-in scaffold for those bindings, env names, and the native container image reference. It intentionally leaves bucket names, worker name, and secrets as placeholders until a real Cloudflare account target exists.

## Native container contract

The primary production path uses Cloudflare's native container support through a companion `RunnerContainer` class configured alongside `UserRunnerDurableObject` in `wrangler.jsonc`.

That means:

- the Worker receives signed internal dispatch
- the per-user Durable Object keeps queue/process state in its SQLite storage tables (`runner_meta`, `pending_events`, `consumed_events`, and `poisoned_events`) instead of one serialized record blob
- the Worker's internal control routes call direct Durable Object methods such as `dispatch`, `commit`, `finalizeCommit`, `status`, and per-user env updates instead of routing those control hops back through worker-local `fetch()` URLs
- the per-user Durable Object invokes a same-name `RunnerContainer` instance on demand
- the `RunnerContainer` uses the official `@cloudflare/containers` `Container` class to handle startup, port readiness, and per-run env injection before forwarding the encrypted bundle payloads and dispatch into the internal runner bridge
- the runner process calls back to the worker's internal commit/finalize/outbox routes so the existing durable hosted assistant outbox and bundle-journal flow remains intact
- the container-local bridge is intentionally thin; the execution core lives in `packages/assistant-runtime`
- the queue Durable Object still destroys the companion container after each drained batch instead of keeping its own lease manager

The native container image is declared in `apps/cloudflare/wrangler.jsonc` under the `containers` section and points at `../../Dockerfile.cloudflare-hosted-runner`.

## Container image

`Dockerfile.cloudflare-hosted-runner` builds the container image used by Wrangler. Inside that image, the private container entrypoint still serves:

- `GET /health`
- `POST /__internal/run`

That HTTP bridge is an internal container implementation detail, not a separately supported hosted service or repo-supported local command surface. The repo no longer supports an external `HOSTED_EXECUTION_RUNNER_BASE_URL` path.

Current expectations for the container image:

- Node `>=22.16.0`
- workspace dependencies installed from this repo
- writable temp storage for ephemeral hosted bundle restore/snapshot work
- `PORT` for the internal bridge listen port, defaulting to `8080`
- provider/runtime env such as WHOOP, Oura, Linq, AgentMail, Telegram, and model-provider keys when the one-shot runner should execute those surfaces instead of skipping them
- optional allowlist extension vars `HOSTED_EXECUTION_ALLOWED_USER_ENV_KEYS` and `HOSTED_EXECUTION_ALLOWED_USER_ENV_PREFIXES` when encrypted per-user env overrides need to cover additional key names
- encrypted per-user overrides are loaded from `.healthybob/hosted/user-env.json` inside the user's `agent-state` bundle, forwarded into the one-shot runtime context, and the default hosted execution path runs each job in an isolated child process so per-user env overrides no longer force container-wide request serialization

## Deployment status

Current scaffold files:

- `apps/cloudflare/wrangler.jsonc`
- `apps/cloudflare/.dev.vars.example`
- `apps/cloudflare/DEPLOY.md`
- `Dockerfile.cloudflare-hosted-runner`
- `.dockerignore`

Still intentionally placeholder:

- real Cloudflare account ids, domains, and worker names
- final bucket names
- final container-capacity tuning
- fully automated production rollout and smoke orchestration

For the end-to-end deployment path, including the GitHub Actions workflow and generated deploy artifacts, see `apps/cloudflare/DEPLOY.md`.

## Operational notes

- The worker never stores plaintext vault material in Durable Object storage. It stores only per-user coordination state plus encrypted bundle references.
- Hosted bundle reads/writes and per-user env bundle updates happen outside the Durable Object's SQLite mutation step; only the final bundle-ref/version compare-and-swap is committed inside Durable Object storage.
- `vault` and `agent-state` are always written back as encrypted R2 blobs. `agent-state` includes sibling `assistant-state`, the minimal operator-home config needed for bootstrap, and the encrypted per-user runner env file when one is configured. Vault `.runtime/**` stays local-only and is not bundled into hosted `agent-state`.
- Bundle writes are skipped when the bundle content hash and byte length are unchanged, which helps avoid unnecessary R2 write churn on no-op assistant/device-sync passes.
- Hosted assistant replies still queue during the one-shot run, the committed hosted bundles are durably recorded first, and only then does the runner drain the assistant outbox with the hosted delivery journal for reconciliation.

## Runtime boundary

`apps/cloudflare` should treat `@healthybob/assistant-runtime` as its hosted execution surface. The worker/container app owns dispatch verification, bundle storage, control routes, and container lifecycle; the headless package owns one-shot hosted execution behavior. The app-local no-emit typecheck now includes the Node runner and container entrypoint files.

## Known follow-ups

- The current journal plus durable commit/finalize path protects bundle consistency and hosted assistant delivery reconciliation, but it does not yet provide a generalized outbox for every externally visible side effect.
- Cloudflare container lifecycle is currently "start on demand, destroy after drained batch." If you later want keep-warm or pool behavior, that should be a separate follow-up rather than an implicit background contract.
