# @murphai/cloudflare-runner

Cloudflare-hosted execution plane for the hosted Murph path.

This app is intentionally separate from `apps/web`:

- `apps/web` stays the public onboarding, billing, OAuth, and webhook control plane.
- `apps/cloudflare` handles Vercel OIDC-authenticated web control/dispatch through an app-local auth adapter, per-user coordination, encrypted hosted bundle storage, and one-shot execution through `@murphai/assistant-runtime`.

## Core responsibilities

- verify Vercel OIDC-authenticated dispatch and control requests from `apps/web` through the app-local auth adapter
- coordinate per-user runs through a `USER_RUNNER` Durable Object
- store one encrypted hosted workspace snapshot in the existing `vault` bundle slot plus separately encrypted raw-artifact objects in the `BUNDLES` R2 bucket
- perform durable hosted bootstrap explicitly on `member.activated`
- restore a temporary execution context for one-shot runs
- start the Durable Object's native Cloudflare container on demand for the runner process
- run the existing Murph inbox, parser, assistant, device-sync, and hosted share-import seams for member activation, direct Linq messages, hosted share acceptance, hosted device-sync wake events, and periodic assistant ticks through the headless `@murphai/assistant-runtime` package
- hydrate opaque hosted share packs from Cloudflare storage only when a `vault.share.accepted` runner job is about to import them

## Non-goals

- public browser routes
- canonical hosted health-data storage outside the vault bundle
- a second inbox or assistant runtime model
- operator-blind privacy claims in the current managed-hosted mode (the worker still retains the automation unwrap path)
- pretending that future TEE-only or browser user-unlock lanes are already active before those recipients exist
- pretending the repo already has fully automatic production rollout

## Worker contract

Current worker bindings read directly by `src/index.ts`:

- `USER_RUNNER`: Durable Object namespace for per-user coordination, queue state, and hosted execution orchestration
- `RUNNER_CONTAINER`: Durable Object namespace for the companion `RunnerContainer` class that owns container startup, port readiness, and idle lifecycle
- `BUNDLES`: R2 bucket for encrypted hosted workspace snapshots in the `vault` slot, separately encrypted artifact objects, transient journals, and encrypted per-user env objects

Current worker env/config names read directly by `src/env.ts`:

- required secret: `HOSTED_EXECUTION_PLATFORM_ENVELOPE_KEY`
- required secret: `HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PRIVATE_JWK`
- required secret: `HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PUBLIC_JWK`
- required secret: `HOSTED_EXECUTION_RECOVERY_RECIPIENT_PUBLIC_JWK`
- required secret: `HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK` signs Cloudflare-owned callback requests back into `apps/web`
- optional non-secret: `HOSTED_WEB_CALLBACK_SIGNING_KEY_ID` defaults to `v1` and selects the active callback signing key id
- required non-secret: `HOSTED_EXECUTION_VERCEL_OIDC_TEAM_SLUG`
- required non-secret: `HOSTED_EXECUTION_VERCEL_OIDC_PROJECT_NAME`
- optional non-secret: `HOSTED_EXECUTION_VERCEL_OIDC_ENVIRONMENT` defaults to `production`
- required non-secret: `HOSTED_WEB_BASE_URL`
- optional secret: `HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PRIVATE_KEYRING_JSON` allows staged rotation of the automation unwrap key
- optional non-secret: `HOSTED_EXECUTION_RECOVERY_RECIPIENT_KEY_ID` defaults to `recovery:v1`
- optional non-secret: `HOSTED_EXECUTION_TEE_AUTOMATION_RECIPIENT_KEY_ID` selects a future enclave-only automation recipient and must be paired with the matching public JWK when enabled
- optional secret: `HOSTED_EXECUTION_TEE_AUTOMATION_RECIPIENT_PUBLIC_JWK` publishes the future enclave-only automation recipient when that lane is enabled
- optional secret: `HOSTED_EMAIL_CLOUDFLARE_API_TOKEN` enables hosted email delivery through Cloudflare Email Routing
- optional secret: `HOSTED_EMAIL_SIGNING_SECRET` enables trusted hosted email ingress token generation and verification
- optional non-secret: `HOSTED_EXECUTION_ALLOWED_USER_ENV_KEYS` extends the exact per-user encrypted env key allowlist in both the worker and container
- optional non-secret: `HOSTED_EMAIL_CLOUDFLARE_ACCOUNT_ID` selects the Cloudflare account used for hosted email sends
- optional non-secret: `HOSTED_EMAIL_CLOUDFLARE_API_BASE_URL` overrides the Cloudflare API base URL for hosted email delivery
- optional non-secret: `HOSTED_EMAIL_DEFAULT_SUBJECT` overrides the default hosted email subject
- optional non-secret: `HOSTED_EMAIL_DOMAIN`, `HOSTED_EMAIL_FROM_ADDRESS`, and `HOSTED_EMAIL_LOCAL_PART` configure the fixed hosted email sender identity plus stable per-user reply aliases
- optional non-secret: `HOSTED_EXECUTION_PLATFORM_ENVELOPE_KEY_ID` defaults to `v1`
- optional secret: `HOSTED_EXECUTION_PLATFORM_ENVELOPE_KEYRING_JSON` may provide a JSON object of `{ keyId: base64Key }` entries so already-addressed hosted ciphertext can still decrypt during key rotation
- optional non-secret: `HOSTED_EXECUTION_DEFAULT_ALARM_DELAY_MS` defaults to `21600000` in the checked-in Wrangler scaffold
- optional non-secret: `HOSTED_EXECUTION_MAX_EVENT_ATTEMPTS` defaults to `3`
- optional non-secret: `HOSTED_EXECUTION_RETRY_DELAY_MS` defaults to `30000`
- optional non-secret: `HOSTED_EXECUTION_RUNNER_TIMEOUT_MS` defaults to `120000`
- optional non-secret: `HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS` defaults to `30000` and is forwarded into the container runtime
- optional non-secret: `HOSTED_ASSISTANT_*` vars choose the explicit platform-managed hosted assistant profile that hosted bootstrap persists into `~/.murph/config.json`. `HOSTED_ASSISTANT_API_KEY_ENV` names the env var to read at runtime; it is never the raw API key itself
- optional provider/toolchain vars and secrets configured on the Worker are forwarded into the container only when `src/runner-env.ts` explicitly names the exact keys; broad prefix forwarding is intentionally not part of the hosted runner contract

