# @murph/cloudflare-runner

Cloudflare-hosted execution plane for the hosted Murph path.

This app is intentionally separate from `apps/web`:

- `apps/web` stays the public onboarding, billing, OAuth, and webhook control plane.
- `apps/cloudflare` handles signed internal dispatch, per-user coordination, encrypted hosted bundle storage, and one-shot execution through `@murph/assistant-runtime`.

## Core responsibilities

- verify signed internal dispatch from `apps/web`
- coordinate per-user runs through a `USER_RUNNER` Durable Object
- store encrypted hosted `vault` and broader `agent-state` bundle snapshots in the `BUNDLES` R2 bucket
- perform durable hosted bootstrap explicitly on `member.activated` instead of mutating vault/assistant config during every run
- restore a temporary execution context for one-shot runs
- start the Durable Object's native Cloudflare container on demand for the runner process
- run the existing Murph inbox, parser, assistant, device-sync, and hosted share-import seams for member activation, direct Linq messages, hosted share acceptance, hosted device-sync wake events, and periodic assistant ticks through the headless `@murph/assistant-runtime` package

## Non-goals

- public browser routes
- canonical hosted health-data storage outside the vault bundle
- a second inbox or assistant runtime model
- operator-blind privacy or TEE claims
- pretending the repo already has fully automatic production rollout

## Worker contract

Current worker bindings read directly by `src/index.ts`:

- `USER_RUNNER`: Durable Object namespace for per-user coordination, queue state, and hosted execution orchestration
- `RUNNER_CONTAINER`: Durable Object namespace for the companion `RunnerContainer` class that owns container startup, port readiness, and idle lifecycle
- `BUNDLES`: R2 bucket for encrypted `vault` and `agent-state` bundle blobs

Current worker env/config names read directly by `src/env.ts`:

- required secret: `HOSTED_EXECUTION_SIGNING_SECRET`
- required secret: `HOSTED_EXECUTION_BUNDLE_ENCRYPTION_KEY`
- required secret: `HOSTED_EXECUTION_CONTROL_TOKEN` gates the operator control routes; missing values now fail those routes closed instead of leaving them open
- required secret: `HOSTED_EXECUTION_RUNNER_CONTROL_TOKEN` gates the private container HTTP server and native container invoke path; missing values now fail closed instead of silently skipping auth
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
- `GET /internal/users/:userId/status` is an operator/internal status route guarded by `HOSTED_EXECUTION_CONTROL_TOKEN`
- `POST /internal/users/:userId/run` is an operator/internal manual-run route guarded by `HOSTED_EXECUTION_CONTROL_TOKEN`
- `GET /internal/users/:userId/env` returns the configured per-user encrypted runner env key names (never the secret values)
- `PUT /internal/users/:userId/env` merges or replaces the user's separately encrypted hosted env object
- `DELETE /internal/users/:userId/env` clears the user's separately encrypted hosted env object without rewriting `agent-state`

`apps/cloudflare/wrangler.jsonc` is the checked-in scaffold for those bindings, env names, and the native container image reference. It intentionally leaves bucket names, worker name, and secrets as placeholders until a real Cloudflare account target exists, but it now pins the native container to the baseline `basic` instance type instead of relying on Cloudflare defaults.

## Native container contract

The primary production path uses Cloudflare's native container support through a companion `RunnerContainer` class configured alongside `UserRunnerDurableObject` in `wrangler.jsonc`.

That means:

- the Worker receives signed internal dispatch
- the per-user Durable Object keeps queue/process state in its SQLite storage tables (`runner_meta`, `pending_events`, `consumed_events`, and `poisoned_events`) instead of one serialized record blob
- the Worker's internal control routes call direct Durable Object methods such as `dispatch`, `commit`, `finalizeCommit`, `status`, and per-user env updates instead of routing those control hops back through worker-local `fetch()` URLs
- the per-user Durable Object invokes a same-name `RunnerContainer` instance on demand
- the `RunnerContainer` uses the official `@cloudflare/containers` `Container` class to handle startup, port readiness, per-run env injection, and host-specific outbound interception before forwarding the encrypted bundle payloads and dispatch into the internal runner bridge
- the runner process posts durable commit/finalize and assistant-delivery reconciliation requests to `http://commit.worker` and `http://outbox.worker`; those outbound handlers run inside Workers, call Durable Objects and R2 directly, and never traverse the public Worker URL
- the container-local bridge is intentionally thin; the execution core lives in `packages/assistant-runtime`
- the queue Durable Object keeps the per-user container warm across drained batches and relies on the container's configurable `sleepAfter` idle timeout, defaulting to `5m`, instead of forcing immediate teardown after every run

The native container image is declared in `apps/cloudflare/wrangler.jsonc` under the `containers` section, points at `../../Dockerfile.cloudflare-hosted-runner`, uses `instance_type: "basic"` in the checked-in scaffold, and now keeps the default `max_instances` at `50` until deploy automation raises it explicitly. Generated deploy config accepts `CF_CONTAINER_INSTANCE_TYPE` as either a named Wrangler preset such as `basic` or a JSON object with `vcpu`, `memory_mib`, and `disk_mb`.

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
- optional allowlist extension vars `HOSTED_EXECUTION_ALLOWED_USER_ENV_KEYS` and `HOSTED_EXECUTION_ALLOWED_USER_ENV_PREFIXES` when separately encrypted per-user env overrides need to cover additional key names
- encrypted per-user overrides are read from a dedicated per-user hosted object, injected into the one-shot runtime request, and the default hosted execution path runs each job in an isolated child process so per-user env overrides no longer force container-wide request serialization

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
- final container-capacity tuning beyond the explicit `basic` baseline
- fully automatic canary promotion without an operator decision

