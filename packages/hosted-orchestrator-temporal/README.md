# Hosted Orchestrator Temporal

Private Temporal worker package for hosted runtime orchestration.

Temporal owns only scheduling, sleeps, signal coalescing, and Activity retries.
Web remains the reconciliation-facts and product-status owner. Cloudflare
remains the runtime execution adapter. The workflow state and signals must stay
pointer-only.
The package also owns the global scheduled-reconcile workflow and Temporal
Schedule helper. That reconciler calls one signed web command and stores only
count/status metadata in Temporal history. Web remains the owner of canonical
dirty state, due-reconcile facts, mailbox rows, and lane completion. The command
appends bounded device-sync wakes and re-handoffs a bounded set of pending
preference or exact queued Clinical Records mailbox pointers whose original
post-commit signal was missed. One shared Web sweep selects at most one pending
pointer per user.

## Workflow Replay Discipline

The per-user workflow in `src/workflows/hosted-user-runtime.ts` is replay
sensitive. Changes that add, remove, or reorder awaited command-producing
Temporal APIs, including Activities, timers or signal-aware timeouts,
`continueAsNew`, or future child Workflow commands, need one of:

- Worker Versioning or deployment pinning for existing histories.
- `patched()` / `deprecatePatch()` around the changed command order.
- A replay test against captured or synthetic old histories for the affected
  path.

Do not replace an active `patched()` marker with `deprecatePatch()` until
workflow histories that already recorded the non-deprecated marker have
drained; otherwise replay can fail before the workflow reaches new work.

Pure state-machine tests do not prove old Temporal histories replay after a
deployment. Keep captured histories redacted or synthetic, and do not commit raw
payloads, prompts, transcripts, provider responses, secrets, local paths, or
direct user identifiers. The durable rule lives in
`agent-docs/references/hosted-temporal-orchestration.md`.

The reconciliation-before-mailbox patch is in the `deprecatePatch()` phase: the
pre-patch direct-mailbox branch and replay fixture were removed only after the
production pre-patch histories drained. Keep the `deprecatePatch()` marker and
patch id in `src/workflows/hosted-user-runtime.ts` until a later removal phase
confirms the deprecatePatch-window histories have drained. The root
`hosted-temporal:guard` check fails if that marker or CI package-coverage entry
is removed early.

The current per-user workflow is a hard cut. It is not replay-compatible with
histories that recorded the old demand Activity or legacy direct signals. Before
deploying this package version, stop old workers, terminate old
`hosted-user-runtime:*` workflows, deploy web and Temporal together, then reseed
users with `runtime_recheck_requested` or mailbox signals.

## Local Development

Install or check the Temporal CLI:

```bash
pnpm temporal:cli:setup
pnpm temporal:cli:check
```

The setup command installs a pinned official Temporal CLI release on Linux or
Darwin when `temporal` is not already on `PATH`.

The default `pnpm dev` profile uses hosted-local Temporal `auto` mode: it starts
a managed local Temporal dev server when the configured port is free, or reuses
a healthy local Temporal listener when one is already running. Hosted-local E2E
profiles still start managed Temporal for isolated histories. Both paths run
the hosted runtime worker through the canonical hosted-local stack:

```bash
pnpm hosted-local e2e temporal-orchestration --profile e2e:stub
```

Interactive `pnpm dev` exposes the local Temporal Web UI at
`http://127.0.0.1:8233` by default when it starts or reuses the default local
server. If you override `MURPH_DEV_TEMPORAL_PORT`, the UI uses that port plus
`1000`, matching Temporal CLI defaults. Set `TEMPORAL_DEV_HEADLESS=1` only when
you intentionally want a managed local server without the dashboard.

That scenario signals through the web Temporal client, queries the workflow, and
expects the worker Activities to reach the hosted web reconciliation-facts
endpoint and the Cloudflare ensure-processing adapter.

For manual standalone Temporal development, start the server directly:

Start a local Temporal dev server:

```bash
pnpm temporal:dev
```

Start the hosted runtime Temporal worker in another terminal:

```bash
export TEMPORAL_ADDRESS=localhost:7233
export TEMPORAL_NAMESPACE=default
export TEMPORAL_TASK_QUEUE=murph-hosted-runtime
export TEMPORAL_TLS_ENABLED=false

export HOSTED_WEB_BASE_URL=http://localhost:3000
export HOSTED_WEB_CALLBACK_SIGNING_KEY_ID=local-dev
export HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK='<P-256_PRIVATE_JWK_JSON>'

export CLOUDFLARE_HOSTED_CONTROL_BASE_URL=http://localhost:8787
export HOSTED_RUNTIME_PROCESSING_TIMEOUT_MS=10000

pnpm temporal:worker
```

