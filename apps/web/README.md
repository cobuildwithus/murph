# @murphai/hosted-web

Hosted integration control plane for Vercel deployments.

This app is intentionally separate from `packages/local-web`:

- `packages/local-web` stays local-only and reads a local Murph vault.
- `apps/web` is the hosted integration control plane for OAuth callbacks, webhooks, token escrow, sparse Linq routing state, and sparse local-agent APIs.

## Core responsibilities

- WHOOP and Oura OAuth start/callback flows
- WHOOP and Oura webhook intake
- hosted Linq webhook ingress plus sparse chat routing state
- per-user connection ownership mapping
- encrypted provider-token escrow
- durable `execution_outbox` records for Cloudflare-bound hosted execution intents
- immutable hosted AI usage rows imported after successful hosted commits, with optional downstream Stripe token metering
- local-agent pairing plus sparse signal/token routes for hosted integrations
- internal runner snapshot/apply APIs for hosted device-sync state hydration and reconciliation

## Non-goals

- canonical health-data storage
- canonical inbox-capture storage
- vault imports
- proxying provider health payloads through the hosted app
- storing canonical Linq chat captures in Postgres
- storing raw provider webhook bodies or provider tokens inside hosted device-sync signal payloads

## Key environment variables

See `.env.example` for a working template.

Required:

- `DATABASE_URL`
- `DEVICE_SYNC_ENCRYPTION_KEY`
- `DEVICE_SYNC_ENCRYPTION_KEY_VERSION`

Required for the hosted device-sync lane:

- `WHOOP_CLIENT_ID`
- `WHOOP_CLIENT_SECRET`
- `OURA_CLIENT_ID`
- `OURA_CLIENT_SECRET`

Required for hosted Linq ingress:

- `LINQ_WEBHOOK_SECRET`

Optional but recommended:

- `DEVICE_SYNC_PUBLIC_BASE_URL`
- `DEVICE_SYNC_ALLOWED_MUTATION_ORIGINS`
- `DEVICE_SYNC_ALLOWED_RETURN_ORIGINS`
- `DEVICE_SYNC_TRUSTED_USER_ASSERTION_HEADER`
- `DEVICE_SYNC_TRUSTED_USER_SIGNATURE_HEADER`
- `DEVICE_SYNC_TRUSTED_USER_SIGNING_SECRET`
- `HOSTED_WEB_BASE_URL` as the shared hosted control-plane base for internal device-sync, share, and usage routes unless a specific route needs its own host override
- `OURA_WEBHOOK_VERIFICATION_TOKEN`
- `HOSTED_SHARE_INTERNAL_TOKEN` for server-to-server share-link issuance from the assistant or other trusted callers

On Vercel, the hosted web app now falls back to `VERCEL_PROJECT_PRODUCTION_URL` for the canonical public origin when the explicit hosted public-base envs are unset. Explicit envs still win, and you should keep setting them if you need a non-default path or additional allowed origins.

Hosted onboarding extras:

- `HOSTED_ONBOARDING_PUBLIC_BASE_URL`
- `HOSTED_ONBOARDING_SIGNUP_PHONE_NUMBER` to show a public `Text to start` CTA on `/`
- `NEXT_PUBLIC_PRIVY_APP_ID`
- `NEXT_PUBLIC_PRIVY_CLIENT_ID` if you want the hosted web app to select a specific Privy web client per environment
- `PRIVY_VERIFICATION_KEY`
- enable Privy email login/linking in the dashboard so `/settings` can verify account email addresses
- enable Privy identity tokens in the dashboard under `User management > Authentication > Advanced`
- set a Privy base domain so the hosted app receives the `privy-id-token` HttpOnly cookie
- `HOSTED_ONBOARDING_INVITE_TTL_HOURS`
- `HOSTED_ONBOARDING_SESSION_TTL_DAYS`
- `HOSTED_ONBOARDING_SESSION_COOKIE_NAME`
- `HOSTED_ONBOARDING_STRIPE_BILLING_MODE`
- `HOSTED_ONBOARDING_STRIPE_PRICE_ID`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `LINQ_API_TOKEN`
- `LINQ_API_BASE_URL`
- `HOSTED_EXECUTION_DISPATCH_URL`
- `HOSTED_EXECUTION_SIGNING_SECRET`
- `HOSTED_EXECUTION_DISPATCH_TIMEOUT_MS`
- `HOSTED_EXECUTION_CONTROL_TOKEN` so `/settings` can sync a verified email into hosted user env and trigger a hosted run
- `HOSTED_EXECUTION_INTERNAL_TOKEN` so the Cloudflare runner can call hosted web internal routes
- `CRON_SECRET` so the deployed Vercel cron can authenticate `/api/internal/hosted-execution/outbox/cron`

