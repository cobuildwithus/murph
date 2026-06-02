# @murphai/cloudflare-runner

Cloudflare-hosted execution plane for the hosted Murph path.

`apps/web` is the canonical owner of onboarding, billing, auth, device-sync authority, usage reconciliation, and other hosted product facts. `apps/cloudflare` is the execution-only edge/runtime layer that accepts authenticated execution/control requests, restores encrypted runtime state, invokes workspace-runtime work, and writes the next encrypted workspace checkpoint through hosted-runtime callbacks.

## What This App Owns

- callback-signed Temporal ensure-processing requests plus Vercel OIDC-authenticated
  browser/session/status/deletion control requests from `apps/web`
- per-user execution coordination in `USER_RUNNER`
- native runner-container lifecycle in `RUNNER_CONTAINER`
- encrypted hosted workspace snapshots, legacy encrypted artifact blobs, encrypted runner-secrets blobs, and the execution-sidecar blobs needed to run hosted jobs in `BUNDLES`

## What It Does Not Own

- browser or webhook control-plane flows for onboarding, billing, auth, or member lifecycle
- canonical hosted product facts or ledgers outside the encrypted execution workspace, including hosted usage and lifecycle state in `apps/web`
- gateway state or other product truth outside the encrypted workspace snapshot

## Route Surface

Public routes:

- `GET /`
- `GET /health`

Internal control routes:

- `POST /internal/users/:userId/runtime/ensure-processing` is the
  callback-signed Temporal processing adapter; it starts, wakes, or accepts a
  pending runtime wake for only the bound user's runtime and returns after that
  start/wake intent is accepted, not after the runtime reaches idle
- `POST /internal/users/:userId/browser-vault/session` creates an encrypted browser-vault read session for the latest web-owned replica ref
- `GET /internal/users/:userId/status`
- `POST /internal/deploy/container-smoke` is a signed deploy-verification callback, not a product control API

The supported worker HTTP surface stops at those narrow control routes, the deploy smoke callback, and the public banner and health checks.
Hosted assistant delivery recovery comes from the encrypted local runtime outbox state inside the workspace checkpoint plus web-owned hosted-runtime logs/status.
The runner container sends child-runtime internal Worker requests to normal virtual hosts such as `results.worker` and `web-control.worker`. Cloudflare Container outbound interception routes those requests back into Worker-owned handlers, using the runtime write-fence headers as authority.
The runner container also uses Cloudflare HTTPS outbound interception for hosted provider egress. OpenAI, Mapbox, Linq, Telegram, and WhatsApp credentials stay in Worker env, while the child container receives sentinel placeholder values for those keys. The Worker fails closed for known provider hosts unless the request matches the sentinel credential contract, validates the runtime write fence before mutating provider-effect secret injection, constrains Mapbox to read-only GET allowlisted path families, injects the real provider credential only into the upstream request, and strips runtime authority headers before that upstream request leaves Cloudflare. Unknown egress currently passes through during migration and logs only sanitized method/host/path metadata.
The container supervisor sets `CODEX_CA_CERTIFICATE`, `SSL_CERT_FILE`, `NODE_EXTRA_CA_CERTS`, `REQUESTS_CA_BUNDLE`, and `CURL_CA_BUNDLE` to Cloudflare's runtime interception CA path, and the isolated child preserves those CA bundle pointers plus Cloudflare-managed proxy env needed by hosted-local Containers egress interception while still scrubbing operator-only process-control env and user-supplied proxy overrides.

Root `pnpm dev` starts the same local Cloudflare container path and uses the image-owned `codex app-server` runtime with direct OpenAI configuration routed through the Worker intercept. There is no host Codex bridge for normal hosted-local execution: `MURPH_DEV_CODEX_APP_SERVER_PROXY_TOKEN` and `MURPH_DEV_CODEX_APP_SERVER_PROXY_URL` are rejected by the Cloudflare runner env policy. Generated local env files are treated as secret material and must provide `HOSTED_ASSISTANT_PROVIDER=openai` plus the Worker-owned `OPENAI_API_KEY` secret; the raw key is not copied into the child container env.

## Storage Contract

- The live v2 workspace snapshot is one encrypted zstd-compressed tar object under `users/<namespace>/workspace-snapshots/<snapshotId>.snapshot.enc`. The container uploads that object directly to R2 through a short-lived presigned `PUT` URL minted by the Worker, and restores through a presigned `GET`; Worker routes carry JSON session/presign/complete metadata only and never receive the snapshot body. This v2 format is a greenfield zstd hard cut: gzip v2 refs are not produced or restored.
- Legacy full/base bundle refs and legacy artifact sidecars remain restoreable during migration, but v2 snapshot production does not externalize raw files into artifact blobs.
- Separate encrypted objects hold runner-specific secret overrides and other execution-only sidecar blobs so those runtime artifacts do not force workspace rewrites.
- Durable Object SQLite stores execution coordination only: lease and stale-result fencing, alarm hints, timestamps, and short-lived direct-R2 upload sessions without persisted presigned URLs. Canonical mailbox ordering, workspace checkpoint refs, redacted status/logs, and mailbox lag stay web-owned; snapshot refs come from hosted-runtime workspace control responses and may be kept only as an in-memory warm cache.
- Hosted raw email payloads now live under the encrypted, root-independent `hosted-email/messages/{storageNamespaceId}/` prefix, are deleted after terminal wake cleanup when possible, and also carry a 1-hour R2 lifecycle backstop under `hosted-email/messages/` if eager cleanup misses them. Removed pre-launch root-derived raw-email paths are unsupported under the greenfield hard cut; the same lifecycle prefix bounds any transient leftovers.
- Other encrypted execution blobs remain owner-cleaned or durable by design, including workspace snapshots, legacy artifact blobs, and runner-secrets blobs. Hosted device-sync runtime authority stays in `apps/web` behind narrow signed callbacks.
- Runtime domain-root material comes from a signed web callback as ingress/runtime
  envelopes only. Cloudflare verifies the GCP KMS authority signature and unwraps
  only its configured P-256 automation recipient; it does not receive GCP KMS
  decrypt credentials.

