# @murphai/hosted-web

Hosted integration control plane for Vercel deployments.

`apps/web` is the canonical hosted control plane. Hosted product meaning lives
in Postgres here, not in Cloudflare worker control storage. In particular,
`apps/web` owns hosted member identity, routing, billing, email authorization,
share facts, device-sync control-plane authority, the hosted AI usage ledger,
and the canonical web-owned `HostedWake` / `HostedExecutionCursor` execution queue.

Every hosted producer now appends canonical wakes in Postgres and hands execution
off to Cloudflare with a narrow authenticated wake call. There is no parallel
legacy dispatch architecture.

`apps/cloudflare` remains the execution-only runtime boundary. It accepts
authenticated execution intents, restores encrypted runtime state, runs one
hosted job, and commits the next encrypted workspace snapshot. It may hold
opaque encrypted runtime blobs and explicit execution-time callback data, but it is not the
canonical owner of hosted product facts.
Hosted device-sync provider registration is intentionally shared with
`@murphai/device-syncd/config`; `apps/web` should reuse that assembly path
instead of maintaining an app-local provider list or provider-config object.

## Core responsibilities

- Garmin, Oura, Strava, and WHOOP OAuth start/callback flows
- Oura, Strava, and WHOOP webhook intake
- hosted Linq and Telegram webhook ingress plus sparse routing state
- per-user device connection ownership mapping plus token audit history
- hosted member core, identity, routing, billing, and email-authorization slices
- hosted share link metadata, canonical hosted share payloads, and share-claim state
- durable `HostedWake` rows plus `HostedExecutionCursor` as the canonical hosted wake/cursor seam
- immutable hosted AI usage rows in Postgres for billing-safe reconciliation
- hosted Stripe receipt/retry state, billing reconciliation, and onboarding webhook receipts
- local-agent pairing plus sparse signal/token routes for hosted integrations

## Non-goals

- canonical health-data storage
- canonical inbox-capture storage
- vault imports
- proxying provider health payloads through the hosted app
- storing canonical Linq chat captures in Postgres
- storing raw provider webhook bodies or provider tokens in hosted API responses
- turning Cloudflare execution mirrors into a second durable source of product truth

## Canonical hosted models

The hosted Prisma schema keeps ownership sharp and nested:

- `HostedMember` is the core member row plus activation/billing status
- `HostedMemberIdentity` owns recoverable member identity facts
- `HostedMemberRouting` owns hosted channel routing facts
- `HostedMemberBillingRef` owns Stripe/customer subscription references
- `HostedMemberEmailAuthorization` owns verified-email and sender-authorization facts
- `HostedShareLink` owns public share-link UX metadata and claim lifecycle
- `HostedSharePayload` owns canonical encrypted share payloads in Postgres
- `HostedExecutionCursor` owns the canonical committed high-water and snapshot fence
- `HostedWake` owns the canonical ordered hosted wake queue
- fetched hosted wakes carry short-lived web-minted advance proofs, and cursor
  advancement must present the proof for the exact fetched wake identity rather
  than trusting a caller-supplied seq alone
- `HostedAiUsage` owns the canonical hosted usage ledger

## Key environment variables

See `.env.example` for a working template.

Required:

- `DATABASE_URL`
- `DEVICE_SYNC_ENCRYPTION_KEY`
- `DEVICE_SYNC_ENCRYPTION_KEY_VERSION`

Required for the hosted device-sync lane:

- `GARMIN_CLIENT_ID`
- `GARMIN_CLIENT_SECRET`
- `WHOOP_CLIENT_ID`
- `WHOOP_CLIENT_SECRET`
- `OURA_CLIENT_ID`
- `OURA_CLIENT_SECRET`
- `STRAVA_CLIENT_ID`
- `STRAVA_CLIENT_SECRET`

Required for hosted Linq ingress:

- `LINQ_WEBHOOK_SECRET`

