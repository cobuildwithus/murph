# @healthybob/device-syncd

Standalone device sync runtime for HealthyBob.

What it does:
- owns OAuth connection state
- stores encrypted provider tokens in SQLite under `.runtime/device-syncd.sqlite`
- accepts provider webhooks
- runs background backfill and reconcile jobs
- imports provider snapshots through `@healthybob/importers`

Current provider:
- WHOOP

## Environment

Required:
- `HEALTHYBOB_VAULT_ROOT`
- `HEALTHYBOB_DEVICE_SYNC_PUBLIC_BASE_URL`
- `HEALTHYBOB_DEVICE_SYNC_SECRET`
- `HEALTHYBOB_WHOOP_CLIENT_ID`
- `HEALTHYBOB_WHOOP_CLIENT_SECRET`

Common optional settings:
- `HEALTHYBOB_DEVICE_SYNC_PORT`
- `HEALTHYBOB_DEVICE_SYNC_HOST`
- `HEALTHYBOB_DEVICE_SYNC_STATE_DB_PATH`
- `HEALTHYBOB_DEVICE_SYNC_WORKER_POLL_MS`
- `HEALTHYBOB_DEVICE_SYNC_WORKER_BATCH_SIZE`
- `HEALTHYBOB_DEVICE_SYNC_SCHEDULER_POLL_MS`
- `HEALTHYBOB_WHOOP_BACKFILL_DAYS`
- `HEALTHYBOB_WHOOP_RECONCILE_DAYS`
- `HEALTHYBOB_WHOOP_RECONCILE_INTERVAL_MS`

## Run

```bash
node packages/device-syncd/dist/bin.js
```

## HTTP routes

- `GET /healthz`
- `GET /providers`
- `GET /connect/:provider?returnTo=/settings/devices`
- `POST /providers/:provider/connect`
- `GET /oauth/:provider/callback`
- `POST /webhooks/:provider`
- `GET /accounts`
- `GET /accounts/:id`
- `POST /accounts/:id/reconcile`
- `POST /accounts/:id/disconnect`