## Worker Contract

Bindings:

- `USER_RUNNER`
- `RUNNER_CONTAINER`
- `BUNDLES`
- `CF_VERSION_METADATA` version metadata binding, used by deploy smoke to prove the requested Worker version actually handled the request
- optional `HOSTED_EMAIL` native `send_email` binding for outbound hosted email

Required worker secrets:

- `HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK`
- `HOSTED_LOG_FINGERPRINT_SECRET`
- `HOSTED_R2_PRESIGN_ACCESS_KEY_ID`
- `HOSTED_R2_PRESIGN_SECRET_ACCESS_KEY`
- `HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK`
- `OPENAI_API_KEY`

Required worker vars:

- `HOSTED_WEB_BASE_URL`
- `HOSTED_EXECUTION_VERCEL_OIDC_TEAM_SLUG`
- `HOSTED_EXECUTION_VERCEL_OIDC_PROJECT_NAME`
- `HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION`
- `HOSTED_CRYPTO_AUTHORITY_SIGN_PUBLIC_KEY_PEM`
- `HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID`
- `HOSTED_CRYPTO_ENV`
- `HOSTED_R2_PRESIGN_ACCOUNT_ID`
- `HOSTED_R2_PRESIGN_BUCKET_NAME`

`HOSTED_WEB_BASE_URL` must be an origin-only hosted web URL. Do not configure a
subpath such as `https://example.test/app`; the worker appends its own internal
callback routes to that origin.
Production deploy preflight also requires `HOSTED_WEB_PRODUCTION_BASE_URL` and
rejects a production Worker when `HOSTED_WEB_BASE_URL` does not match that
production origin or when callback origins use HTTP, localhost, Docker bridge,
loopback, preview/development, or private-network hosts. The GitHub workflow
runs that preflight before artifact preparation; the local `deploy:worker`
path also runs it inside the apply step before artifact validation and upload.

Defaulted worker vars:

- `HOSTED_EXECUTION_MAX_EVENT_ATTEMPTS=3`
- `HOSTED_EXECUTION_IDLE_CHECKPOINT_DELAY_MS=180000` for the runtime-owned idle
  window before a dirty invocation checkpoints and returns
- `HOSTED_EXECUTION_RUNNER_IDLE_TTL_MS=300000` for the native container shell
  activity-expiry cleanup lifecycle
- `HOSTED_EXECUTION_RETRY_DELAY_MS=30000`
- `HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS=30000`
- `HOSTED_EXECUTION_RUNNER_TIMEOUT_MS=600000`
- `HOSTED_EXECUTION_WEB_CONTROL_TIMEOUT_MS=30000`
- `HOSTED_EXECUTION_VERCEL_OIDC_ENVIRONMENT=production`

`HOSTED_EXECUTION_RUNNER_TIMEOUT_MS` must stay greater than
`HOSTED_EXECUTION_IDLE_CHECKPOINT_DELAY_MS` plus
`HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS` plus the owner-watchdog recheck
margin, otherwise the Worker fails startup. That keeps Temporal from re-reading
mailbox demand before the runtime has had time to enter and commit its idle
checkpoint window.

`HOSTED_EXECUTION_MAX_EVENT_ATTEMPTS` bounds consecutive failed hosted runner
invocations for a Durable Object. Temporal decides when durable work is due by
reading web-owned demand; Cloudflare does not reread web mailbox/workspace
status as a scheduler. Cloudflare alarms remain watchdogs for active write
fences and recovery bookkeeping, while successful runtime completion or a
replacement invocation clears stale execution-failure state.

Optional execution vars and secrets:

