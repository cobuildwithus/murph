# @murphai/hosted-web

Hosted integration control plane for Vercel deployments.

`apps/web` is the canonical hosted control plane. Hosted product meaning lives
in Postgres here, not in Cloudflare worker control storage. In particular,
`apps/web` owns hosted member identity, routing, billing, email authorization,
device-sync control-plane authority, the hosted AI usage ledger,
and the hosted mailbox, latest workspace checkpoint pointer, and redacted
runtime logs/status projection.

Every hosted producer appends an encrypted mailbox item in Postgres and hands
execution off to Cloudflare with a narrow authenticated runner nudge. Hosted
execution no longer flows through a web-owned acquire/commit/finalize run
protocol; the restored local runtime imports mailbox items and checkpoints its
own workspace state.

`apps/cloudflare` remains the execution-only runtime boundary. It accepts
authenticated execution intents, restores encrypted runtime state, runs a
workspace-runtime pass, and checkpoints through the web-owned workspace CAS. It may hold
opaque encrypted runtime blobs and explicit execution-time callback data, but it is not the
canonical owner of hosted product facts.
Hosted device-sync provider registration is intentionally shared with
`@murphai/device-syncd/config`; `apps/web` should reuse that assembly path
instead of maintaining an app-local provider list or provider-config object.

## Experiment detail data sources

The experiment detail page composes two narrow data sources:

- Health Commons is the public protocol source of truth. Server components resolve the generated catalog entity and pass a typed `ExperimentProtocol` into the page.
- The browser vault is the private run source. Client components decrypt the dashboard snapshot in-browser, project a matching `ExperimentRunProjection`, and overlay only private status, timeline, next-step, and outcome fields.

The UI receives the composed `Experiment` view model, but public protocol prose, citations, and commons revisions are never copied into private run state.

## Core responsibilities

- Garmin, Oura, Strava, and WHOOP OAuth start/callback flows
- Oura, Strava, and WHOOP webhook intake
- hosted Linq and Telegram webhook ingress plus sparse routing state
- per-user device connection ownership mapping plus token audit history
- hosted member core, identity, routing, billing, and email-authorization slices
- encrypted hosted mailbox rows and lane counters for durable execution inputs
- latest hosted workspace checkpoint metadata plus redacted runtime logs/status
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
- `HostedMailboxItem`, `HostedMailboxPayload`, and `HostedMailboxLaneCounter`
  own append-only encrypted execution inputs and per-lane sequence allocation
- `HostedWorkspace` owns the latest encrypted checkpoint pointer and redacted
  status projection
- `HostedRuntimeLog` owns bounded redacted observability events
- Cloudflare nudges the per-user runner only; it does not own a queue, mailbox
  cursor, or web-visible run recovery ledger
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
- `HOSTED_ONBOARDING_STRIPE_USAGE_PRICE_ID_LAUNCH_MONTHLY`
- `HOSTED_ONBOARDING_STRIPE_USAGE_PRICE_ID_LAUNCH_ANNUAL`
- `HOSTED_AI_USAGE_BILLING_MODE`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `LINQ_API_TOKEN`
- `LINQ_API_BASE_URL`
- `HOSTED_LINQ_INGRESS_TYPING_DIAGNOSTIC`
- `HOSTED_LINQ_INGRESS_TYPING_DIAGNOSTIC_TIMEOUT_MS`
- `HOSTED_EXECUTION_CONTROL_URL`
- `HOSTED_EXECUTION_CONTROL_TIMEOUT_MS`

Hosted AI usage metering:

- `HOSTED_AI_USAGE_BILLING_MODE` defaults to `disabled`, which records hosted AI usage rows but does not attach usage prices at checkout or post Stripe meter events.
- Missing or unsupported `HOSTED_AI_USAGE_BILLING_MODE` values fail closed to `disabled`.
- `HOSTED_AI_USAGE_BILLING_MODE=stripe_meter` re-enables the classic hosted-web Stripe meter fallback and requires `HOSTED_ONBOARDING_STRIPE_USAGE_PRICE_ID_*` plus `HOSTED_AI_USAGE_STRIPE_METER_EVENT_NAME`.
- `HOSTED_AI_USAGE_STRIPE_METER_EVENT_NAME` must match the Stripe Billing meter attached to the configured `HOSTED_ONBOARDING_STRIPE_USAGE_PRICE_ID_*` prices when you use `stripe_meter`.
- `HOSTED_AI_USAGE_STRIPE_BATCH_LIMIT` controls how many pending usage rows each cron drain attempts.
- `HOSTED_AI_USAGE_VERCEL_STRIPE_BILLING_ENABLED=1` enables the delegated Vercel AI Gateway billing path for platform-owned Gateway requests only when `HOSTED_AI_USAGE_BILLING_MODE=stripe_meter`.
- `HOSTED_AI_USAGE_STRIPE_RESTRICTED_ACCESS_KEY` must be a Stripe restricted key with billing meter-event write permission only; it is forwarded to hosted execution, never persisted with usage rows, and ignored unless it starts with `rk_`.