For a built production-style local worker:

```bash
pnpm --dir packages/hosted-orchestrator-temporal build
pnpm --dir packages/hosted-orchestrator-temporal temporal:worker:prod
```

The package build compiles the worker and pre-bundles Workflow code into
`dist/workflow-bundle.js` with Temporal's `bundleWorkflowCode`. The production
worker start path sets `NODE_ENV=production` and fails closed if that bundle is
missing. Local development uses `workflowsPath` so source edits keep the normal
runtime-bundling feedback loop.

The same package build enforces the production bundle contract before writing
the artifact. The bundle must remain at or below 2.25 MiB, retain a readable
inline source map, and exclude the broad `@murphai/contracts` and hosted
vault-share source closures. Workflow-reachable shared values belong in small
leaf modules; do not turn type-only imports into broad runtime dependencies.

Signal a local smoke workflow:

```bash
export TEMPORAL_ADDRESS=localhost:7233
export TEMPORAL_NAMESPACE=default
export TEMPORAL_TASK_QUEUE=murph-hosted-runtime
export TEMPORAL_TLS_ENABLED=false

pnpm hosted-orchestration:smoke
```

The smoke command sends a `runtime_recheck_requested` signal for a synthetic
local user id and prints a redacted workflow id. It proves the Temporal server
accepted Signal-With-Start. If the worker is also running, Activity execution
still requires the local web and Cloudflare adapter endpoints above.

## Device-Sync Reconciler Schedule

The scheduled-reconcile cadence should be owned by a Temporal Schedule that
starts `hostedDeviceSyncReconcilerWorkflow`. The Workflow runs one
`runHostedDeviceSyncRecoverySweep` Activity and exits. The Activity signs an
empty JSON request to the hosted web command at
`/api/internal/device-sync/recovery-sweep`; the legacy route name is retained
for compatibility. Web reads due-reconcile facts, records due-reconcile wake
markers, appends bounded `device-sync.wake` mailbox handoffs, reissues bounded
pointer-only signals for pending preference rows and exact queued Clinical
Records wakes that remain ahead of their mailbox lane watermark through the
same one-candidate-per-user sweep, and returns count-only summaries. These
handoff recoveries create no receipt, second work record, or second Clinical
Records generation.

Dirty state is not a scheduler. Webhook clean-to-dirty transitions may still
append one bounded mailbox handoff, and runtime maintenance drains pending dirty
state when device-sync work runs, but the scheduled wake sweep must not wake
runtimes only because dirty rows remain unacknowledged. Do not move dirty
resources, provider tokens, external
account state, or canonical dirty/reconcile facts into Temporal Workflow state.

Create or update the schedule after configuring Temporal and hosted-web signing
env. The schedule is enabled by default:

```bash
pnpm --dir packages/hosted-orchestrator-temporal temporal:ensure-device-sync-reconciler-schedule
```

The ensure command is idempotent: it creates the Schedule when missing and
updates the interval/action when it already exists. Set
`HOSTED_DEVICE_SYNC_RECONCILER_SCHEDULE_ENABLED=false` only to create or update
the Schedule in a paused state.

`pnpm dev` / `pnpm hosted-local up` runs this ensure command automatically
before starting the hosted-local Temporal worker in `auto` and `managed` modes.
External Temporal namespaces are not mutated by local startup unless
`MURPH_DEV_TEMPORAL_ALLOW_EXTERNAL_SCHEDULE_ENSURE=1` is set explicitly. Run the
command manually only when bringing up an out-of-band Temporal namespace or
repairing an existing dev session without restarting the stack.

## Env Contract

Temporal connection:

- `MURPH_DEV_TEMPORAL`: hosted-local mode, one of `auto`, `managed`,
  `external`, or `disabled`. Full-stack interactive dev defaults to `auto`,
  which reuses a healthy local Temporal listener on the configured port or
  starts one when the port is free. E2E profiles default to `managed` for
  isolated histories; `worker-only` and `MURPH_DEV_SKIP_WEB=1` default to
  `disabled`. Explicit `HOSTED_TEMPORAL_ADDRESS` or `TEMPORAL_ADDRESS` defaults
  the stack to `external`.
- `MURPH_DEV_TEMPORAL_HOST` / `MURPH_DEV_TEMPORAL_PORT`: local dev server bind
  address for auto/managed hosted-local Temporal.