Optional but recommended:

- `DEVICE_SYNC_PUBLIC_BASE_URL`
- `DEVICE_SYNC_ALLOWED_MUTATION_ORIGINS`
- `DEVICE_SYNC_ALLOWED_RETURN_ORIGINS`
- `DEVICE_SYNC_TRUSTED_USER_ASSERTION_HEADER`
- `DEVICE_SYNC_TRUSTED_USER_SIGNATURE_HEADER`
- `DEVICE_SYNC_TRUSTED_USER_SIGNING_SECRET`
- `HOSTED_WEB_BASE_URL`
- `CRON_SECRET`
- `HOSTED_WEB_CALLBACK_SIGNING_PUBLIC_JWK`
- `HOSTED_WEB_CALLBACK_SIGNING_KEY_ID`
- `HOSTED_WEB_CALLBACK_SIGNING_PUBLIC_KEYRING_JSON`
- `HOSTED_WAKE_COMMIT_PROOF_KEY`
- `HOSTED_WAKE_COMMIT_PROOF_KEY_ID`
- `HOSTED_WAKE_COMMIT_PROOF_KEYRING_JSON`
Provider-owned webhook-admin settings:

- `OURA_WEBHOOK_VERIFICATION_TOKEN` when the shared Oura provider config should answer webhook preflight challenges and maintain Oura webhook subscriptions. This secret should stay on the provider-owned config path rather than the generic hosted env surface.
- `STRAVA_WEBHOOK_VERIFY_TOKEN` when the shared Strava provider config should answer webhook preflight challenges and maintain the one app-global Strava webhook subscription. This secret should stay on the provider-owned config path rather than the generic hosted env surface.

Hosted onboarding extras:

- `HOSTED_ONBOARDING_PUBLIC_BASE_URL`
- `HOSTED_CONTACT_PRIVACY_KEYS`
- `HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION`
- `HOSTED_WEB_ENCRYPTION_KEY`
- `HOSTED_WEB_ENCRYPTION_KEY_VERSION`
- `HOSTED_WEB_ENCRYPTION_KEYRING_JSON`
- `HOSTED_WAKE_ENCRYPTION_KEY`
- `HOSTED_WAKE_ENCRYPTION_KEY_VERSION`
- `HOSTED_WAKE_ENCRYPTION_KEYRING_JSON`
- `HOSTED_ONBOARDING_SIGNUP_PHONE_NUMBER`
- `NEXT_PUBLIC_PRIVY_APP_ID`
- `NEXT_PUBLIC_PRIVY_CLIENT_ID`
- `PRIVY_CUSTOM_AUTH_DOMAIN`
- `PRIVY_BASE_DOMAIN`
- `PRIVY_APP_SECRET`
- `PRIVY_VERIFICATION_KEY`
- `HOSTED_ONBOARDING_INVITE_TTL_HOURS`
- `HOSTED_ONBOARDING_LINQ_CONVERSATION_PHONE_NUMBERS`
- `HOSTED_ONBOARDING_LINQ_MAX_ACTIVE_MEMBERS_PER_PHONE_NUMBER`
- `HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_MONTHLY`
- `HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_ANNUAL`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `LINQ_API_TOKEN`
- `LINQ_API_BASE_URL`
- `HOSTED_EXECUTION_CONTROL_URL`
- `HOSTED_EXECUTION_CONTROL_TIMEOUT_MS`

Optional hosted AI usage metering:

- `HOSTED_AI_USAGE_STRIPE_METER_EVENT_NAME`
- `HOSTED_AI_USAGE_STRIPE_BATCH_LIMIT`

Hosted pages assume the hosted Privy phone-auth setup is present and fail fast
when it is missing instead of carrying fallback branches in page code.

## Hosted public origin and Cloudflare callback auth

This section is the operator-facing contract for hosted public origin and the
narrow Cloudflare-to-web signed callback surface.

Public origin precedence:

- `HOSTED_ONBOARDING_PUBLIC_BASE_URL` wins for invite, join, and hosted-share links
- otherwise `HOSTED_WEB_BASE_URL` is the canonical hosted-web public base URL
- on Vercel, when neither explicit hosted public-base env is set, `apps/web`
  falls back to `VERCEL_PROJECT_PRODUCTION_URL`
- `DEVICE_SYNC_PUBLIC_BASE_URL` overrides the provider-facing callback and
  webhook base for hosted device sync; when unset, `apps/web` derives that base
  as `<canonical hosted public origin>/api/device-sync`

Callback auth contract:

- `apps/web` verifies narrow Cloudflare-signed internal callbacks with
  `HOSTED_WEB_CALLBACK_SIGNING_PUBLIC_JWK`
- `HOSTED_WEB_CALLBACK_SIGNING_KEY_ID` selects the active callback key id and
  defaults to `v1`
- `HOSTED_WEB_CALLBACK_SIGNING_PUBLIC_KEYRING_JSON` is the optional
  `{ keyId: publicJwk }` verification keyring for staged rotation
- `apps/cloudflare` signs those callbacks with
  `HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK`
- `HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK` stays in the Cloudflare worker
  boundary; the isolated execution child talks back through the worker-owned
  `web-control.worker` proxy instead of receiving the signing key directly
- `apps/web` also mints short-lived hosted wake advance proofs with
  `HOSTED_WAKE_COMMIT_PROOF_KEY`
- `HOSTED_WAKE_COMMIT_PROOF_KEY_ID` selects the active wake-proof key id and
  defaults to `v1`
- `HOSTED_WAKE_COMMIT_PROOF_KEYRING_JSON` is the optional
  `{ keyId: encodedKey }` verification keyring for staged wake-proof rotation
- hosted wake payload ciphertext uses the separate
  `HOSTED_WAKE_ENCRYPTION_*` key lane, while member/share private fields remain
  on the web-only `HOSTED_WEB_ENCRYPTION_*` lane

When you set `DEVICE_SYNC_PUBLIC_BASE_URL`, point it at the stable production
project domain or a custom domain. Do not use ephemeral preview deployment URLs
as long-lived provider callback or webhook bases.

### Vercel setup

Set these under `Settings -> Environment Variables` in the Vercel project that
deploys `apps/web`. Production is the minimum.

- Enable Vercel OIDC so the app-local hosted-execution auth adapter can present
  workload identity to Cloudflare on dispatch and status requests.
- Set `CRON_SECRET` for the hosted cron routes under `/api/internal/**/cron`.
- Configure the hosted public-origin envs and `HOSTED_WEB_CALLBACK_SIGNING_*`
  values exactly as described above.
- Set `HOSTED_ONBOARDING_LINQ_CONVERSATION_PHONE_NUMBERS` and, if needed,
  `HOSTED_ONBOARDING_LINQ_MAX_ACTIVE_MEMBERS_PER_PHONE_NUMBER`.
- Set `DEVICE_SYNC_TRUSTED_USER_SIGNING_SECRET` to the same value used by the
  trusted auth edge that signs browser assertions for lower-level device-sync
  bridge routes.

Development fallback only:

- `DEVICE_SYNC_DEV_USER_ID`
- `DEVICE_SYNC_DEV_USER_EMAIL`
- `DEVICE_SYNC_DEV_USER_NAME`

## Browser auth contract

The lower-level assertion-backed device-sync bridge routes, such as
`POST /api/device-sync/agents/pair`, trust a front-end/auth proxy only when it
attaches:

- a base64url JSON assertion in `DEVICE_SYNC_TRUSTED_USER_ASSERTION_HEADER`
- an HMAC signature for that assertion in `DEVICE_SYNC_TRUSTED_USER_SIGNATURE_HEADER`

The signed assertion must include hosted user claims plus:

- `iat` and `exp` with a lifetime of at most 5 minutes
- a strong random `nonce`
- `aud`, `method`, `path`, and `origin` bindings for the current request

Each assertion nonce is consumed once so replayed assertions fail even if the
user tuple is unchanged.

## Secret hygiene and rotation

- Keep committed `.env.example` placeholder-only.
- For local hosted-web work, prefer Vercel-backed process injection via
  `cd apps/web && pnpm dev` instead of writing real secrets to repo-local env files.
- Treat leaked raw repo archives that included local hosted env files the same
  way as direct secret exposure.
- Rotate `DEVICE_SYNC_ENCRYPTION_KEY_VERSION` whenever you rotate
  `DEVICE_SYNC_ENCRYPTION_KEY`.
- Durable hosted device-sync authority now lives on the web/device-sync side.
  Cloudflare consumes explicit execution-time snapshots and signed writebacks only; token rotation or
  revocation must follow the web-owned control-plane path instead of relying on
  worker-owned runtime state.

## Prisma

Generate the client and apply migrations with Prisma:

```bash
pnpm --dir apps/web prisma:generate
pnpm --dir apps/web prisma:migrate:deploy
```

The hosted schema now includes the canonical member slices, hosted email
authorization, hosted share payload ownership, device-sync web ownership
models, plus the canonical `HostedWake` / `HostedExecutionCursor` fence.

## Local dev aids

Dev-only helpers for iterating on UI. All guarded by `process.env.NODE_ENV !== "production"` and removed from the production bundle.

- `/join/<inviteCode>?preview=<stage>` and `/join/<inviteCode>/success?preview=<stage>` render any signup-flow stage without a real invite. Stages: `invalid`, `expired`, `verify`, `checkout`, `messaging-setup`, `blocked`, `active`, `active-pending`. Disables the status-refresh poll so the mocked status is not overwritten.
- CSP allows `https://ui.sh` only in development so the `ui-picker` toolbar can load during design iteration. Production CSP is unchanged.

## Local verification

- `pnpm --dir apps/web lint`
- `pnpm --dir apps/web typecheck`
- `pnpm --dir apps/web test`
- `pnpm --dir apps/web verify`

Notes:

- For local dev with hosted secrets, run `cd apps/web && pnpm dev` so Vercel
  injects the linked project's development env without writing a local env file.
- `apps/web/prisma.config.ts` reads `DATABASE_URL` from the process environment only.
- `pnpm --dir apps/web dev` keeps interactive Next dev artifacts under
  `apps/web/.next-dev`.
- `pnpm --dir apps/web build` and `pnpm --dir apps/web start` use `apps/web/.next`.
- Treat `apps/web/.next`, `apps/web/.next-dev`, and `apps/web/.next-smoke` as
  generated local artifacts that must stay out of commits and raw source bundles.
- Hosted wake repair, usage metering, Stripe recovery, and webhook
  receipt recovery accept only Vercel cron bearer auth via `CRON_SECRET`.
- Hosted Stripe reconciliation now commits local billing facts plus inline
  `member.activated` HostedWake facts first, then performs post-commit managed-user
  crypto provisioning in the activation path.

## Main routes

Hosted settings-authenticated wearable routes:

- `GET /api/settings/device-sync`
- `GET /api/settings/device-sync/connections/:connectionId/status`
- `POST /api/settings/device-sync/providers/:provider/connect`
- `POST /api/settings/device-sync/connections/:connectionId/disconnect`
- `POST /api/settings/email/sync`

Assertion-authenticated browser-to-agent bridge routes:

- `POST /api/device-sync/agents/pair`
- `GET /api/linq/bindings`
- `POST /api/linq/bindings`

Public provider-facing routes:

- `GET /api/device-sync/oauth/:provider/callback`
- `POST /api/device-sync/webhooks/:provider`
- `GET /api/device-sync/webhooks/oura`
- `GET /api/device-sync/webhooks/strava`
- `GET /api/linq/webhook`
- `POST /api/linq/webhook`
- `POST /api/hosted-onboarding/telegram/webhook`

