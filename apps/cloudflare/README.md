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
The runner container sends runtime internal Worker requests to normal virtual hosts such as `results.worker` and `web-control.worker`. Cloudflare Container outbound interception routes those requests back into Worker-owned handlers, using the runtime write-fence headers as authority.
The runner container also uses Cloudflare HTTPS outbound interception for hosted provider egress. OpenAI, Exa, Mapbox, Linq, Telegram, and WhatsApp real credentials stay in Worker env. Hosted OpenAI/Codex receives a signed Murph provider credential in the native `OPENAI_API_KEY` slot; the Worker verifies that credential as `provider + user + runner`, asks UserRunner whether the same runner currently has an active runtime for that user, then injects the real Worker-owned OpenAI key only into the upstream request. Exa, Mapbox, internal `murph_data_api`, and `workers_ai_transcribe` still use the legacy sentinel plus active-user-fence fallback when no exact runtime authority headers or provider-egress token are present. Delivery providers (Linq, Telegram, WhatsApp) and ElevenLabs remain excluded from tokenless fallback and continue to require exact write-fence headers or a provider-egress token, because those effects must stay behind recipient binding, journaling, and idempotency. The Worker constrains Exa to `POST /search`, constrains Linq to the runtime route matrix (`GET /phone_numbers`, `GET /attachments/:id`, `POST /attachments`, `POST /chats`, `POST /chats/:id/messages`, `POST /chats/:id/voicememo`, `POST /chats/:id/typing`, `DELETE /chats/:id/typing`, `POST /chats/:id/read`, `POST /messages/:id/reactions`, `DELETE /messages/:id`), constrains Mapbox to read-only GET allowlisted path families, and strips runtime authority headers before upstream provider egress leaves Cloudflare. Hosted generated-image turns call OpenAI through the runner-scoped provider credential path and then upload validated image bytes through the write-fenced `results.worker/generated-images` effect, where Cloudflare Images credentials stay Worker-owned. Runner container names identify the runner for server-side validation; `ctx.containerId` is not provider-egress authorization. Unknown egress currently passes through during migration and logs only sanitized method/host/path metadata. Adding a new hosted provider API, method, or runtime tool that calls an intercepted provider is not complete until this egress boundary and its regression tests allow the exact upstream operation.
The container supervisor sets `CODEX_CA_CERTIFICATE`, `SSL_CERT_FILE`, `NODE_EXTRA_CA_CERTS`, `REQUESTS_CA_BUNDLE`, and `CURL_CA_BUNDLE` to Cloudflare's runtime interception CA path, and direct invocation builds the runtime config from an explicit frozen supervisor env, preserves those CA bundle pointers plus Cloudflare-managed proxy env needed by hosted-local Containers egress interception, and still blocks operator-only process-control env plus user-supplied proxy overrides.

Root `pnpm dev` starts the same local Cloudflare container path and uses the image-owned `codex app-server` runtime with direct OpenAI configuration routed through the Worker intercept. There is no host Codex bridge for normal hosted-local execution: `MURPH_DEV_CODEX_APP_SERVER_PROXY_TOKEN` and `MURPH_DEV_CODEX_APP_SERVER_PROXY_URL` are rejected by the Cloudflare runner env policy. Generated local env files are treated as secret material and must provide `HOSTED_ASSISTANT_PROVIDER=openai` plus the Worker-owned `OPENAI_API_KEY` secret; the raw key is not copied into direct runtime env.

## Storage Contract