`apps/web` records every hosted assistant usage row by member in `HostedAiUsage`.
While usage billing is disabled, imported rows keep `stripeMeterSource=murph`
and `stripeMeterStatus=skipped` so they cannot be backbilled later. Rows
delegated to Vercel AI Gateway keep `stripeMeterSource=vercel-ai-gateway`
and `stripeMeterStatus=delegated` only when `stripe_meter` billing is enabled
in both the web app and execution worker,
while the hosted-web Stripe drain owns `stripeMeterSource=murph`.

For exact flat-fee plus included-credit plus provider token cost with margin
pricing, prefer Stripe pricing plans and Billing for LLM tokens when your
account has preview access. If you stay on the classic metered-price fallback,
keep included allowance and overage logic in Stripe pricing rather than
subtracting allowance in app code.

Hosted pages assume the hosted Privy phone-auth setup is present and fail fast
when it is missing instead of carrying fallback branches in page code.

### Local Stripe webhook listener

`pnpm dev` auto-launches `stripe listen --forward-to http://<web-host>:<web-port>/api/hosted-onboarding/stripe/webhook`
and captures the listener's live `whsec_...` signing secret from its startup
output. The captured secret is injected into the web dev child's env as
`STRIPE_WEBHOOK_SECRET` before Next.js boots, so hosted onboarding checkout
works locally without a second terminal.

- The listener's signing secret is per-developer (tied to each operator's
  Stripe CLI login), so sharing a single `STRIPE_WEBHOOK_SECRET` in Vercel
  Development env does not work for a multi-dev team. Remove that value from
  Vercel Development so the captured secret takes over.
- An explicit shell `STRIPE_WEBHOOK_SECRET` or repo-root `.env`
  `STRIPE_WEBHOOK_SECRET` is preserved over the captured value. A stale value
  that would otherwise arrive only through `vercel env pull` is discarded.
- If the Stripe CLI is not on `PATH`, the orchestrator logs an actionable
  warning (`brew install stripe/stripe-cli/stripe`) and continues without the
  listener. Hosted onboarding checkout will fail locally until the CLI is
  installed or `STRIPE_WEBHOOK_SECRET` is set explicitly.
- The listener runs alongside `cloudflare` and `web` but is treated as an
  ancillary process: if it exits post-startup, the orchestrator logs a
  degraded-mode warning and keeps the rest of the stack running. Restart
  `pnpm dev` to recover webhook forwarding.
- Set `MURPH_DEV_SKIP_STRIPE_LISTEN=1` to fully opt out of the auto-listener
  (for example, when running integration tests with a mocked webhook surface).
- Captured secret bytes are redacted before they reach the orchestrator's
  stdout pipe, stderr pipe, and output-tail buffers, so operator logs never
  contain the live `whsec_...`.

## Hosted public origin and Cloudflare callback auth

This section is the operator-facing contract for hosted public origin and the
narrow Cloudflare-to-web signed callback surface.

Public origin precedence:

- `HOSTED_ONBOARDING_PUBLIC_BASE_URL` wins for invite and join links
- otherwise `HOSTED_WEB_BASE_URL` is the canonical hosted-web public base URL
- on Vercel, when neither explicit hosted public-base env is set, `apps/web`
  falls back to `VERCEL_PROJECT_PRODUCTION_URL`
- `DEVICE_SYNC_PUBLIC_BASE_URL` overrides the provider-facing callback and
  webhook base for hosted device sync; when unset, `apps/web` derives that base
  as `<canonical hosted public origin>/api/device-sync`

Hosted public-base constraints:

- `HOSTED_ONBOARDING_PUBLIC_BASE_URL`, `HOSTED_WEB_BASE_URL`, and the
  `VERCEL_PROJECT_PRODUCTION_URL` fallback are origin-only values. Do not set
  them to subpaths such as `https://example.test/app`.
- `DEVICE_SYNC_PUBLIC_BASE_URL` remains the one explicit callback-base override
  that may include its `/api/device-sync` path because that route base is part
  of the device-sync provider contract.

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
- `apps/web` also encrypts hosted mailbox payloads with the
  `HOSTED_WAKE_ENCRYPTION_*` key lane, while member private fields remain on the
  web-only `HOSTED_WEB_ENCRYPTION_*` lane

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
There is no unauthenticated development-user fallback; local development must
exercise the same signed assertion contract.

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
authorization, device-sync web ownership models, the anonymized hosted
assistant-runtime issue sink, canonical hosted mailbox rows, hosted workspace
checkpoints, and hosted runtime logs/status.
This branch is a greenfield hosted-runtime cutover. If you have an older local
database from the superseded run/ingress/cursor chain, reset it before
reapplying migrations.

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
- Hosted local cross-app startup probes `GET /api/internal/health` instead of
  the homepage so E2E readiness depends on the web process being alive, not on
  landing-page-only imports.