Hosted email on this worker keeps the public `From` identity fixed while new outbound sends reuse one stable per-user reply alias. Registered members can also start a thread by emailing that fixed public sender address once their verified email has been synced into hosted execution; the worker resolves that direct inbox only through an encrypted verified-owner index and still re-authorizes the sender before raw-message persistence or hosted dispatch. Learning another member's alias is not enough to reach that member's vault, and neither is addressing the public mailbox from an unregistered or mismatched sender. Legacy per-thread reply aliases are no longer accepted.

Current worker routes:

- `GET /health` returns a lightweight health payload and does not require the runtime secrets to be present
- `GET /` returns the service banner payload
- `POST /internal/dispatch` accepts only Vercel OIDC-authenticated dispatch from `apps/web`
- `GET /internal/users/:userId/status` is an internal status route guarded by Vercel OIDC workload identity
- `POST /internal/users/:userId/run` is an internal manual-run route guarded by Vercel OIDC workload identity
- `GET /internal/users/:userId/env` returns the configured per-user encrypted runner env key names (never the secret values)
- `PUT /internal/users/:userId/env` merges or replaces the user's separately encrypted hosted env object
- `DELETE /internal/users/:userId/env` clears the user's separately encrypted hosted env object without rewriting the hosted vault bundle
- `PUT /internal/users/:userId/crypto-context` explicitly provisions or reconciles the managed hosted root-key envelope for the user before runtime access
- `PUT|DELETE /internal/users/:userId/shares/:shareId/pack` stores or removes owner-bound opaque hosted share-pack objects under the owning user root key for acceptance/import only; page preview reads come from the tiny Postgres summary instead, and live share-pack reads are not exposed over the control plane

Hosted member private identifiers are no longer a Cloudflare-owned storage surface. `apps/web` now sends self-contained onboarding activation events and keeps encrypted member identity, routing, and billing-reference fields in Postgres owner tables.

`apps/cloudflare/wrangler.jsonc` is the checked-in scaffold for those bindings, env names, and the native container image reference. It intentionally leaves bucket names, worker name, and secrets as placeholders until a real Cloudflare account target exists, but it now pins the native container to the baseline `standard-1` instance type instead of relying on Cloudflare defaults.

## Native container contract

The primary production path uses Cloudflare's native container support through a companion `RunnerContainer` class configured alongside `UserRunnerDurableObject` in `wrangler.jsonc`.

That means:

