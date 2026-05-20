# Hosted Orchestrator Temporal

Private Temporal worker package for hosted runtime orchestration.

Temporal owns only scheduling, sleeps, signal coalescing, and Activity retries.
Web remains the demand and product-status owner. Cloudflare remains the runtime
execution adapter. The workflow state and signals must stay pointer-only.

## Local Development

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

- `TEMPORAL_ADDRESS`: Temporal frontend address, for example `localhost:7233`.
- `TEMPORAL_NAMESPACE`: namespace, defaults to `default`.
- `TEMPORAL_TASK_QUEUE`: task queue, defaults to `murph-hosted-runtime`.
- `TEMPORAL_TLS_ENABLED`: `true` or `false`; local dev uses `false`.

Activity HTTP targets:

- `HOSTED_WEB_BASE_URL`: hosted web origin for demand and usage-decision calls.
- `HOSTED_WEB_CALLBACK_SIGNING_KEY_ID`: non-secret signing key id.
- `HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK`: P-256 private JWK JSON.
- `CLOUDFLARE_HOSTED_CONTROL_BASE_URL`: Cloudflare execution adapter base URL.
- Cloudflare ensure-execution calls use the same hosted callback signing env as
  web demand and usage-decision calls; Cloudflare must verify the corresponding
  signed internal callback key.
- `HOSTED_RUNTIME_DEMAND_TIMEOUT_MS`: optional demand timeout, max 30000.
- `HOSTED_EXECUTION_RUNNER_TIMEOUT_MS`: runner invocation timeout.
- `HOSTED_TEMPORAL_ENSURE_EXECUTION_TIMEOUT_MARGIN_MS`: Activity timeout margin.

Do not store real secrets in repo files. Use shell exports, local secret stores,
or ignored local env files when exercising the worker.