For the end-to-end deployment path, including the GitHub Actions workflow and generated deploy artifacts, see `apps/cloudflare/DEPLOY.md`.

## Verification

The Cloudflare app now keeps two focused Vitest lanes:

- `pnpm --dir apps/cloudflare test` keeps the default fast loop: app-local typecheck plus the Node-based unit and integration coverage for auth, journaling, bundle storage, control routes, and the one-shot runner path.
- `pnpm --dir apps/cloudflare test:workers` runs only the smaller Workers-runtime suite through `@cloudflare/vitest-pool-workers`, covering signed dispatch, direct Durable Object RPC, Durable Object alarms, bundle journaling, and runner control flows inside the actual Workers runtime.
- `pnpm --dir apps/cloudflare verify` runs app-local typecheck once, then both the Node and Workers-runtime lanes.

## Operational notes

- The worker never stores plaintext vault material in Durable Object storage. It stores only per-user coordination state plus encrypted bundle references.
- Hosted bundle reads/writes and per-user env object updates happen outside the Durable Object's SQLite mutation step; only the final bundle-ref/version compare-and-swap is committed inside Durable Object storage.
- `vault` and `agent-state` are always written back as encrypted R2 blobs. `agent-state` includes sibling `assistant-state` plus the minimal operator-home config needed for explicit `member.activated` bootstrap. Vault `.runtime/**` stays local-only and is not bundled into hosted `agent-state`, and per-user runner env overrides live in their own encrypted hosted object.
- Bundle writes are skipped when the bundle content hash and byte length are unchanged, which helps avoid unnecessary R2 write churn on no-op assistant/device-sync passes.
- Hosted one-shot runs now collect due outward side effects with the committed hosted result, then the runner drains those committed side effects after the durable commit succeeds. Assistant replies are the first concrete side-effect kind on that path and still originate from the assistant outbox intents in `assistant-state/`.
- Broad hosted idempotency no longer depends on that runner lane alone: `apps/web` uses the shared Postgres `execution_outbox` for Cloudflare dispatches, hosted webhook receipts keep their own durable side-effect state for Linq replies, and RevNet issuance stays on its invoice-owned idempotency path.
- Follow-up hosted events now require an already bootstrapped member context; they no longer create the vault or force-enable Linq auto-reply as a hidden side effect.
- The checked-in Wrangler scaffold now explicitly enables Workers Logs and Workers Traces so request logs, container logs, and trace spans are available before production rollout. The generated deploy config exposes log and trace sampling through `CF_LOG_HEAD_SAMPLING_RATE` and `CF_TRACE_HEAD_SAMPLING_RATE`.
- Normal deployment flow now separates version upload from deployment. After the first deploy, the GitHub Actions workflow and local rollout helper upload a version, create a gradual deployment, and pin smoke checks to the candidate version. First deploys still require a direct `wrangler deploy`, and the rollout helper now refuses gradual mode when the rendered config introduces a newer Durable Object migration tag than the currently allowed gradual-deploy set.
- Frequent deploys can accumulate old managed-registry tags. Use `pnpm --dir apps/cloudflare images:cleanup -- --filter '<repo-regex>' --keep 10` first, then add `--apply` once the dry-run plan looks correct.
- The checked-in deploy surface now documents and forwards only the canonical runtime vars that the container actually consumes, such as `AGENTMAIL_BASE_URL`, `FFMPEG_COMMAND`, `PADDLEOCR_COMMAND`, `WHISPER_COMMAND`, and `WHISPER_MODEL_PATH`.
- Manual deploy smoke no longer stops at `POST /run` acceptance. It now polls the operator status route until the queue drains, `lastRunAt` advances, and durable bundle refs exist, so a broken containerized run does not look healthy just because the enqueue succeeded.
- The checked-in Wrangler scaffold and rendered deploy config now declare the four required hosted runtime secrets through Wrangler's experimental `secrets.required` support, so local `wrangler` validation and deploy/version uploads fail early when those names are unset. Keep that list tight and treat optional provider secrets as separately managed Worker configuration.
- The repo now ships `apps/cloudflare/r2-bundles-lifecycle.json` plus `pnpm --dir apps/cloudflare r2:lifecycle:apply` so the configured bundles buckets can expire transient execution journals and committed side-effect journal objects under `transient/execution-journal/` and `transient/side-effects/` after 30 days.

## Runtime boundary

`apps/cloudflare` should treat `@murph/assistant-runtime` as its hosted execution surface. The worker/container app owns dispatch verification, bundle storage, control routes, and container lifecycle; the headless package owns one-shot hosted execution behavior. The app-local no-emit typecheck now includes the Node runner and container entrypoint files.

## Known follow-ups

- Only assistant delivery is implemented as a hosted side-effect kind today. Future provider mutations, callbacks, or outbound deliveries should extend the same committed side-effect journal rather than bypassing it.
- Cloudflare container lifecycle is currently "start on demand, keep warm until `sleepAfter` expires." If you later want explicit pooling or lease management, that should be a separate follow-up rather than an implicit background contract.
- The internal `commit.worker` / `outbox.worker` / `email.worker` callback hosts remain the current durable boundary. The next simplification pass should have the container return a fuller final result to the Durable Object so the Worker can eventually collapse those callback hostnames without changing first-canary behavior now.