- `MURPH_DEV_TEMPORAL_ALLOW_EXTERNAL_SCHEDULE_ENSURE`: set to `1` only when
  `pnpm dev` should create/update the device-sync reconciler Schedule in an
  explicit external Temporal namespace.
- `HOSTED_TEMPORAL_ADDRESS` / `TEMPORAL_ADDRESS`: Temporal frontend address, for
  example `localhost:7233`.
- `HOSTED_TEMPORAL_NAMESPACE` / `TEMPORAL_NAMESPACE`: namespace, defaults to
  `default`.
- `HOSTED_TEMPORAL_TASK_QUEUE` / `TEMPORAL_TASK_QUEUE`: task queue, defaults to
  `murph-hosted-runtime`.
- `HOSTED_TEMPORAL_TLS_ENABLED` / `TEMPORAL_TLS_ENABLED`: `true` or `false`;
  local dev uses `false`.
- `HOSTED_TEMPORAL_API_KEY` / `TEMPORAL_API_KEY`: optional Temporal Cloud API
  key. If set, TLS is enabled unless TLS is explicitly disabled, which is
  rejected.
- `HOSTED_TEMPORAL_CLIENT_CERT_PEM` / `TEMPORAL_CLIENT_CERT_PEM` or
  `HOSTED_TEMPORAL_CLIENT_CERT_BASE64` / `TEMPORAL_CLIENT_CERT_BASE64`:
  optional mTLS client certificate. Configure exactly one form and pair it with
  the matching client key.
- `HOSTED_TEMPORAL_CLIENT_KEY_PEM` / `TEMPORAL_CLIENT_KEY_PEM` or
  `HOSTED_TEMPORAL_CLIENT_KEY_BASE64` / `TEMPORAL_CLIENT_KEY_BASE64`: optional
  mTLS client private key. Configure exactly one form and pair it with the
  matching client certificate.
- `HOSTED_TEMPORAL_SERVER_ROOT_CA_CERT_PEM` /
  `TEMPORAL_SERVER_ROOT_CA_CERT_PEM` or
  `HOSTED_TEMPORAL_SERVER_ROOT_CA_CERT_BASE64` /
  `TEMPORAL_SERVER_ROOT_CA_CERT_BASE64`: optional server root CA certificate.
- `HOSTED_TEMPORAL_TLS_SERVER_NAME_OVERRIDE` /
  `TEMPORAL_TLS_SERVER_NAME_OVERRIDE`: optional TLS SNI/server-name override.

Activity HTTP targets:

- `HOSTED_WEB_BASE_URL`: hosted web origin for reconciliation-facts calls.
- `HOSTED_WEB_CALLBACK_SIGNING_KEY_ID`: non-secret signing key id.
- `HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK`: P-256 private JWK JSON.
- `CLOUDFLARE_HOSTED_CONTROL_BASE_URL`: Cloudflare execution adapter base URL.
- Cloudflare ensure-processing calls use the same hosted callback signing env as
  web reconciliation-facts calls; Cloudflare must verify the corresponding signed internal
  callback key.
- Reconciliation facts use a fixed `55000` millisecond HTTP timeout inside a
  `60000` millisecond Activity Start-To-Close timeout so the Activity can
  report the HTTP result before Temporal closes it.
- `HOSTED_DEVICE_SYNC_RECOVERY_SWEEP_TIMEOUT_MS`: optional HTTP timeout for the
  signed web device-sync scheduled wake sweep Activity, default `30000`, max
  `120000`.
- `HOSTED_RUNTIME_PROCESSING_TIMEOUT_MS`: short HTTP timeout for the
  ensure-processing command, max 30000. The Workflow Activity
  Start-To-Close timeout adds a small reporting slack over this value because
  Cloudflare returns after start/wake acceptance, not after runtime idle.

Device-sync reconciler Schedule:

- `HOSTED_DEVICE_SYNC_RECONCILER_SCHEDULE_ENABLED`: optional, default `true`.
  Set to `false` only when the Temporal Schedule should be paused.
- Schedule id is fixed to `hosted-device-sync-reconciler` so a deploy cannot
  accidentally create a second cadence owner by renaming the Schedule.
- `HOSTED_DEVICE_SYNC_RECONCILER_INTERVAL_MS`: optional interval, default
  `60000`, min `10000`, max `3600000`.
- `HOSTED_DEVICE_SYNC_RECONCILER_ACTIVITY_START_TO_CLOSE_TIMEOUT_MS`: optional
  Activity Start-To-Close timeout for the scheduled Workflow, default `60000`,
  min `1000`, max `300000`.

