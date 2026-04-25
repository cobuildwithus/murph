# @murphai/cloudflare-runner

Cloudflare-hosted execution plane for the hosted Murph path.

`apps/web` is the canonical owner of onboarding, billing, auth, share facts, device-sync authority, usage reconciliation, and other hosted product facts. `apps/cloudflare` is the execution-only edge/runtime layer that accepts authenticated run/control requests, restores encrypted runtime state, runs one hosted job, and commits the next encrypted snapshot.

## What This App Owns

- Vercel OIDC-authenticated run/control requests from `apps/web`
- per-user execution coordination in `USER_RUNNER`
- native runner-container lifecycle in `RUNNER_CONTAINER`
- encrypted hosted workspace snapshots, externalized artifact blobs, encrypted runner-secrets blobs, and the execution-sidecar blobs needed to run and finalize hosted jobs in `BUNDLES`

## What It Does Not Own

- browser or webhook control-plane flows for onboarding, billing, auth, or member lifecycle
- canonical hosted product facts or ledgers outside the encrypted execution workspace, including hosted usage and lifecycle state in `apps/web`
- gateway state or other product truth outside the encrypted workspace snapshot

## Route Surface

Public routes:

- `GET /`
- `GET /health`

Internal control routes:

- `POST /internal/users/:userId/run` returns a dedicated run-drain result (`committedSeq`, `requestedTargetSeq`, `targetReached`) rather than the general status read model
- `POST /internal/users/:userId/browser-vault/session`
- `GET /internal/users/:userId/status`

The supported worker HTTP surface stops at those three control routes plus the public banner and health checks.
Hosted assistant post-commit delivery recovery now comes from committed side-effect state inside the encrypted workspace plus the web-owned hosted-run recovery record.
When `HOSTED_EXECUTION_LOCAL_INTERNAL_PROXY_BASE_URL` is configured for local hosted development, the worker also accepts a loopback-only transport shim under `__murph/local-internal-proxy/users/:userId/:host/...`; that seam is not a supported product API and exists only to bridge local child-runtime requests back onto the same per-run opaque internal-worker proxy token contract used by direct `http://*.worker` requests.

## Storage Contract

- The `vault` bundle slot stores one encrypted hosted workspace snapshot. That snapshot is still sensitive canonical vault material, not a second product database.
- Large files are externalized into separately encrypted artifact blobs in the same bucket.
- Separate encrypted objects hold runner-specific secret overrides and other execution-only sidecar blobs so those runtime artifacts do not force workspace rewrites.
- Durable Object SQLite stores execution coordination only: lease and stale-result fencing, alarm hints, and timestamps. Canonical ingress ordering, snapshot refs, cursor progress, and durable finalize recovery stay web-owned; bundle refs come from acquired run/cursor state and may be kept only as an in-memory warm cache.
- Hosted raw email payloads now live under a durable encrypted prefix, are deleted after terminal wake cleanup when possible, and also carry a 1-hour R2 lifecycle backstop under `hosted-email/messages/` if eager cleanup misses them.
- Other encrypted execution blobs remain owner-cleaned or durable by design, including workspace snapshots, artifact blobs, runner-secrets blobs, and queue-local execution sidecars. Hosted device-sync runtime authority stays in `apps/web` behind narrow signed callbacks.

## Worker Contract

Bindings:

- `USER_RUNNER`
- `RUNNER_CONTAINER`
- `BUNDLES`
- `CF_VERSION_METADATA` version metadata binding, used by deploy smoke to prove the requested Worker version actually handled the request
- optional `HOSTED_EMAIL` native `send_email` binding for outbound hosted email

Required worker secrets:

- `HOSTED_EXECUTION_PLATFORM_ENVELOPE_KEY`
- `HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PRIVATE_JWK`
- `HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PUBLIC_JWK`
- `HOSTED_EXECUTION_RECOVERY_RECIPIENT_PUBLIC_JWK`
- `HOSTED_WAKE_ENCRYPTION_KEY`
- `HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK`

Required worker vars:

- `HOSTED_WEB_BASE_URL`
- `HOSTED_EXECUTION_VERCEL_OIDC_TEAM_SLUG`
- `HOSTED_EXECUTION_VERCEL_OIDC_PROJECT_NAME`

`HOSTED_WEB_BASE_URL` must be an origin-only hosted web URL. Do not configure a
subpath such as `https://example.test/app`; the worker appends its own internal
callback routes to that origin.