- the Worker receives Vercel OIDC-authenticated dispatch and control requests
- the per-user Durable Object keeps queue/process state in its SQLite storage tables (`runner_meta`, `pending_events`, `consumed_events`, and `poisoned_events`) instead of one serialized record blob
- the Worker's internal control routes call direct Durable Object methods such as `dispatch`, `commit`, `status`, and per-user env updates instead of routing those control hops back through worker-local `fetch()` URLs
- the per-user Durable Object invokes a same-name `RunnerContainer` instance on demand
- the `RunnerContainer` uses the official `@cloudflare/containers` `Container` class to handle startup, port readiness, per-run env injection, and host-specific outbound interception before forwarding the encrypted bundle payloads and dispatch into the internal runner bridge
- those worker-owned outbound proxy hosts now require an in-memory per-run proxy token from the trusted Worker/container bridge in addition to the bound `userId`, so random code inside one one-shot runner container instance cannot call them directly with `curl` or borrowed env
- the worker-owned hosted-AI-usage proxy host injects the Durable Object's bound `userId` into the worker-side usage buffer path, and any later web import still happens from the Durable Object with the broader web control token kept out of the runner environment
- worker-owned callback and web-control base URLs now normalize to HTTPS by default and only permit explicit loopback or internal worker-host HTTP exceptions
- the runner process posts the durable commit callback plus hosted email and assistant-delivery journal requests through one internal `http://results.worker` seam; the fuller final result now returns directly to the Durable Object, so bundle finalization no longer needs a second worker callback hop
- the container-local bridge is intentionally thin; the execution core lives in `packages/assistant-runtime`
- the queue Durable Object invokes the per-user container on demand and explicitly tears it down after every run so each invocation gets a fresh per-run control token and a clean process boundary

The native container image is declared in `apps/cloudflare/wrangler.jsonc` under the `containers` section, points at `../../Dockerfile.cloudflare-hosted-runner`, uses `instance_type: "standard-1"` in the checked-in scaffold, and now keeps the default `max_instances` at `50` until deploy automation raises it explicitly. Generated deploy config accepts `CF_CONTAINER_INSTANCE_TYPE` as either a named Wrangler preset such as `standard-1` or a JSON object with `vcpu`, `memory_mib`, and `disk_mb`.

## Container image

`Dockerfile.cloudflare-hosted-runner` builds the container image used by Wrangler. Inside that image, the private container entrypoint still serves:

- `GET /health`
- `POST /__internal/run`

That HTTP bridge is an internal container implementation detail, not a separately supported hosted service or repo-supported local command surface. The repo no longer supports an external `HOSTED_EXECUTION_RUNNER_BASE_URL` path.

The default image now bakes the local parser toolchain directly into the container: `ffmpeg`, `pdftotext`, a pinned `whisper.cpp` `whisper-cli` build, and the default `base.en` Whisper model under `~/.murph/models/whisper/ggml-base.en.bin`. `FFMPEG_COMMAND`, `PDFTOTEXT_COMMAND`, `WHISPER_COMMAND`, and `WHISPER_MODEL_PATH` are set in the image by default, and operators only need to override the Whisper vars when they intentionally want a different binary or model. Those parser binary/model selector vars are operator-only deploy knobs: separately encrypted per-user env overrides must not set them, and `HOSTED_EXECUTION_ALLOWED_USER_ENV_KEYS` cannot re-enable them.

Current expectations for the container image:

- Node `>=22.16.0`
- workspace dependencies installed from this repo
- writable temp storage for ephemeral hosted bundle restore/snapshot work
- the baked `/app` tree remains root-owned while the runtime executes as a dedicated non-root user, so any job that needs scratch space must use temp/vault paths rather than mutating shipped source
- `PORT` for the internal bridge listen port, defaulting to `8080`
- provider/runtime env such as WHOOP, Oura, Linq, Telegram, hosted email bridge config, and model-provider keys when the one-shot runner should execute those surfaces instead of skipping them
- optional allowlist extension var `HOSTED_EXECUTION_ALLOWED_USER_ENV_KEYS` when separately encrypted per-user env overrides need to cover additional exact key names, excluding operator-only binary/model selectors and process-control env such as `FFMPEG_COMMAND`, `PDFTOTEXT_COMMAND`, `WHISPER_COMMAND`, `WHISPER_MODEL_PATH`, `NODE_OPTIONS`, and dynamic-loader variables
- encrypted per-user overrides are read from a dedicated per-user hosted object, injected into the one-shot runtime request, and the default hosted execution path runs each job in an isolated child process launched from a temp cwd rather than `/app` while resolving its `tsx` preload by absolute file URL, so per-user env overrides no longer force container-wide request serialization, the job does not inherit the shipped repo root as its ambient working directory, the child does not inherit supervisor-only container env or proxy credentials, writable cache/temp roots stay per-run, and the launch-time `HOME` no longer reuses the container supervisor account

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
- final container-capacity tuning beyond the explicit `standard-1` baseline
- fully automatic canary promotion without an operator decision

