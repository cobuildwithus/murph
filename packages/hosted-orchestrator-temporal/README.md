# Hosted Orchestrator Temporal

Private Temporal worker package for hosted runtime orchestration.

Temporal owns only scheduling, sleeps, signal coalescing, and Activity retries.
Web remains the demand and product-status owner. Cloudflare remains the runtime
execution adapter. The workflow state and signals must stay pointer-only.

## Workflow Replay Discipline

The per-user workflow in `src/workflows/hosted-user-runtime.ts` is replay
sensitive. Changes that add, remove, or reorder awaited command-producing
Temporal APIs, including Activities, timers or signal-aware timeouts,
`continueAsNew`, or future child Workflow commands, need one of:

- Worker Versioning or deployment pinning for existing histories.
- `patched()` / `deprecatePatch()` around the changed command order.
- A replay test against captured old histories for the affected path.

Pure state-machine tests do not prove old Temporal histories replay after a
deployment. Keep captured histories redacted or synthetic, and do not commit raw
payloads, prompts, transcripts, provider responses, secrets, local paths, or
direct user identifiers. The durable rule lives in
`agent-docs/references/hosted-temporal-orchestration.md`.

## Local Development

Install or check the Temporal CLI:

```bash
pnpm temporal:cli:setup
pnpm temporal:cli:check
```

The setup command installs a pinned official Temporal CLI release on Linux or
Darwin when `temporal` is not already on `PATH`.

The default `pnpm dev` profile and hosted-local E2E profiles start a managed
local Temporal dev server and the hosted runtime worker through the canonical
hosted-local stack:

```bash
pnpm hosted-local e2e temporal-orchestration --profile e2e:stub
```

Interactive `pnpm dev` exposes the managed Temporal Web UI at
`http://127.0.0.1:8233` by default. If you override `MURPH_DEV_TEMPORAL_PORT`,
the UI uses that port plus `1000`, matching Temporal CLI defaults. Set
`TEMPORAL_DEV_HEADLESS=1` only when you intentionally want the managed local
server without the dashboard.

That scenario signals through the web Temporal client, queries the workflow, and
expects the worker Activities to reach the hosted web demand endpoint and the
Cloudflare ensure-execution adapter.

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
export HOSTED_EXECUTION_RUNNER_TIMEOUT_MS=600000
export HOSTED_TEMPORAL_ENSURE_EXECUTION_TIMEOUT_MARGIN_MS=30000

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

Signal a local smoke workflow:

```bash
export TEMPORAL_ADDRESS=localhost:7233
export TEMPORAL_NAMESPACE=default
export TEMPORAL_TASK_QUEUE=murph-hosted-runtime
export TEMPORAL_TLS_ENABLED=false

pnpm hosted-orchestration:smoke
```

The smoke command sends a pointer-only `manual_run_requested` signal for a
synthetic local user id and prints a redacted workflow id. It proves the Temporal
server accepted Signal-With-Start. If the worker is also running, Activity
execution still requires the local web and Cloudflare adapter endpoints above.

## Env Contract

Temporal connection:

- `MURPH_DEV_TEMPORAL`: hosted-local mode, one of `managed`, `external`, or
  `disabled`. Full-stack interactive dev and E2E profiles default to
  `managed`; `worker-only` and `MURPH_DEV_SKIP_WEB=1` default to `disabled`.
  Explicit `HOSTED_TEMPORAL_ADDRESS` or `TEMPORAL_ADDRESS` defaults the stack
  to `external`.
- `MURPH_DEV_TEMPORAL_HOST` / `MURPH_DEV_TEMPORAL_PORT`: local dev server bind
  address for managed hosted-local Temporal.
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

- `HOSTED_WEB_BASE_URL`: hosted web origin for demand calls.
- `HOSTED_WEB_CALLBACK_SIGNING_KEY_ID`: non-secret signing key id.
- `HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK`: P-256 private JWK JSON.
- `CLOUDFLARE_HOSTED_CONTROL_BASE_URL`: Cloudflare execution adapter base URL.
- Cloudflare ensure-execution calls use the same hosted callback signing env as
  web demand calls; Cloudflare must verify the corresponding signed internal
  callback key.
- `HOSTED_RUNTIME_DEMAND_TIMEOUT_MS`: optional demand timeout, max 30000.
- `HOSTED_EXECUTION_RUNNER_TIMEOUT_MS`: runner invocation timeout.
- `HOSTED_TEMPORAL_ENSURE_EXECUTION_TIMEOUT_MARGIN_MS`: margin added to the
  runner timeout for the ensure-execution internal HTTP request timeout. The
  workflow Activity Start-To-Close timeout then adds a fixed 30 second
  reporting slack over that HTTP timeout so the Activity can parse and return
  the Cloudflare response before Temporal reaches the boundary.

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
  Ensure-execution calls that run longer than the platform window can still be
  retried by Temporal after the current attempt is interrupted.

Worker concurrency:

- `HOSTED_TEMPORAL_WORKER_MAX_CONCURRENT_ACTIVITY_TASK_EXECUTIONS` /
  `TEMPORAL_WORKER_MAX_CONCURRENT_ACTIVITY_TASK_EXECUTIONS`: maximum
  concurrent Activity executions, default `2`. Keep this aligned with Render
  instance size and Cloudflare runner capacity because `ensureCloudflareExecution`
  can hold a request for minutes.
- `HOSTED_TEMPORAL_WORKER_MAX_CONCURRENT_ACTIVITY_TASK_POLLS` /
  `TEMPORAL_WORKER_MAX_CONCURRENT_ACTIVITY_TASK_POLLS`: maximum concurrent
  Activity task polls, default `2`, and must be no higher than the Activity
  execution limit.
- `HOSTED_TEMPORAL_WORKER_MAX_CONCURRENT_WORKFLOW_TASK_EXECUTIONS` /
  `TEMPORAL_WORKER_MAX_CONCURRENT_WORKFLOW_TASK_EXECUTIONS`: maximum concurrent
  Workflow task executions, default `20`.
- `HOSTED_TEMPORAL_WORKER_MAX_CONCURRENT_WORKFLOW_TASK_POLLS` /
  `TEMPORAL_WORKER_MAX_CONCURRENT_WORKFLOW_TASK_POLLS`: maximum concurrent
  Workflow task polls, default `5`, and must be no higher than the Workflow task
  execution limit.
- Local development omits these Worker performance options unless an override is
  configured. Production startup always sets explicit values instead of relying
  on Temporal SDK defaults.

## Render Deployment

The repo root `render.yaml` defines `murph-temporal-worker` as a Render
Background Worker. It builds the Temporal package, including the production
Workflow bundle, and starts
`pnpm --dir packages/hosted-orchestrator-temporal temporal:worker:prod`.

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
