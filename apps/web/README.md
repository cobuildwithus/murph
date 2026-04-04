# @murphai/hosted-web

Hosted integration control plane for Vercel deployments.

`apps/web` is the hosted integration control plane for OAuth callbacks, webhooks, token escrow, sparse Linq routing state, and sparse local-agent APIs.

## Core responsibilities

- Garmin, WHOOP, and Oura OAuth start/callback flows
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

- `GARMIN_CLIENT_ID`
- `GARMIN_CLIENT_SECRET`
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
- `HOSTED_WEB_BASE_URL` as an optional fallback canonical public base URL for hosted-web links when the explicit hosted public-base envs are unset
- `OURA_WEBHOOK_VERIFICATION_TOKEN`
- `HOSTED_SHARE_INTERNAL_TOKENS` for server-to-server share-link issuance from the assistant or other trusted callers; the first token is used for outbound calls and any configured token is accepted inbound during rotation

On Vercel, the hosted web app now falls back to `VERCEL_PROJECT_PRODUCTION_URL` for the canonical public origin when the explicit hosted public-base envs are unset. Explicit envs still win, and you should keep setting them if you need a non-default path or additional allowed origins.

Hosted onboarding extras:

- `HOSTED_ONBOARDING_PUBLIC_BASE_URL`
- `HOSTED_ONBOARDING_ENCRYPTION_KEY`
- `HOSTED_ONBOARDING_ENCRYPTION_KEY_VERSION`
- `HOSTED_ONBOARDING_ENCRYPTION_KEYRING_JSON`
- `HOSTED_CONTACT_PRIVACY_KEY`
- `HOSTED_ONBOARDING_SIGNUP_PHONE_NUMBER` to show a public `Text to start` CTA on `/`
- `NEXT_PUBLIC_PRIVY_APP_ID`
- `NEXT_PUBLIC_PRIVY_CLIENT_ID` if you want the hosted web app to select a specific Privy web client per environment
- `PRIVY_CUSTOM_AUTH_DOMAIN` or `NEXT_PUBLIC_PRIVY_CUSTOM_AUTH_DOMAIN` when Privy uses a custom auth host such as `https://privy.example.com`; `apps/web` uses this to extend the CSP `connect-src` and `frame-src` allowlists for Privy's browser SDK
- `PRIVY_BASE_DOMAIN` or `NEXT_PUBLIC_PRIVY_BASE_DOMAIN` as an optional fallback when the Privy custom host follows the `privy.<base-domain>` pattern
- `PRIVY_VERIFICATION_KEY`
- enable Privy email login/linking in the dashboard so `/settings` can verify account email addresses
- enable Privy identity tokens in the dashboard under `User management > Authentication > Advanced`
- enable Privy access + identity tokens so hosted browser requests can authenticate API calls with bearer + identity-token headers
- `HOSTED_ONBOARDING_INVITE_TTL_HOURS`
- `HOSTED_ONBOARDING_STRIPE_BILLING_MODE`
- `HOSTED_ONBOARDING_STRIPE_PRICE_ID`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `LINQ_API_TOKEN`
- `LINQ_API_BASE_URL`
- `HOSTED_EXECUTION_DISPATCH_URL`
- `HOSTED_EXECUTION_SIGNING_SECRET`
- `HOSTED_EXECUTION_DISPATCH_TIMEOUT_MS`
- `HOSTED_EXECUTION_CONTROL_TOKENS` so `/settings` can sync a verified email into hosted user env and trigger a hosted run
- `HOSTED_EXECUTION_SCHEDULER_TOKENS` for authenticated scheduler callers that trigger `/api/internal/hosted-execution/outbox/cron` and `/api/internal/hosted-execution/usage/cron`

Optional hosted AI usage metering:

- `HOSTED_AI_USAGE_STRIPE_METER_EVENT_NAME`
- `HOSTED_AI_USAGE_STRIPE_BATCH_LIMIT`

When you set `DEVICE_SYNC_PUBLIC_BASE_URL`, point it at the stable production project domain or a custom domain for the hosted app, for example `https://your-project.vercel.app/api/device-sync`. Do not use an ephemeral preview deployment URL as the long-lived provider callback or webhook base.

### Vercel setup

Set these under `Settings -> Environment Variables` in the Vercel project that deploys `apps/web`. Production is the minimum. Only set Preview if you also have matching preview peers and secrets instead of pointing preview deploys at production control planes.

- `HOSTED_EXECUTION_SIGNING_SECRET`: generate a strong random secret and use the exact same value in Vercel and the Cloudflare hosted-execution worker. `apps/web` signs dispatch payloads with it and Cloudflare verifies them.
- `HOSTED_EXECUTION_CONTROL_TOKENS`: generate a distinct comma-separated bearer-token set and use the same value in Vercel and the Cloudflare hosted-execution worker. `apps/web` uses the first token for outbound worker control calls and accepts any configured token inbound.
- `HOSTED_EXECUTION_INTERNAL_TOKENS`: generate a distinct comma-separated bearer-token set for trusted hosted execution maintenance routes that still use bearer auth. Hosted web accepts any configured token inbound.
- `HOSTED_EXECUTION_SCHEDULER_TOKENS`: generate a distinct comma-separated bearer-token set for the authenticated scheduler that calls the hosted cron routes.
- `HOSTED_SHARE_INTERNAL_TOKENS`: generate a distinct comma-separated bearer-token set for trusted server-to-server hosted share routes.
- `DEVICE_SYNC_TRUSTED_USER_SIGNING_SECRET`: generate a distinct strong random secret and use the same value in Vercel plus whichever trusted auth proxy or middleware signs the hosted user assertion headers. `apps/web` verifies that signature before trusting the lower-level assertion-backed device-sync bridge routes.