For the end-to-end deployment path, including the GitHub Actions workflow and generated deploy artifacts, see `apps/cloudflare/DEPLOY.md`.

## Verification

The Cloudflare app now keeps two focused Vitest lanes:

- `pnpm --dir apps/cloudflare test` keeps the default fast loop: app-local typecheck plus the Node-based unit and integration coverage for auth, journaling, bundle storage, control routes, and the one-shot runner path.
- `pnpm --dir apps/cloudflare test:workers` runs only the smaller Workers-runtime suite through `@cloudflare/vitest-pool-workers`, covering signed dispatch, direct Durable Object RPC, Durable Object alarms, bundle journaling, and runner control flows inside the actual Workers runtime.
- `pnpm --dir apps/cloudflare verify` runs app-local typecheck once, then both the Node and Workers-runtime lanes.

## Operational notes

- The worker never stores plaintext vault material in Durable Object storage. It stores only per-user coordination state plus encrypted bundle references. Sensitive hosted dispatch bodies now stay out of Durable Object SQLite rows: the queue stores only `payload_key` references while reconstructable or sensitive payload bodies live in separately encrypted transient blobs, and the hosted web outbox now stages reference-backed dispatch bodies into the same Cloudflare-owned encrypted dispatch-payload store instead of reconstructing them from Postgres in the steady state. `vault.share.accepted` is the explicit small inline exception: the queue stores only the share owner/id ref, then the runner hydrates the opaque pack from Cloudflare storage immediately before import.
- Hosted assistant provider selection now has one explicit durable seam: a top-level `hostedAssistant` config in the operator config artifact. That durable hosted profile is the only persisted hosted assistant source of truth, while raw credentials still stay in Worker secrets or the separately encrypted per-user env object.
- Hosted bundle reads/writes and per-user env object updates happen outside the Durable Object's SQLite mutation step; only the final bundle-ref/version compare-and-swap is committed inside Durable Object storage.
- Hosted execution now writes one encrypted workspace snapshot back through the existing `vault` bundle slot. That workspace snapshot includes canonical `vault/**`, only the `.runtime/**` paths explicitly classified `portable`, and the minimal operator-home config needed for explicit `member.activated` bootstrap. Machine-local runtime state such as device-sync control/token stores, daemon state/logs, inbox daemon config/state, parser toolchain overrides, projections, caches, and tmp data stays out of the hosted bundle. Large raw artifacts under `vault/raw/**` are externalized into separately encrypted content-addressed objects behind opaque object keys; the runner restores inline workspace files first, only materializes the externalized artifact paths the current run actually needs, and preserves untouched artifact refs across later snapshots so old media does not churn through download/upload cycles just to stay referenced. Per-user runner env overrides live in their own encrypted hosted object behind an opaque per-user locator.
- Bundle writes are skipped when the bundle content hash and byte length are unchanged, which helps avoid unnecessary R2 write churn on no-op assistant/device-sync passes.
- Successful bundle transitions now do best-effort cleanup of per-user artifact objects no longer referenced by the latest workspace snapshot, so this lane no longer relies only on transient-prefix lifecycle rules to limit growth while bundle objects remain shared content-addressed ciphertext.
- Hosted one-shot runs now collect due outward side effects with the committed hosted result, then the runner drains those committed side effects after the durable commit succeeds. Assistant replies, including the `member.activated` first-contact welcome, originate from assistant outbox intents in `vault/.runtime/operations/assistant/**` rather than inline sends during the hosted event handler.
- Replay suppression now uses only exact consumed-event tombstones in Durable Object SQLite. Those tombstones expire after 24 hours; there is no secondary replay filter.
- The container bridge now ties each internal `/__internal/run` request to an abort signal, so a worker timeout or client disconnect kills the full isolated child process group instead of leaving compute running inside a one-shot hosted run.
- Broad hosted idempotency no longer depends on the web outbox lifecycle: `apps/web` now uses the shared Postgres `execution_outbox` only for delivery handoff into Cloudflare, while the Durable Object queue owns retries, poison/backpressure, committed-result recovery, and any hosted-web business-outcome callback before it consumes the event. Hosted webhook receipts still keep their own durable side-effect state for Linq replies, and RevNet issuance stays on its invoice-owned idempotency path.
- Missing hosted share packs are treated as an async runner-side failure instead of a web claim-time validation step. If hydration fails, Cloudflare releases the Postgres share claim through the signed hosted-web release callback and then poisons the queue event instead of retrying a permanently missing pack forever.
- Follow-up hosted events now require an already bootstrapped member context; they no longer create the vault or force-enable Linq auto-reply as a hidden side effect.
- The checked-in Wrangler scaffold now explicitly enables Workers Logs and Workers Traces so request logs, container logs, and trace spans are available before production rollout. The generated deploy config exposes log and trace sampling through `CF_LOG_HEAD_SAMPLING_RATE` and `CF_TRACE_HEAD_SAMPLING_RATE`.
- Normal deployment flow now separates version upload from deployment. After the first deploy, the GitHub Actions workflow and local rollout helper upload a version, create a gradual deployment, and pin smoke checks to the candidate version. First deploys still require a direct `wrangler deploy`, and the rollout helper now refuses gradual mode when the rendered config introduces a newer Durable Object migration tag than the currently allowed gradual-deploy set.
- Frequent deploys can accumulate old managed-registry tags. Use `pnpm --dir apps/cloudflare images:cleanup -- --filter '<repo-regex>' --keep 10` first, then add `--apply` once the dry-run plan looks correct.
- The checked-in deploy surface now documents and forwards only the canonical runtime vars that the container actually consumes, such as `HOSTED_EMAIL_*`, `FFMPEG_COMMAND`, `PDFTOTEXT_COMMAND`, `WHISPER_COMMAND`, `WHISPER_MODEL_PATH`, and the explicit runner web-control host allowlist override. The default image already bakes the standard parser-toolchain values, so the parser vars are operator-only override knobs rather than baseline deployment requirements or per-user env settings. AgentMail stays a local-only integration and is not part of the hosted deploy surface.
- The deploy automation now also forwards the hosted email bridge config (`HOSTED_EMAIL_*`) into the generated Worker vars/secrets payload and the manual GitHub Actions deploy workflow, so the documented hosted email contract matches the deploy surface.
- Manual deploy smoke no longer stops at `POST /run` acceptance. It now polls the operator status route until the queue drains, `lastRunAt` advances, and durable bundle refs exist, so a broken containerized run does not look healthy just because the enqueue succeeded.
- The checked-in Wrangler scaffold and rendered deploy config now declare the four required hosted runtime secrets through Wrangler's experimental `secrets.required` support, so local `wrangler` validation and deploy/version uploads fail early when those names are unset. Keep that list tight and treat optional provider secrets as separately managed Worker configuration.
- The repo now ships `apps/cloudflare/r2-bundles-lifecycle.json` plus `pnpm --dir apps/cloudflare r2:lifecycle:apply` so the configured bundles buckets can expire transient execution journals, transient dispatch payload blobs, committed side-effect journal objects, hosted email thread routes, and hosted raw email messages under their `transient/**` prefixes after 7 days. Successful runs also best-effort delete consumed queue payload blobs and raw email bodies earlier so the lifecycle rules stay a backstop instead of the primary cleanup path.
- Stored ciphertext envelopes now decrypt by their embedded `keyId` through the configured keyring. That only helps once the caller already has the canonical object key or explicit object ref; semantic-ID stores such as per-user env, usage, journals, email routes/messages, and similar opaque path lookups no longer probe prior root-key-derived paths. Rotate those stores by rewriting objects at the new canonical path before cutting over, and keep the old keys in `HOSTED_EXECUTION_PLATFORM_ENVELOPE_KEYRING_JSON` until the rewritten ciphertext no longer needs them. Missing keyring entries still fail closed.