- The live v2 workspace snapshot is one encrypted zstd-compressed tar object under `users/<namespace>/workspace-snapshots/<snapshotId>.snapshot.enc`. The container uploads that object directly to R2 through a short-lived presigned `PUT` URL minted by the Worker, and restores through a presigned `GET`; Worker routes carry JSON session/presign/complete metadata only and never receive the snapshot body. This v2 format is a greenfield zstd hard cut: gzip v2 refs are not produced or restored.
- V2 snapshot creation validates the planned durable-root entries, then streams `tar -> zstd -> AES-GCM` into the encrypted object. Restore treats v2 snapshots as first-party authenticated artifacts: it verifies the encrypted object size/hash, AES-GCM tag, and plaintext compressed archive hash, extracts once into a temporary root, then swaps that root into place. Restore does not re-list tar members; a valid encrypted snapshot is trusted as output from the snapshot writer.
- Legacy full/base bundle refs and legacy artifact sidecars remain restoreable during migration, but v2 snapshot production does not externalize raw files into artifact blobs.
- Separate encrypted objects hold runner-specific secret overrides and other execution-only sidecar blobs so those runtime artifacts do not force workspace rewrites.
- Durable Object SQLite stores execution coordination only: lease and stale-result fencing, alarm hints, timestamps, and short-lived direct-R2 upload sessions without persisted presigned URLs. Canonical mailbox ordering, workspace checkpoint refs, redacted status/logs, and mailbox lag stay web-owned; snapshot refs come from hosted-runtime workspace control responses and may be kept only as an in-memory warm cache.
- Hosted raw email payloads now live under the encrypted, root-independent `hosted-email/messages/{storageNamespaceId}/` prefix. Raw blobs and their encrypted recovery refs carry an R2 lifecycle backstop under `hosted-email/messages/` that makes them deletion-eligible after 24 hours, while account-deletion cleanup removes the same user prefix directly. Normal worker deploys reapply that checked-in lifecycle rule before `wrangler deploy`. Removed pre-launch root-derived raw-email paths are unsupported under the greenfield hard cut; the same lifecycle prefix bounds any transient leftovers.
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
- `HOSTED_PROVIDER_EGRESS_CREDENTIAL_SIGNING_SECRET`
- `HOSTED_R2_PRESIGN_ACCESS_KEY_ID`
- `HOSTED_R2_PRESIGN_SECRET_ACCESS_KEY`
- `HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK`
- `MURPH_DATA_API_KEY`
- `OPENAI_API_KEY`

`MURPH_DATA_API_KEY` authorizes the Worker-to-web hop for the internal
`http://murph-data-api.worker/api/foods` and `/api/supplements` runtime
endpoints. The key stays Worker-owned and is never forwarded into hosted runtime
env. Hosted web must have `MURPH_LABELS_DB_URL` before serving either
`/api/foods` or `/api/supplements`; `MURPH_SUPPLEMENT_DB_URL` is not a runtime
fallback.

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
- `HOSTED_EXECUTION_RUNNER_IDLE_TTL_MS=1200000` for the native container shell
  activity-expiry cleanup lifecycle (code default is `300000` when unset)
- `HOSTED_EXECUTION_RETRY_DELAY_MS=30000`
- `HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS=30000`
- `HOSTED_EXECUTION_WEB_CONTROL_TIMEOUT_MS=30000`
- `HOSTED_EXECUTION_VERCEL_OIDC_ENVIRONMENT=production`

`HOSTED_EXECUTION_MAX_EVENT_ATTEMPTS` bounds consecutive failed hosted runner
invocations for a Durable Object. Temporal decides when durable work is due by
reading web-owned reconciliation facts; Cloudflare does not reread web
mailbox/workspace status as a scheduler. Cloudflare alarms clear active
write-fence alarm state only, while successful runtime completion or a
replacement invocation clears stale execution-failure state.

Optional execution vars and secrets:

- `HOSTED_WEB_CALLBACK_SIGNING_KEY_ID` for callback key rotation metadata on the required signed hosted-web path
- `HOSTED_EXECUTION_ALLOWED_RUNNER_SECRET_KEYS` and `HOSTED_EXECUTION_RUNNER_ENV_PROFILES` for execution-time secret forwarding
- `HOSTED_ASSISTANT_PROVIDER=openai` for Codex hosted assistant execution through the Worker egress intercept. The standard deploy preflight requires Worker-owned `OPENAI_API_KEY` plus `HOSTED_PROVIDER_EGRESS_CREDENTIAL_SIGNING_SECRET`; hosted Codex receives only a signed Murph provider credential, never the real OpenAI key. Host Codex bridge/proxy env is not accepted
- `CLOUDFLARE_IMAGES_ACCOUNT_ID`, Worker secret `CLOUDFLARE_IMAGES_API_KEY`, and optional `CLOUDFLARE_IMAGES_VARIANT` enable hosted generated-image uploads through Cloudflare Images. These values stay Worker-owned and are not accepted as runner env overrides.
- `HOSTED_R2_PRESIGN_ENDPOINT` can override the default account-scoped R2 S3 endpoint for direct snapshot URL generation. Production deploys must leave it as the account-scoped R2 HTTPS origin. Hosted-local dev, worker-only, and E2E profiles start a MinIO sidecar and inject local S3-compatible endpoints behind the local-only `HOSTED_R2_PRESIGN_ALLOW_LOCAL_ENDPOINT=1` guard; those local endpoint flags are not deploy vars.
- `HOSTED_AI_USAGE_REPORTING_SECRET` is an optional Worker-owned platform
  secret. It must not be forwarded into the hosted runtime env; usage
  attribution is added at the Worker/web-control boundary when configured.