Optional hosted AI usage metering:

- `HOSTED_AI_USAGE_STRIPE_METER_EVENT_NAME`
- `HOSTED_AI_USAGE_STRIPE_BATCH_LIMIT`

When you set `DEVICE_SYNC_PUBLIC_BASE_URL`, point it at the stable production project domain or a custom domain for the hosted app, for example `https://your-project.vercel.app/api/device-sync`. Do not use an ephemeral preview deployment URL as the long-lived provider callback or webhook base.

### Vercel setup

Set these under `Settings -> Environment Variables` in the Vercel project that deploys `apps/web`. Production is the minimum. Only set Preview if you also have matching preview peers and secrets instead of pointing preview deploys at production control planes.

- `HOSTED_EXECUTION_SIGNING_SECRET`: generate a strong random secret and use the exact same value in Vercel and the Cloudflare hosted-execution worker. `apps/web` signs dispatch payloads with it and Cloudflare verifies them.
- `HOSTED_EXECUTION_CONTROL_TOKEN`: generate a distinct strong random bearer token and use the same value in Vercel and the Cloudflare hosted-execution worker. `apps/web` uses it to call the worker's operator/internal control routes.
- `HOSTED_EXECUTION_INTERNAL_TOKEN`: generate a distinct strong random bearer token and use the same value in Vercel and the Cloudflare runner environment. The runner uses it when calling `apps/web` internal hosted-execution and device-sync routes.
- `CRON_SECRET`: generate a distinct strong random bearer token and set it in Vercel for `apps/web`. Vercel cron requests send `Authorization: Bearer <CRON_SECRET>` to the cron endpoints declared in `vercel.json`.
- `DEVICE_SYNC_TRUSTED_USER_SIGNING_SECRET`: generate a distinct strong random secret and use the same value in Vercel plus whichever trusted auth proxy or middleware signs the hosted user assertion headers. `apps/web` verifies that signature before trusting browser-authenticated device-sync requests.

If you prefer the CLI, Vercel's current docs cover `vercel env add`, `vercel env update`, and `vercel env pull` for managing these project environment variables.

Development fallback only:

- `DEVICE_SYNC_DEV_USER_ID`
- `DEVICE_SYNC_DEV_USER_EMAIL`
- `DEVICE_SYNC_DEV_USER_NAME`

## Browser auth contract

Hosted browser routes trust a front-end/auth proxy only when it attaches:

- a base64url JSON assertion in `DEVICE_SYNC_TRUSTED_USER_ASSERTION_HEADER`
- an HMAC signature for that exact assertion in `DEVICE_SYNC_TRUSTED_USER_SIGNATURE_HEADER`

The signed assertion must include the hosted user claims plus:

- `iat` and `exp` with a lifetime of at most 5 minutes
- a strong random `nonce`
- `aud`, `method`, `path`, and `origin` bindings for the current request

The hosted control plane consumes each assertion nonce once, so replayed assertions fail even if the user id/email/name tuple is unchanged.

## Secret hygiene and rotation

- Keep real hosted values in an untracked local `.env` for development or in the platform secret manager for deployed environments. The committed `.env.example` file must stay placeholder-only.
- A raw filesystem archive of a repo clone is still an exposure when ignored local `apps/web/.env`, `.next`, `.next-dev`, or `.next-smoke` output exists, even when git has no tracked secret diff. Use the guarded `pnpm zip:src` / `scripts/package-audit-context.sh` flow for source sharing instead of archiving the clone directly; that path stages git-visible files, now includes the tracked `config/workspace-source-resolution.ts` helper, and filters blocked local residue from the bundle.
- Treat `DATABASE_URL`, `DEVICE_SYNC_ENCRYPTION_KEY`, `WHOOP_CLIENT_SECRET`, `OURA_CLIENT_SECRET`, and `OURA_WEBHOOK_VERIFICATION_TOKEN` as rotation-required if a real hosted `.env` or deploy secret was ever exposed.
- Treat a leaked raw clone/archive that included the local hosted `.env` the same way as a direct secret exposure.
- Rotate `DEVICE_SYNC_ENCRYPTION_KEY_VERSION` whenever you rotate `DEVICE_SYNC_ENCRYPTION_KEY`, but do not assume the version field alone gives backwards-compatible reads. The current hosted control plane loads one active key at runtime.
- Existing `device_connection_secret` rows encrypted with the previous key will not decrypt after a cutover to a new key unless you re-encrypt them first while the old key is still available. If you cannot do that safely, invalidate the escrowed token rows and force the affected WHOOP/Oura connections through re-authorization instead.