If you prefer the CLI, Vercel's current docs cover `vercel env add`, `vercel env update`, and `vercel env pull` for managing these project environment variables.

Development fallback only:

- `DEVICE_SYNC_DEV_USER_ID`
- `DEVICE_SYNC_DEV_USER_EMAIL`
- `DEVICE_SYNC_DEV_USER_NAME`

## Browser auth contract

The lower-level assertion-backed device-sync bridge routes, such as `POST /api/device-sync/agents/pair`, trust a front-end/auth proxy only when it attaches:

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
- Treat `DATABASE_URL`, `DEVICE_SYNC_ENCRYPTION_KEY`, `GARMIN_CLIENT_SECRET`, `WHOOP_CLIENT_SECRET`, `OURA_CLIENT_SECRET`, and `OURA_WEBHOOK_VERIFICATION_TOKEN` as rotation-required if a real hosted `.env` or deploy secret was ever exposed.
- Treat a leaked raw clone/archive that included the local hosted `.env` the same way as a direct secret exposure.
- Rotate `DEVICE_SYNC_ENCRYPTION_KEY_VERSION` whenever you rotate `DEVICE_SYNC_ENCRYPTION_KEY`, but do not assume the version field alone gives backwards-compatible reads. The current hosted control plane loads one active key at runtime.
- Existing `device_connection_secret` rows encrypted with the previous key will not decrypt after a cutover to a new key unless you re-encrypt them first while the old key is still available. If you cannot do that safely, invalidate the escrowed token rows and force the affected Garmin/WHOOP/Oura connections through re-authorization instead.

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
- Hosted execution outbox draining and hosted AI usage metering now require an authenticated external scheduler that sends `Authorization: Bearer <HOSTED_EXECUTION_SCHEDULER_TOKENS entry>` to the internal cron routes.
- Hosted Stripe reconciliation still runs on its own deployment scheduler; do not assume `apps/web` ships a checked-in native Vercel cron config for it.

## Main routes

Hosted settings-authenticated wearable routes:

- `GET /api/settings/device-sync`
- `GET /api/settings/device-sync/connections/:connectionId/status`
- `POST /api/settings/device-sync/providers/:provider/connect`
- `POST /api/settings/device-sync/connections/:connectionId/disconnect`

These are the only browser-facing wearable-management routes. They power the `/settings` wearable-sources card and use the hosted onboarding Privy bearer + identity-token contract so the browser can manage calm connect, reconnect, refresh, and disconnect flows without the separate signed browser-assertion headers required by the lower-level agent bridge.

Assertion-authenticated browser-to-agent bridge routes:

- `POST /api/device-sync/agents/pair`
- `GET /api/linq/bindings`
- `POST /api/linq/bindings`

Hosted settings device-sync responses intentionally omit `externalAccountId`, and the `id` returned from settings connection routes is an opaque handle rather than the raw hosted `device_connection.id` value.

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

Hosted execution maintenance routes:

- `GET /api/internal/hosted-execution/usage/cron`

Cloudflare no longer round-trips through hosted-web runtime snapshot/apply routes in the hot path. Device-sync hydration and usage buffering now stay on the Cloudflare side during execution, the worker later imports buffered usage through the internal hosted-web usage route after commit/finalize, and the optional usage cron sends total-token meter events to Stripe while skipping member-supplied API-key runs.

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
- `GET|POST /api/hosted-onboarding/linq/webhook`
- `POST /api/hosted-onboarding/stripe/webhook`
- `GET /share/:shareCode`
- `POST /api/hosted-share/:shareCode/accept`
- `POST /api/hosted-share/internal/create`

The onboarding lane is intentionally thin:

- a Linq webhook can text back a hosted join link to a new phone number or a trigger phrase like "I want to get healthy"
- the public landing page can start the same flow with Privy SMS verification
- the invite page binds the verified phone number to a hosted member row in Postgres
- Privy handles phone OTP, the browser ensures the embedded wallet exists before continuation, the browser gates continuation off Privy's SDK user state instead of parsing JWTs itself, and the backend locally verifies Privy identity tokens sent by the client instead of minting a separate hosted session cookie
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
- subscription cancellation, pause, unpaid, refund, and dispute paths revoke hosted access by suspending the member until manual recovery or a newer fresh Stripe success event restores entitlement

Current RevNet MVP assumptions:

- RevNet issuance is only enabled when `HOSTED_ONBOARDING_STRIPE_BILLING_MODE=subscription`.
- The configured treasury key must already control a wallet funded on the target chain.
- Stripe webhook ingress no longer activates access inline; the queued reconciler may submit RevNet from `invoice.paid`, and RevNet-backed subscription activation now waits for confirmed issuance rather than raw `invoice.paid`.
- Chargebacks, disputes, and refunds are not clawed back onchain in this MVP; instead the Stripe webhook suspends hosted access and halts future activation or RevNet issuance until manual review.