- `apps/web/prisma.config.ts` reads `DATABASE_URL` from the process environment only.
- `pnpm --dir apps/web dev` keeps interactive Next dev artifacts under
  `apps/web/.next-dev`.
- `pnpm --dir apps/web build` and `pnpm --dir apps/web start` use `apps/web/.next`.
- Treat `apps/web/.next`, `apps/web/.next-dev`, and `apps/web/.next-smoke` as
  generated local artifacts that must stay out of commits and raw source bundles.
- Hosted wake repair, usage metering, and Stripe recovery accept only Vercel
  cron bearer auth via `CRON_SECRET`.
- Hosted Stripe reconciliation now commits local billing facts plus inline
  `member.activated` hosted mailbox input first, then performs activation-path
  managed-user crypto provisioning.

## Main routes

Hosted settings-authenticated wearable routes:

- `GET /api/settings/device-sync`
- `GET /api/settings/device-sync/connections/:connectionId/status`
- `POST /api/settings/device-sync/providers/:provider/connect`
- `POST /api/settings/device-sync/connections/:connectionId/disconnect`
- `POST /api/settings/email/sync`

Assertion-authenticated browser-to-agent bridge routes:

- `POST /api/device-sync/agents/pair`

Public provider-facing routes:

- `GET /api/device-sync/oauth/:provider/callback`
- `POST /api/device-sync/webhooks/:provider`
- `GET /api/device-sync/webhooks/oura`
- `GET /api/device-sync/webhooks/strava`
- `POST /api/hosted-onboarding/linq/webhook`
- `POST /api/hosted-onboarding/telegram/webhook`

Local-agent routes:

- `GET /api/device-sync/agent/signals`
- `POST /api/device-sync/agent/connections/:connectionId/export-token-bundle`
- `POST /api/device-sync/agent/connections/:connectionId/refresh-token-bundle`
- `POST /api/device-sync/agent/connections/:connectionId/local-heartbeat`

Internal hosted maintenance and Cloudflare callback routes:

- `POST /api/internal/device-sync/providers/:provider/connect-link`
- `POST /api/internal/device-sync/runtime/snapshot`
- `POST /api/internal/device-sync/runtime/apply`
- `GET /api/internal/hosted-execution/usage/cron`
- `POST /api/internal/hosted-execution/usage/record`
- `POST /api/internal/hosted-mailbox/fetch`
- `POST /api/internal/hosted-mailbox/payload/fetch`
- `POST /api/internal/hosted-mailbox/email-ingress`
- `GET /api/internal/hosted-runtime/status`
- `POST /api/internal/hosted-runtime/log`
- `GET /api/internal/hosted-workspace`
- `POST /api/internal/hosted-workspace/checkpoint`
- `GET /api/internal/hosted-onboarding/stripe/cron`

The old staged-payload and deleted import completion/release callback routes
are gone. Cloudflare no longer round-trips through broad mirror CRUD routes,
deleted sharing CRUD, or an outbox drain route. It still uses narrow signed
hosted-web callbacks for execution-time device-sync runtime snapshot/apply,
device connect-link starts, hosted vault-sync import payload reads, direct
hosted usage recording, and mailbox/workspace runtime status plus log callbacks.

## Hosted onboarding routes

Hosted onboarding surfaces:

- `GET /`
- `GET /join/:inviteCode`
- `GET /join/:inviteCode/success`
- `GET /join/:inviteCode/cancel`
- `GET /api/hosted-onboarding/invites/:inviteCode/status`
- `POST /api/hosted-onboarding/invites/:inviteCode/send-code`
- `POST /api/hosted-onboarding/invites/:inviteCode/send-code/confirm`
- `POST /api/hosted-onboarding/invites/:inviteCode/send-code/abort`
- `POST /api/hosted-onboarding/privy/complete`
- `POST /api/hosted-onboarding/billing/checkout`
- `GET /api/hosted-onboarding/billing/success`
- `GET|POST /api/hosted-onboarding/linq/webhook`
- `POST /api/hosted-onboarding/stripe/webhook`

The onboarding lane is intentionally thin:

- Linq or the public landing page can start phone-bound signup.
- Privy remains the browser auth boundary for hosted onboarding.
- Stripe Checkout is subscription-only and `invoice.paid` remains the only
  positive entitlement source.
- Hosted webhook receipts are retry journals for receipt-local side effects,
  not a second execution lifecycle authority.
- Cloudflare-bound execution from onboarding, hosted vault-sync imports, and
  hosted device-sync trigger paths always appends canonical hosted mailbox
  input first.
- Verified email sync updates canonical hosted email-authorization facts in web
  storage; it does not write hosted execution env.

Current hosted billing assumptions:

- Hosted checkout is always Stripe subscription mode.
- The launch tier is sold as one Stripe product with separate monthly and annual recurring prices.
- `invoice.paid` is the only positive activation source.
- `checkout.session.completed` and `customer.subscription.*` do not grant access.
- Chargebacks, disputes, and refunds suspend hosted access pending manual review.