## Prisma

Generate the client and apply migrations with Prisma:

```bash
pnpm --dir apps/web prisma:generate
pnpm --dir apps/web prisma:migrate:deploy
```

## Local verification

- `pnpm --dir apps/web lint` runs the explicit ESLint CLI with `eslint-config-next`.
- `pnpm --dir apps/web dev` now keeps interactive Next dev artifacts under `apps/web/.next-dev`.
- The Next 16 Turbopack filesystem cache is disabled by default for local `next dev` in this repo; set `MURPH_NEXT_DEV_FILESYSTEM_CACHE=1` only when you explicitly want on-disk dev cache reuse.
- `pnpm --dir apps/web build` and `pnpm --dir apps/web start` keep using `apps/web/.next`.
- `pnpm --dir apps/web test` is the fast hosted-web Vitest lane. `pnpm --dir apps/web verify` adds the app-local typecheck, lint, a cold-boot `next dev` smoke under `apps/web/.next-smoke`, and the production build so the heavier preflight checks stay out of the default unit-test loop.
- Treat `apps/web/.next`, `apps/web/.next-dev`, and `apps/web/.next-smoke` as generated local artifacts that must stay out of commits and raw source bundles.
- Hosted execution outbox draining is wired through `apps/web/vercel.json` as a 1-minute Vercel cron targeting `/api/internal/hosted-execution/outbox/cron`.
- Hosted AI usage metering is wired through `apps/web/vercel.json` as a 5-minute Vercel cron targeting `/api/internal/hosted-execution/usage/cron`.
- Hosted Stripe reconciliation is wired through the same `apps/web/vercel.json` file as a 1-minute Vercel cron targeting `/api/internal/hosted-onboarding/stripe/cron`.
- Production deployments need `CRON_SECRET` set so Vercel's cron `Authorization: Bearer ...` header can authenticate both internal cron routes.

## Main routes

Browser-authenticated routes:

- `GET /api/device-sync/connections`
- `GET /api/device-sync/connections/:connectionId/status`
- `POST /api/device-sync/connections/:connectionId/disconnect`
- `POST /api/device-sync/providers/:provider/connect`
- `POST /api/device-sync/agents/pair`
- `GET /api/linq/bindings`
- `POST /api/linq/bindings`

Hosted browser-facing device-sync responses intentionally omit `externalAccountId`, and the `id` returned from browser-facing connection routes is an opaque handle rather than the raw hosted `device_connection.id` value.

Public provider-facing routes:

- `GET /api/device-sync/oauth/:provider/callback`
- `POST /api/device-sync/webhooks/:provider`
- `GET /api/device-sync/webhooks/oura` for Oura webhook verification challenges
- `GET /api/linq/webhook`
- `POST /api/linq/webhook`

Local-agent routes:

- `GET /api/device-sync/agent/signals`
- `POST /api/device-sync/agent/connections/:connectionId/export-token-bundle`
- `POST /api/device-sync/agent/connections/:connectionId/refresh-token-bundle`
- `POST /api/device-sync/agent/connections/:connectionId/local-heartbeat`
- `POST /api/linq/agents/pair`
- `GET /api/linq/agent/events`

Hosted device-sync agent signals stay sparse by design:

- webhook wake hints expose only sparse metadata plus normalized job hints and reconcile metadata that the hosted runner can safely replay
- hosted Postgres/API state must not persist or return raw provider webhook payload blobs or provider tokens

Hosted internal runner routes:

- `POST /api/internal/device-sync/runtime/snapshot`
- `POST /api/internal/device-sync/runtime/apply`
- `POST /api/internal/hosted-execution/usage/record`
- `GET /api/internal/hosted-execution/usage/cron`

These routes are internal-only server-to-server seams for the Cloudflare runner. They let the runner hydrate escrowed device-sync connections before a one-shot pass and reconcile status/token changes back into Postgres afterward.
The device-sync runtime routes and the hosted AI usage record route now require both the internal bearer token and the trusted worker-injected `x-hosted-execution-user-id` header. The hosted AI usage record route rejects any usage row whose `memberId` does not match that bound user, then imports the immutable per-attempt usage rows after a hosted commit succeeds. The optional usage cron later sends total-token meter events to Stripe while skipping member-supplied API-key runs.

## Hosted onboarding routes

This repo now also includes a hosted onboarding lane for phone-bound invites and public signup:

- `GET /`
- `GET /join/:inviteCode`
- route-local loading UI at `app/join/[inviteCode]/loading.tsx`
- `GET /join/:inviteCode/success`
- `GET /join/:inviteCode/cancel`
- `GET /share/:shareCode`
- route-local loading UI at `app/share/[shareCode]/loading.tsx`
- `GET /api/hosted-onboarding/invites/:inviteCode/status`
- `POST /api/hosted-onboarding/privy/complete`
- `POST /api/hosted-onboarding/billing/checkout`
- `POST /api/hosted-onboarding/session/logout`
- `GET|POST /api/hosted-onboarding/linq/webhook`
- `POST /api/hosted-onboarding/stripe/webhook`
- `GET /share/:shareCode`
- `POST /api/hosted-share/:shareCode/accept`
- `POST /api/hosted-share/internal/create`

The onboarding lane is intentionally thin:

- a Linq webhook can text back a hosted join link to a new phone number or a trigger phrase like "I want to get healthy"
- the public landing page can start the same flow with Privy SMS verification
- the invite page binds the verified phone number to a hosted member row in Postgres
- Privy handles phone OTP, auto-creates the embedded wallet for users who do not already have one, the browser gates continuation off Privy's SDK user state instead of parsing JWTs itself, and the backend locally verifies the Privy identity token from the `privy-id-token` cookie before creating the hosted session cookie
- checkout uses Stripe Checkout so Apple Pay can appear directly inside the hosted payment handoff when available in Safari, but the hosted app now reuses one open checkout attempt per member and sends Stripe idempotency keys for customer/session creation so retries do not mint parallel customers or subscriptions
- Stripe webhook ingress now verifies and stores a durable Stripe fact quickly, then the hosted Stripe reconciler applies billing state, checkout completion/expiry, and optional RevNet work out of band instead of doing expensive API or chain work inline in the webhook request
- in subscription mode, `invoice.paid` is now the only positive Stripe entitlement source, `customer.subscription.*` only tracks negative or status transitions, and `checkout.session.completed` just completes the local checkout attempt plus attaches Stripe ids
- optional hosted RevNet issuance can submit an onchain payment during queued Stripe reconciliation after `invoice.paid`, using invoice-level Postgres idempotency plus stored tx hashes to prevent duplicate issuance and failing closed for operator repair if a tx broadcast succeeds but the write-back does not
- a bootstrap secret is generated and encrypted at rest now, leaving vault/key-management work for the next step
- hosted share links can now store an encrypted one-time share pack for foods, recipes, and supplement/protocol records, optionally issuing or reusing a phone-bound invite so `/join/:inviteCode?share=...` can import the shared bundle after activation
- once a member is active, hosted onboarding, hosted share acceptance, and hosted device-sync wakes write signed internal execution intents to the shared Postgres `execution_outbox` in the same transaction as their control-plane state changes instead of synchronously depending on `apps/cloudflare`
- a best-effort drain still runs after commit, but Cloudflare delivery retries and dedupe now converge through the outbox row instead of request/response coupling
- hosted onboarding webhook receipts still keep receipt-local side-effect markers for retry-safe Linq invite replies, persist the planned response plus queued side effects before any external send, and use a reclaimable processing lease so a retried Linq or Telegram webhook can resume abandoned work instead of being dropped as a duplicate
- the current hosted outward-effect lanes are now explicit: Cloudflare-bound execution uses `execution_outbox`, receipt-owned Linq or Telegram replies use the webhook receipt side-effect journal, queued Stripe facts use the hosted Stripe event reconciler, and RevNet issuance uses invoice-owned idempotency state
- Stripe customer/subscription/invoice entitlement writes now carry a latest-applied billing event marker so out-of-order webhook delivery cannot regress a later cancellation, pause, or unpaid state back to active
- subscription cancellation, pause, unpaid, refund, and dispute paths revoke hosted access by suspending the member and revoking live hosted sessions until manual recovery or a newer fresh Stripe success event restores entitlement

Current RevNet MVP assumptions:

- RevNet issuance is only enabled when `HOSTED_ONBOARDING_STRIPE_BILLING_MODE=subscription`.
- The configured treasury key must already control a wallet funded on the target chain.
- Stripe webhook ingress no longer activates access inline; the queued reconciler may submit RevNet from `invoice.paid`, and RevNet-backed subscription activation now waits for confirmed issuance rather than raw `invoice.paid`.
- Chargebacks, disputes, and refunds are not clawed back onchain in this MVP; instead the Stripe webhook suspends hosted access, revokes live hosted sessions, and halts future activation or RevNet issuance until manual review.
