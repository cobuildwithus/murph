# @healthybob/hosted-web

Hosted integration control plane for Vercel deployments.

This app is intentionally separate from `packages/web`:

- `packages/web` stays local-only and reads a local Healthy Bob vault.
- `apps/web` is the hosted integration control plane for OAuth callbacks, webhooks, token escrow, sparse Linq routing state, and sparse local-agent APIs.

## Core responsibilities

- WHOOP and Oura OAuth start/callback flows
- WHOOP and Oura webhook intake
- hosted Linq webhook ingress plus sparse chat routing state
- per-user connection ownership mapping
- encrypted provider-token escrow
- local-agent pairing plus sparse signal/token routes for hosted integrations

## Non-goals

- canonical health-data storage
- canonical inbox-capture storage
- vault imports
- proxying provider health payloads through the hosted app
- storing canonical Linq chat captures in Postgres

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
- `OURA_WEBHOOK_VERIFICATION_TOKEN`

Hosted onboarding extras:

- `HOSTED_ONBOARDING_PUBLIC_BASE_URL`
- `HOSTED_ONBOARDING_PASSKEY_ORIGIN`
- `HOSTED_ONBOARDING_PASSKEY_RP_ID`
- `HOSTED_ONBOARDING_PASSKEY_RP_NAME`
- `HOSTED_ONBOARDING_INVITE_TTL_HOURS`
- `HOSTED_ONBOARDING_SESSION_TTL_DAYS`
- `HOSTED_ONBOARDING_SESSION_COOKIE_NAME`
- `HOSTED_ONBOARDING_STRIPE_BILLING_MODE`
- `HOSTED_ONBOARDING_STRIPE_PRICE_ID`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `LINQ_API_TOKEN`
- `LINQ_API_BASE_URL`

When you set `DEVICE_SYNC_PUBLIC_BASE_URL`, point it at the stable production project domain or a custom domain for the hosted app, for example `https://your-project.vercel.app/api/device-sync`. Do not use an ephemeral preview deployment URL as the long-lived provider callback or webhook base.

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
- A raw filesystem archive of a repo clone is still an exposure when ignored local `apps/web/.env` or `.next` output exists, even when git has no tracked secret diff. Use the guarded `pnpm zip:src` / `scripts/package-audit-context.sh` flow for source sharing instead of archiving the clone directly; that path stages git-visible files and filters blocked local residue from the bundle.
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

## Main routes

Browser-authenticated routes:

- `GET /api/device-sync/connections`
- `GET /api/device-sync/connections/:connectionId/status`
- `POST /api/device-sync/connections/:connectionId/disconnect`
- `POST /api/device-sync/providers/:provider/connect`
- `POST /api/device-sync/oauth/:provider/start`
- `POST /api/device-sync/agents/pair`
- `GET /api/linq/bindings`
- `POST /api/linq/bindings`

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

## Hosted onboarding routes

This repo now also includes a first hosted onboarding lane for phone-bound invites:

- `GET /join/:inviteCode`
- `GET /join/:inviteCode/success`
- `GET /join/:inviteCode/cancel`
- `GET /api/hosted-onboarding/invites/:inviteCode/status`
- `POST /api/hosted-onboarding/passkeys/register/options`
- `POST /api/hosted-onboarding/passkeys/register/verify`
- `POST /api/hosted-onboarding/passkeys/authenticate/options`
- `POST /api/hosted-onboarding/passkeys/authenticate/verify`
- `POST /api/hosted-onboarding/billing/checkout`
- `POST /api/hosted-onboarding/session/logout`
- `GET|POST /api/hosted-onboarding/linq/webhook`
- `POST /api/hosted-onboarding/stripe/webhook`

The onboarding lane is intentionally thin:

- a Linq webhook can text back a hosted join link to a new phone number or a trigger phrase like "I want to get healthy"
- the invite page binds the phone number to a hosted member row in Postgres
- passkeys create/authenticate that hosted member without reusing the local-first browser auth model
- checkout uses Stripe Checkout so Apple Pay can appear directly inside the hosted payment handoff when available in Safari
- a bootstrap secret is generated and encrypted at rest now, leaving vault/key-management work for the next step
