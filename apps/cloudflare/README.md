# @murphai/cloudflare-runner

Cloudflare-hosted execution plane for the hosted Murph path.

`apps/web` is the canonical owner of onboarding, billing, auth, device-sync authority, usage reconciliation, and other hosted product facts. `apps/cloudflare` is the execution-only edge/runtime layer that accepts authenticated nudge/control requests, restores encrypted runtime state, invokes workspace-runtime work, and writes the next encrypted workspace checkpoint through hosted-runtime callbacks.

## What This App Owns

- Vercel OIDC-authenticated nudge/control requests from `apps/web`
- per-user execution coordination in `USER_RUNNER`
- native runner-container lifecycle in `RUNNER_CONTAINER`
- encrypted hosted workspace snapshots, externalized artifact blobs, encrypted runner-secrets blobs, and the execution-sidecar blobs needed to run hosted jobs in `BUNDLES`

## What It Does Not Own

- browser or webhook control-plane flows for onboarding, billing, auth, or member lifecycle
- canonical hosted product facts or ledgers outside the encrypted execution workspace, including hosted usage and lifecycle state in `apps/web`
- gateway state or other product truth outside the encrypted workspace snapshot

## Route Surface

Public routes:

- `GET /`
- `GET /health`

Internal control routes:

- `POST /internal/users/:userId/nudge` persists a runner nudge for a user, starts an idle Durable Object runner drive immediately, and returns the runner nudge result
- `POST /internal/users/:userId/browser-vault/session`
- `GET /internal/users/:userId/status`
- `POST /internal/deploy/container-smoke` is a signed deploy-verification callback, not a product control API

The supported worker HTTP surface stops at those three control routes, the deploy smoke callback, and the public banner and health checks.
Hosted assistant delivery recovery comes from the encrypted local runtime outbox state inside the workspace checkpoint plus web-owned hosted-runtime logs/status.
When `HOSTED_EXECUTION_LOCAL_INTERNAL_PROXY_BASE_URL` is configured for local hosted development, the worker also accepts a loopback-only transport shim under `__murph/local-internal-proxy/users/:userId/:host/...`; that seam is not a supported product API and exists only to bridge local child-runtime requests back onto the same lease-scoped internal-worker bridge contract used by direct `http://*.worker` requests.

Root `pnpm dev` starts the same local Cloudflare container path and uses the image-owned `codex app-server` runtime with hosted Vercel AI Gateway configuration. There is no host Codex bridge for normal hosted-local execution: `MURPH_DEV_CODEX_APP_SERVER_PROXY_TOKEN` and `MURPH_DEV_CODEX_APP_SERVER_PROXY_URL` are rejected by the Cloudflare runner env policy. Generated local env files are treated as secret material and must provide `HOSTED_ASSISTANT_PROVIDER=vercel-ai-gateway` plus a Vercel AI Gateway key through Worker secrets or encrypted runner secrets.

## Storage Contract

- The `vault` bundle slot stores one encrypted hosted workspace snapshot. That snapshot is still sensitive canonical vault material, not a second product database.
- Large files are externalized into separately encrypted artifact blobs in the same bucket.
- Separate encrypted objects hold runner-specific secret overrides and other execution-only sidecar blobs so those runtime artifacts do not force workspace rewrites.
- Durable Object SQLite stores execution coordination only: lease and stale-result fencing, alarm hints, and timestamps. Canonical mailbox ordering, workspace checkpoint refs, redacted status/logs, and mailbox lag stay web-owned; bundle refs come from hosted-runtime workspace control responses and may be kept only as an in-memory warm cache.
- Hosted raw email payloads now live under the encrypted, root-independent `hosted-email/messages/{storageNamespaceId}/` prefix, are deleted after terminal wake cleanup when possible, and also carry a 1-hour R2 lifecycle backstop under `hosted-email/messages/` if eager cleanup misses them. Removed pre-launch root-derived raw-email paths are unsupported under the greenfield hard cut; the same lifecycle prefix bounds any transient leftovers.
- Other encrypted execution blobs remain owner-cleaned or durable by design, including workspace snapshots, artifact blobs, and runner-secrets blobs. Hosted device-sync runtime authority stays in `apps/web` behind narrow signed callbacks.
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
- `HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK`

Required worker vars:

- `HOSTED_WEB_BASE_URL`
- `HOSTED_EXECUTION_VERCEL_OIDC_TEAM_SLUG`
- `HOSTED_EXECUTION_VERCEL_OIDC_PROJECT_NAME`
- `HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION`
- `HOSTED_CRYPTO_AUTHORITY_SIGN_PUBLIC_KEY_PEM`
- `HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID`
- `HOSTED_CRYPTO_ENV`

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
- `HOSTED_EXECUTION_RUNNER_IDLE_TTL_MS=300000`
- `HOSTED_EXECUTION_RETRY_DELAY_MS=30000`
- `HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS=30000`
- `HOSTED_EXECUTION_RUNNER_TIMEOUT_MS=600000`
- `HOSTED_EXECUTION_WEB_CONTROL_TIMEOUT_MS=30000`
- `HOSTED_EXECUTION_VERCEL_OIDC_ENVIRONMENT=production`

Optional execution vars and secrets:

- `HOSTED_WEB_CALLBACK_SIGNING_KEY_ID` for callback key rotation metadata on the required signed hosted-web path
- `HOSTED_EXECUTION_ALLOWED_RUNNER_SECRET_KEYS` and `HOSTED_EXECUTION_RUNNER_ENV_PROFILES` for execution-time secret forwarding
- `HOSTED_ASSISTANT_PROVIDER=vercel-ai-gateway` plus `VERCEL_AI_API_KEY` for Codex hosted assistant execution through Vercel AI Gateway; host Codex bridge/proxy env is not accepted
- `HOSTED_AI_USAGE_BILLING_MODE=stripe_meter`, `HOSTED_AI_USAGE_VERCEL_STRIPE_BILLING_ENABLED`, and `HOSTED_AI_USAGE_STRIPE_RESTRICTED_ACCESS_KEY` when Vercel AI Gateway should emit Stripe meter events directly
- `HOSTED_EMAIL_DOMAIN`, `HOSTED_EMAIL_LOCAL_PART`, optional `HOSTED_EMAIL_FROM_ADDRESS`, `HOSTED_EMAIL_DEFAULT_SUBJECT`, and `HOSTED_EMAIL_SIGNING_SECRET` for hosted email routing
- opt-in runtime integrations such as `LINQ_*`, `TELEGRAM_*`, and `MAPBOX_ACCESS_TOKEN`; native parser binaries and the Whisper model are image-owned by the runner container and rebound from the image instead of being serialized through Worker runtime envelopes

When hosted email sender identity is configured, deploy automation renders an environment-specific native `HOSTED_EMAIL` send binding and constrains it with `allowed_sender_addresses` so outbound sender selection remains config-owned.

The runtime always includes the minimal `assistant` env profile. Deploy automation layers `hosted-email`, `linq`, `mapbox`, and `telegram` on top by default. Cloudflare owns the configured profile string, runner-secret allowlisting, native parser toolchain binding inside the container image, and container transport rewrites such as local loopback host adaptation. The profile key sets and canonical hosted runtime launch spec are built by `@murphai/assistant-runtime`, so local and Cloudflare execution pass the same semantic runtime manifest shape. Hosted device-sync runtime config is derived into `runtime.resolvedConfig`, so it stays outside the child-env profile surface.

Cloudflare keeps only the wake-payload decryption lane plus the worker-owned callback-signing key. Broad web-private-field encryption stays in `apps/web`, and the child process reaches the web control plane through the worker proxy instead of holding callback-signing material directly.

## Runner Container Lifecycle

The native Cloudflare container is a warm per-user shell. Successful workspace
invocations leave that shell running until the configured idle lifecycle expiry
fires. Each invocation still runs through an isolated child process with fresh
invocation-local cache/temp roots and a fresh outbound worker-proxy token.

The warm shell is destroyed when an invocation fails, outbound proxy cleanup
fails, warm health is stale, deploy smoke finishes, explicit cleanup is called,
or Cloudflare reports idle activity expiry.

## Deploy Artifacts

`pnpm --dir apps/cloudflare deploy:artifacts` prepares:

- `apps/cloudflare/.deploy/runner-bundle/`
- `apps/cloudflare/.deploy/wrangler.generated.jsonc`
- `apps/cloudflare/.deploy/worker-secrets.json`

`pnpm --dir apps/cloudflare deploy:worker` is the canonical cut because it renders environment-specific deploy config, worker secrets, the hosted email send binding restrictions, and the cached native runner base image before upload; its apply step also runs deploy preflight before Wrangler upload. The lower-level version helper remains in-tree as a recovery-only path.
Deploy smoke pins the 100% Worker version, verifies the response-reported version metadata, and, when enabled by the workflow, runs a signed managed-container smoke that compares the live runner bundle fingerprint with `.deploy/runner-bundle/.murph-runner-bundle-manifest.json`.

See [DEPLOY.md](./DEPLOY.md) for the exact GitHub environment surface, lifecycle rules, and smoke workflow.