Local-agent routes:

- `GET /api/device-sync/agent/signals`
- `POST /api/device-sync/agent/connections/:connectionId/export-token-bundle`
- `POST /api/device-sync/agent/connections/:connectionId/refresh-token-bundle`
- `POST /api/device-sync/agent/connections/:connectionId/local-heartbeat`
- `POST /api/linq/agents/pair`
- `GET /api/linq/agent/events`

Internal hosted maintenance and Cloudflare callback routes:

- `POST /api/internal/device-sync/providers/:provider/connect-link`
- `POST /api/internal/device-sync/runtime/snapshot`
- `POST /api/internal/device-sync/runtime/apply`
- `GET /api/internal/hosted-execution/share/:shareId/payload`
- `GET /api/internal/hosted-execution/usage/cron`
- `POST /api/internal/hosted-execution/usage/record`
- `GET /api/internal/hosted-onboarding/stripe/cron`
- `GET /api/internal/hosted-onboarding/webhook-receipts/cron`

The old staged-payload and share-import completion/release callback routes are
gone. Cloudflare no longer round-trips through broad mirror CRUD routes,
share-pack CRUD, or an outbox drain route. It still uses narrow signed
hosted-web callbacks for execution-time device-sync authority reads/writes,
device connect-link starts, canonical hosted share payload reads, direct
hosted usage recording, and canonical HostedWake append/fetch/commit calls.

## Hosted onboarding and share routes

Hosted onboarding and share surfaces:

- `GET /`
- `GET /join/:inviteCode`
- `GET /join/:inviteCode/success`
- `GET /join/:inviteCode/cancel`
- `GET /share/:shareCode`
- `GET /api/hosted-onboarding/invites/:inviteCode/status`
- `POST /api/hosted-onboarding/invites/:inviteCode/send-code`
- `POST /api/hosted-onboarding/invites/:inviteCode/send-code/confirm`
- `POST /api/hosted-onboarding/invites/:inviteCode/send-code/abort`
- `POST /api/hosted-onboarding/privy/complete`
- `POST /api/hosted-onboarding/billing/checkout`
- `GET /api/hosted-onboarding/billing/success`
- `GET|POST /api/hosted-onboarding/linq/webhook`
- `POST /api/hosted-onboarding/stripe/webhook`
- `GET /api/hosted-share/:shareCode/status`
- `POST /api/hosted-share/:shareCode/accept`
- `POST /api/hosted-share/create`

The onboarding lane is intentionally thin:

- Linq or the public landing page can start phone-bound signup.
- Privy remains the browser auth boundary for hosted onboarding.
- Stripe Checkout is subscription-only and `invoice.paid` remains the only
  positive entitlement source.
- Hosted webhook receipts are retry journals for receipt-local side effects,
  not a second execution lifecycle authority.
- Hosted share payloads are canonically stored in Postgres; Cloudflare fetches
  them through the signed internal payload route immediately before import.
- Hosted share acceptance writes canonical claim state plus an inline
  `vault.share.accepted` HostedWake in the same transaction.
- Cloudflare-bound execution from onboarding, share acceptance, and hosted
  device-sync wake paths always appends canonical `HostedWake` rows first.
- Verified email sync updates canonical hosted email-authorization facts in web
  storage; it does not write hosted execution env.

Current hosted billing assumptions:

- Hosted checkout is always Stripe subscription mode.
- The launch tier is sold as one Stripe product with separate monthly and annual recurring prices.
- `invoice.paid` is the only positive activation source.
- `checkout.session.completed` and `customer.subscription.*` do not grant access.
- RevNet issuance code remains in-tree but is currently hard-disabled.
- Chargebacks, disputes, and refunds suspend hosted access pending manual review.
