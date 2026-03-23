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
- `HEALTHYBOB_DEVICE_SYNC_ENCRYPTION_KEY`
- `HEALTHYBOB_DEVICE_SYNC_ENCRYPTION_KEY_VERSION`
- `HEALTHYBOB_WHOOP_CLIENT_ID`
- `HEALTHYBOB_WHOOP_CLIENT_SECRET`
- `HEALTHYBOB_OURA_CLIENT_ID`
- `HEALTHYBOB_OURA_CLIENT_SECRET`

Optional but recommended:

- `HEALTHYBOB_DEVICE_SYNC_PUBLIC_BASE_URL`
- `HEALTHYBOB_DEVICE_SYNC_ALLOWED_RETURN_ORIGINS`
- `HEALTHYBOB_DEVICE_SYNC_TRUSTED_USER_ID_HEADER`
- `HEALTHYBOB_DEVICE_SYNC_TRUSTED_USER_EMAIL_HEADER`
- `HEALTHYBOB_DEVICE_SYNC_TRUSTED_USER_NAME_HEADER`
- `HEALTHYBOB_OURA_WEBHOOK_VERIFICATION_TOKEN`

Development fallback only:

- `HEALTHYBOB_DEVICE_SYNC_DEV_USER_ID`
- `HEALTHYBOB_DEVICE_SYNC_DEV_USER_EMAIL`
- `HEALTHYBOB_DEVICE_SYNC_DEV_USER_NAME`

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
- `GET|POST /api/device-sync/providers/:provider/connect`
- `GET|POST /api/device-sync/oauth/:provider/start`
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
