# Hosted Orchestrator Temporal

Private Temporal worker package for hosted runtime orchestration.

Temporal owns only scheduling, sleeps, signal coalescing, and Activity retries.
Web remains the demand and product-status owner. Cloudflare remains the runtime
execution adapter. The workflow state and signals must stay pointer-only.

## Local Development

Install or check the Temporal CLI:

```bash
pnpm temporal:cli:setup
pnpm temporal:cli:check
```

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
- `TEMPORAL_API_KEY`: optional Temporal Cloud API key. If set, TLS is enabled
  unless `TEMPORAL_TLS_ENABLED=false`, which is rejected.
- `TEMPORAL_CLIENT_CERT_PEM` / `TEMPORAL_CLIENT_CERT_BASE64`: optional mTLS
  client certificate. Configure exactly one form and pair it with the matching
  client key.
- `TEMPORAL_CLIENT_KEY_PEM` / `TEMPORAL_CLIENT_KEY_BASE64`: optional mTLS
  client private key. Configure exactly one form and pair it with the matching
  client certificate.
- `TEMPORAL_SERVER_ROOT_CA_CERT_PEM` /
  `TEMPORAL_SERVER_ROOT_CA_CERT_BASE64`: optional server root CA certificate.
- `TEMPORAL_TLS_SERVER_NAME_OVERRIDE`: optional TLS SNI/server-name override.

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

## Render Deployment

The repo root `render.yaml` defines `murph-temporal-worker` as a Render
Background Worker. It builds the Temporal package and starts
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