- `HOSTED_WEB_CALLBACK_SIGNING_KEY_ID` for callback key rotation metadata on the required signed hosted-web path
- `HOSTED_EXECUTION_ALLOWED_RUNNER_SECRET_KEYS` and `HOSTED_EXECUTION_RUNNER_ENV_PROFILES` for execution-time secret forwarding
- `HOSTED_ASSISTANT_PROVIDER=openai` for Codex hosted assistant execution through the Worker egress intercept. The standard deploy preflight requires Worker-owned `OPENAI_API_KEY`, but the child runner receives only an injected-credential placeholder; host Codex bridge/proxy env is not accepted
- `HOSTED_R2_PRESIGN_ENDPOINT` can override the default account-scoped R2 S3 endpoint for direct snapshot URL generation. Production deploys must leave it as the account-scoped R2 HTTPS origin. Hosted-local dev, worker-only, and E2E profiles start a MinIO sidecar and inject local S3-compatible endpoints behind the local-only `HOSTED_R2_PRESIGN_ALLOW_LOCAL_ENDPOINT=1` guard; those local endpoint flags are not deploy vars.
- `HOSTED_AI_USAGE_REPORTING_SECRET` is an optional Worker-owned platform
  secret. It must not be forwarded into the child runtime env; usage
  attribution is added at the Worker/web-control boundary when configured.
- `HOSTED_EMAIL_DOMAIN`, `HOSTED_EMAIL_LOCAL_PART`, optional `HOSTED_EMAIL_FROM_ADDRESS`, `HOSTED_EMAIL_DEFAULT_SUBJECT`, and `HOSTED_EMAIL_SIGNING_SECRET` for hosted email routing
- opt-in runtime integrations such as `LINQ_*`, `TELEGRAM_*`, `WHATSAPP_*`, and `MAPBOX_ACCESS_TOKEN`; provider credentials for intercepted integrations stay Worker-owned and are represented in the child container by sentinel placeholders, while native parser binaries and the Whisper model are image-owned by the runner container and rebound from the image instead of being serialized through Worker runtime envelopes

When hosted email sender identity is configured, deploy automation renders an environment-specific native `HOSTED_EMAIL` send binding and constrains it with `allowed_sender_addresses` so outbound sender selection remains config-owned.

The runtime always includes the minimal `assistant` env profile. Deploy automation layers `hosted-email`, `linq`, `mapbox`, and `telegram` on top by default. Cloudflare owns the configured profile string, runner-secret allowlisting, native parser toolchain binding inside the container image, and container transport rewrites such as local loopback host adaptation. The profile key sets and canonical hosted runtime launch spec are built by `@murphai/assistant-runtime`, so local and Cloudflare execution pass the same semantic runtime manifest shape. Hosted device-sync runtime config is derived into `runtime.resolvedConfig`, so it stays outside the child-env profile surface.

Cloudflare keeps only the wake-payload decryption lane plus the worker-owned callback-signing key. Broad web-private-field encryption stays in `apps/web`, and the child process reaches the web control plane through the worker proxy instead of holding callback-signing material directly.

## Runner Container Lifecycle

The native Cloudflare container is a warm per-user shell. Successful workspace
invocations keep the same Durable Object write fence while the runtime waits for
`HOSTED_EXECUTION_IDLE_CHECKPOINT_DELAY_MS`, a coalesced wake, or the
write-fence deadline. If local runtime state is dirty, the child checkpoints
with reason `idle_shutdown` before returning success. When Cloudflare reports
the container `sleepAfter` lifecycle expiry, the container only yields to an
active foreground operation or tears down the warm shell.
Each invocation still runs through an isolated child process with fresh
invocation-local cache/temp roots, but child-to-worker effects use internal
virtual hosts and write-fence headers instead of per-invocation
outbound proxy tokens or dynamically installed outbound handlers.

The warm shell is destroyed when an invocation fails, warm health is stale,
deploy smoke finishes, explicit cleanup is called, or Cloudflare reports idle
activity expiry with no active foreground operation.

Foreground progress recovery is write-fenced instead of container-destroy
driven. A write fence is commit authority, not liveness proof; the exact wake,
replacement, ambiguous-wake, and fresh-startup retry contract is documented in
`agent-docs/references/hosted-runtime-protocol.md`. The legacy active-invocation
heartbeat and container-stopped RPC shims are retained only for deployed-caller
compatibility until 2026-05-25 and return inert responses. Live runner side
effects validate the runtime write fence by attempt, generation, and user
identity. Workspace version remains a checkpoint/restore freshness guard, not
generic side-effect authority.

## Deploy Artifacts

`pnpm --dir apps/cloudflare deploy:artifacts` prepares:

- `apps/cloudflare/.deploy/runner-bundle/`
- `apps/cloudflare/.deploy/wrangler.generated.jsonc`
- `apps/cloudflare/.deploy/worker-secrets.json`

`pnpm --dir apps/cloudflare deploy:worker` is the canonical cut because it renders environment-specific deploy config, worker secrets, the hosted email send binding restrictions, and the cached native runner base image before upload; its apply step also runs deploy preflight before direct Wrangler upload.
Deploy smoke pins the 100% Worker version, verifies the response-reported version metadata, and, when enabled by the workflow, runs a signed managed-container smoke that compares the live runner bundle fingerprint with `.deploy/runner-bundle/.murph-runner-bundle-manifest.json`. The same smoke can mint an actual R2 S3 presigned PUT URL, upload a payload larger than 150 MiB from the container, verify the object size through the Worker R2 binding, and delete the smoke object.

See [DEPLOY.md](./DEPLOY.md) for the exact GitHub environment surface, lifecycle rules, and smoke workflow.