Defaulted worker vars:

- `HOSTED_EXECUTION_PLATFORM_ENVELOPE_KEY_ID=v1`
- `HOSTED_EXECUTION_RECOVERY_RECIPIENT_KEY_ID=recovery:v1`
- `HOSTED_EXECUTION_MAX_EVENT_ATTEMPTS=3`
- `HOSTED_EXECUTION_RETRY_DELAY_MS=30000`
- `HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS=30000`
- `HOSTED_EXECUTION_RUNNER_TIMEOUT_MS=600000`
- `HOSTED_EXECUTION_WEB_CONTROL_TIMEOUT_MS=120000`
- `HOSTED_EXECUTION_VERCEL_OIDC_ENVIRONMENT=production`

Optional execution vars and secrets:

- `HOSTED_WEB_CALLBACK_SIGNING_KEY_ID` for callback key rotation metadata on the required signed hosted-web path
- `HOSTED_WAKE_ENCRYPTION_KEY_VERSION` and `HOSTED_WAKE_ENCRYPTION_KEYRING_JSON` for wake-payload key rotation inside the execution plane
- `HOSTED_EXECUTION_ALLOWED_RUNNER_SECRET_KEYS` and `HOSTED_EXECUTION_RUNNER_ENV_PROFILES` for execution-time secret forwarding
- `HOSTED_EXECUTION_PLATFORM_ENVELOPE_KEYRING_JSON`, `HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PRIVATE_KEYRING_JSON`, and `HOSTED_EXECUTION_TEE_AUTOMATION_RECIPIENT_PUBLIC_JWK` for staged key rotation or future envelope lanes
- `HOSTED_ASSISTANT_*` config plus supported assistant provider API keys
- `HOSTED_AI_USAGE_BILLING_MODE=stripe_meter`, `HOSTED_AI_USAGE_VERCEL_STRIPE_BILLING_ENABLED`, and `HOSTED_AI_USAGE_STRIPE_RESTRICTED_ACCESS_KEY` when Vercel AI Gateway should emit Stripe meter events directly
- `HOSTED_EMAIL_DOMAIN`, `HOSTED_EMAIL_LOCAL_PART`, optional `HOSTED_EMAIL_FROM_ADDRESS`, `HOSTED_EMAIL_DEFAULT_SUBJECT`, and `HOSTED_EMAIL_SIGNING_SECRET` for hosted email routing
- opt-in runtime integrations such as `MURPH_WEB_*`, `LINQ_*`, `TELEGRAM_*`, `MAPBOX_ACCESS_TOKEN`, `FFMPEG_COMMAND`, `WHISPER_COMMAND`, and `WHISPER_MODEL_PATH`

When hosted email sender identity is configured, deploy automation renders an environment-specific native `HOSTED_EMAIL` send binding and constrains it with `allowed_sender_addresses` so outbound sender selection remains config-owned.

The runtime always includes the minimal `assistant`, `parsers`, and `web` env profiles. Deploy automation layers `hosted-email`, `linq`, `mapbox`, and `telegram` on top by default. Hosted device-sync runtime config is derived directly from worker env into `runtime.resolvedConfig`, so it stays outside the child-env profile surface.

Cloudflare keeps only the wake-payload decryption lane plus the worker-owned callback-signing key. Broad web-private-field encryption stays in `apps/web`, and the child process reaches the web control plane through the worker proxy instead of holding callback-signing material directly.

## Deploy Artifacts

`pnpm --dir apps/cloudflare deploy:artifacts` prepares:

- `apps/cloudflare/.deploy/runner-bundle/`
- `apps/cloudflare/.deploy/wrangler.generated.jsonc`
- `apps/cloudflare/.deploy/worker-secrets.json`

`pnpm --dir apps/cloudflare deploy:worker` is the canonical cut because it renders environment-specific deploy config, worker secrets, the hosted email send binding restrictions, and the cached native runner base image before upload. The lower-level version helper remains in-tree as a recovery-only path.
Deploy smoke pins the 100% Worker version, verifies the response-reported version metadata, and, when enabled by the workflow, runs a signed managed-container smoke that compares the live runner bundle fingerprint with `.deploy/runner-bundle/.murph-runner-bundle-manifest.json`.

See [DEPLOY.md](./DEPLOY.md) for the exact GitHub environment surface, lifecycle rules, and smoke workflow.