- `HOSTED_EMAIL_DOMAIN`, `HOSTED_EMAIL_LOCAL_PART`, optional `HOSTED_EMAIL_FROM_ADDRESS`, `HOSTED_EMAIL_DEFAULT_SUBJECT`, and `HOSTED_EMAIL_SIGNING_SECRET` for hosted email routing
- opt-in runtime integrations such as `EXA_API_KEY`, `LINQ_*`, `TELEGRAM_*`, `WHATSAPP_*`, and `MAPBOX_ACCESS_TOKEN`; provider credentials for intercepted integrations stay Worker-owned and are represented in the hosted runtime by sentinel placeholders, while native parser binaries are image-owned by the runner container and rebound from the image instead of being serialized through Worker runtime envelopes; hosted audio transcription has no in-image model and runs through the Worker-owned `AI` binding behind the fixed `murph-transcribe.worker` egress host

When hosted email sender identity is configured, deploy automation renders an environment-specific native `HOSTED_EMAIL` send binding and constrains it with `allowed_sender_addresses` so outbound sender selection remains config-owned.

The runtime always includes the minimal `assistant` env profile. Deploy automation layers `exa`, `hosted-email`, `linq`, `mapbox`, `telegram`, and `whatsapp` on top by default. Cloudflare owns the configured profile string, runner-secret allowlisting, native parser toolchain binding inside the container image, and container transport rewrites such as local loopback host adaptation. The profile key sets and canonical hosted runtime launch spec are built by `@murphai/assistant-runtime`, so local and Cloudflare execution pass the same semantic runtime manifest shape. Hosted device-sync runtime config is derived into `runtime.resolvedConfig`, so it stays outside the runtime-env profile surface.

Cloudflare keeps only the wake-payload decryption lane plus the worker-owned callback-signing key. Broad web-private-field encryption stays in `apps/web`, and the hosted runtime reaches the web control plane through the worker proxy instead of holding callback-signing material directly.

## Runner Container Lifecycle

The native Cloudflare container is a warm per-user shell. Successful workspace
invocations keep the same Durable Object write fence while the runtime waits for
`HOSTED_EXECUTION_IDLE_CHECKPOINT_DELAY_MS`, a coalesced wake, or a projected
runtime wake. If local runtime state is dirty, the direct invocation checkpoints
with reason `idle_shutdown` before returning success. When Cloudflare reports
the container `sleepAfter` lifecycle expiry, the container only yields to an
active foreground operation or tears down the warm shell.
Each invocation runs in-process through `packages/assistant-runtime` with
per-user warm workspace roots and invocation-local cache/temp roots. Runtime
effects use internal virtual hosts and write-fence headers instead of
per-invocation outbound proxy tokens or dynamically installed outbound
handlers. After each request, the container verifies process cleanup by
snapshotting `/proc`, killing unexpected descendant or same-user orphan
processes, and poisoning/exiting the warm shell if cleanup cannot be proven.

The warm shell is destroyed when an invocation fails, warm health is stale,
deploy smoke finishes, explicit cleanup is called, or Cloudflare reports idle
activity expiry with no active foreground operation.

Foreground progress recovery is write-fenced instead of container-destroy
driven. A write fence is commit authority, not liveness proof; the exact wake,
replacement, ambiguous-wake, and fresh-startup retry contract is documented in
`agent-docs/references/hosted-runtime-protocol.md`. The legacy active-invocation
heartbeat and container-stopped RPC shims are retained only for deployed-caller
compatibility until 2026-05-25 and return inert responses. Live runner side
effects validate the runtime-kind write fence by attempt, generation, and user
identity. Hosted OpenAI provider egress validates the signed Murph provider
credential's user and runner against UserRunner's current active runtime state.
Workspace version remains a checkpoint/restore freshness guard, not generic
side-effect authority.

## Deploy Artifacts

`pnpm --dir apps/cloudflare deploy:artifacts` prepares:

- `apps/cloudflare/.deploy/runner-bundle/`
- `apps/cloudflare/.deploy/wrangler.generated.jsonc`
- `apps/cloudflare/.deploy/worker-secrets.json`

`pnpm --dir apps/cloudflare deploy:worker` is the canonical cut because it renders environment-specific deploy config, worker secrets, the hosted email send binding restrictions, and the cached native runner base image before upload; its apply step also runs deploy preflight before direct Wrangler upload.
Deploy smoke pins the 100% Worker version, verifies the response-reported version metadata, and, when enabled by the workflow, runs a signed managed-container smoke that compares the live runner bundle fingerprint with `.deploy/runner-bundle/.murph-runner-bundle-manifest.json`. The same smoke can mint an actual R2 S3 presigned PUT URL, upload a payload larger than 150 MiB from the container, verify the object size through the Worker R2 binding, and delete the smoke object.

See [DEPLOY.md](./DEPLOY.md) for the exact GitHub environment surface, lifecycle rules, and smoke workflow.