## Runtime boundary

`apps/cloudflare` should treat `@murphai/assistant-runtime` as its hosted execution surface for runtime behavior and `@murphai/hosted-execution` as the canonical owner of shared hosted execution contracts, route builders, vendor-neutral env readers, auth header names, and request-canonicalization helpers. The worker/container app owns all deployment topology and transport: it builds the injected method-based `HostedRuntimePlatform`, maps `artifactStore`, `effectsPort`, `deviceSyncPort`, and `usageExportPort` to the internal `*.worker` hosts, and owns runner proxy-token behavior plus isolated child runner lifecycle. The headless runtime package owns one-shot hosted execution behavior only. The app-local no-emit typecheck now includes the Node runner and container entrypoint files.

## Known follow-ups

- Only assistant delivery is implemented as a hosted side-effect kind today. Future provider mutations, callbacks, or outbound deliveries should extend the same committed side-effect journal rather than bypassing it.
- Cloudflare container lifecycle is currently one-shot: start on demand, run one hosted job, then tear the instance down. If you later want pooling or warm reuse, add that back as an explicit design with credential/lease isolation rather than relying on container idle retention.
- The remaining `results.worker` seam is now only for the durable commit callback plus true outward effects such as hosted email and side-effect journal access. Future outward mutations should extend that same committed side-effect journal instead of adding separate reliability lanes.