Worker shutdown:

- `HOSTED_TEMPORAL_WORKER_SHUTDOWN_GRACE_MS` /
  `TEMPORAL_WORKER_SHUTDOWN_GRACE_MS`: production Worker shutdown grace in
  milliseconds, default `270000`. During this window the Worker stops polling
  for new work and lets in-flight tasks drain.
- `HOSTED_TEMPORAL_WORKER_SHUTDOWN_FORCE_MS` /
  `TEMPORAL_WORKER_SHUTDOWN_FORCE_MS`: production force-shutdown cap in
  milliseconds, default `295000`. This must be greater than or equal to the
  grace value.
- The checked-in defaults intentionally leave a small process-exit margin under
  the Render Blueprint's `maxShutdownDelaySeconds: 300` platform cap.
  Ensure-processing calls are short-lived; long runtime execution continues
  under Cloudflare runner write-fence ownership and is recovered by
  reconciliation rechecks.

Worker concurrency:

- `HOSTED_TEMPORAL_WORKER_MAX_CONCURRENT_ACTIVITY_TASK_EXECUTIONS` /
  `TEMPORAL_WORKER_MAX_CONCURRENT_ACTIVITY_TASK_EXECUTIONS`: maximum
  concurrent Activity executions, default `100`. The Activities issue bounded
  signed HTTP control-plane requests; Cloudflare owns the longer runtime
  invocation after accepting the start or wake.
- `HOSTED_TEMPORAL_WORKER_MAX_CONCURRENT_WORKFLOW_TASK_EXECUTIONS` /
  `TEMPORAL_WORKER_MAX_CONCURRENT_WORKFLOW_TASK_EXECUTIONS`: maximum concurrent
  Workflow task executions, default `20`.
- Activity and Workflow Task pollers use Temporal's server-feedback
  autoscaling behavior. Fixed poll-count environment variables are not part of
  the worker contract; the SDK manages the poller count and only polls when an
  execution slot is available.
- Production always enables Temporal's reusable V8 context and fixes the cache
  ceiling at `100` Workflow executions instead of deriving cache capacity from
  the process heap. The ceiling is intentionally not operator-configurable.
- Local development also enables poller autoscaling, while omitting execution
  and cache overrides unless an execution override is configured. Production
  startup always sets explicit execution and cache values instead of relying on
  Temporal SDK defaults.

## Render Deployment

The repo root `render.yaml` defines two `murph-temporal-worker` instances as
Render Background Workers on the 2 GB Standard plan. They share one Temporal
Task Queue, for an aggregate ceiling of 200 concurrent Activity executions and
40 concurrent Workflow Task executions. The service build compiles the Temporal
package, including the fail-closed production Workflow bundle. Each instance
ensures the device-sync reconciler Schedule and starts
`pnpm --dir packages/hosted-orchestrator-temporal temporal:worker:prod`.
The schedule ensure command is idempotent, so concurrent instance startup keeps
one canonical Schedule.

The 200-Activity aggregate is an execution ceiling, not a request-rate target.
Reconciliation Activities reach the signed hosted-Web callback and its pooled
Prisma path. The default Workflow reconciliation call uses the mutating AI
allowance gate: denied fresh conversation work can claim and deliver a
usage-limit notice through Linq or Telegram, while allowed pending work reaches
Cloudflare's per-user runtime admission owner. Durable notice claims preserve
notice idempotency when concurrency rises. During rollout, monitor Activity
retries/timeouts, hosted-Web database-pool failures, unrelated signed callback
health, usage-notice claim/delivery failures and provider errors, and
Cloudflare ensure-processing acceptance. The Activity execution env override
and Render instance count are the rollback controls if those shared boundaries
regress.

Use Render Blueprint sync from the dashboard or validate it with:

```bash
render blueprints validate render.yaml
```

Set Render secrets through the dashboard or Blueprint prompts. Use
`TEMPORAL_API_KEY` for Temporal Cloud API-key auth. If the namespace still uses
mTLS certificate auth, add the base64 mTLS vars manually in Render instead of
putting certificate material in the Blueprint. The Blueprint intentionally does
not hardcode account-specific Temporal, hosted web, Cloudflare, or
signing-secret values.

Render Workflows are unrelated to Temporal Workflows for this package; this
worker must run as a continuously running Render Background Worker.

Do not store real secrets in repo files. Use shell exports, local secret stores,
or ignored local env files when exercising the worker.
