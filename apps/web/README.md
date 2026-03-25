# @healthybob/hosted-web

Hosted device-sync control plane for Vercel deployments.

This app is intentionally separate from `packages/web`:

- `packages/web` stays local-only and reads a local Healthy Bob vault.
- `apps/web` is the hosted integration control plane for OAuth callbacks, webhooks, token escrow, and sparse local-agent APIs.

## Core responsibilities

- WHOOP and Oura OAuth start/callback flows
- WHOOP and Oura webhook intake
- per-user connection ownership mapping
- encrypted provider-token escrow
- local-agent pairing plus sparse signal/token routes

## Non-goals

- canonical health-data storage
- vault imports
- proxying provider health payloads through the hosted app

## Key environment variables

See `.env.example` for a working template.

Required:

- `DATABASE_URL`
- `DEVICE_SYNC_ENCRYPTION_KEY`
- `DEVICE_SYNC_ENCRYPTION_KEY_VERSION`
- `WHOOP_CLIENT_ID`
- `WHOOP_CLIENT_SECRET`
- `OURA_CLIENT_ID`
- `OURA_CLIENT_SECRET`

Optional but recommended:

- `DEVICE_SYNC_PUBLIC_BASE_URL`
- `DEVICE_SYNC_ALLOWED_MUTATION_ORIGINS`
- `DEVICE_SYNC_ALLOWED_RETURN_ORIGINS`
- `DEVICE_SYNC_TRUSTED_USER_ASSERTION_HEADER`
- `DEVICE_SYNC_TRUSTED_USER_SIGNATURE_HEADER`
- `DEVICE_SYNC_TRUSTED_USER_SIGNING_SECRET`
- `OURA_WEBHOOK_VERIFICATION_TOKEN`

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
- A raw filesystem archive of a repo clone is still an exposure when ignored local `apps/web/.env` or `.next` output exists, even when git has no tracked secret diff. Use the guarded `pnpm zip:src` / `scripts/package-audit-context.sh` flow for source sharing instead of archiving the clone directly.
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

Public provider-facing routes:

- `GET /api/device-sync/oauth/:provider/callback`
- `POST /api/device-sync/webhooks/:provider`
- `GET /api/device-sync/webhooks/oura` for Oura webhook verification challenges

Local-agent routes:

- `GET /api/device-sync/agent/signals`
- `POST /api/device-sync/agent/connections/:connectionId/export-token-bundle`
- `POST /api/device-sync/agent/connections/:connectionId/refresh-token-bundle`
- `POST /api/device-sync/agent/connections/:connectionId/local-heartbeat`
