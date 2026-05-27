# @murphai/assistantd

Workspace-private local assistant runtime control plane for Murph.

`assistantd` is the local daemon boundary for the personal assistant runtime. It keeps the canonical vault write surface in Murph core/CLI while giving the assistant runtime a single loopback-owned control plane for chat turns, session access, outbox draining, cron processing, automation scans, diagnostics, and status through `@murphai/assistant-engine`. The daemon composes neutral vault services from `@murphai/vault-usecases/vault-services` and inbox services from `@murphai/inbox-services`; canonical writes still terminate in `packages/core`. Daemon-triggered automation runs runtime maintenance, outbox draining, and preview inbox routing by default; callers must pass `allowCanonicalWrites: true` to `/automation/run-once` when they intentionally want the bound-vault automation pass to run auto-replies, cron jobs, and apply-mode inbox routing with canonical write-capable services.

Like `device-syncd`, the daemon binds the control plane to localhost by default and requires a bearer token for every control-plane request. It is meant to run one daemon per selected vault.

What it does:
- serves a localhost-only assistant control plane for local chat turns and runtime state inspection
- owns assistant session execution through one runtime authority per vault
- keeps assistant runtime state under `vault/.runtime/operations/assistant/**`, not in canonical vault files
- exposes status, session, outbox, cron, and automation control routes for local clients
- requires explicit `allowCanonicalWrites: true` before daemon-triggered automation can run auto-replies, cron jobs, or apply-mode inbox routing with canonical write-capable services
- exposes `@murphai/assistantd/client` as the loopback-only HTTP client surface for daemon-routed callers inside this workspace or bundled public tarballs
- lets the CLI operate as an HTTP client when `MURPH_ASSISTANTD_BASE_URL` and `MURPH_ASSISTANTD_CONTROL_TOKEN` are configured

What it does not do:
- replace Murph core as the canonical health-data write surface
- widen the trust boundary for hosted execution
- make assistant scratchpads canonical

## Environment

Required:
- `ASSISTANTD_VAULT_ROOT`
- `ASSISTANTD_CONTROL_TOKEN`

Optional:
- `ASSISTANTD_HOST` (defaults to `127.0.0.1`)
- `ASSISTANTD_PORT` (defaults to `50241`)

CLI client configuration:
- `MURPH_ASSISTANTD_BASE_URL`
- `MURPH_ASSISTANTD_CONTROL_TOKEN`

Startup env loading:
- `murph-assistantd` loads `.env.local` first and then `.env` from its launch cwd before reading startup config.
- Already-exported shell variables still win over those file defaults.

`assistantd` sets `MURPH_ASSISTANTD_DISABLE_CLIENT=1` in its own process so daemon-local calls never recurse back through the HTTP client.

## HTTP routes

All routes are loopback control-plane routes, require `Authorization: Bearer <token>`, and are bound to the daemon's configured vault. Requests that include a different `vault` are rejected.

- `GET /healthz`
- `POST /open-conversation`
- `POST /message`
- `POST /session-options`
- `GET /status`
- `GET /sessions`
- `GET /sessions/:id`
- `GET /outbox`
- `GET /outbox/:intentId`
- `POST /outbox/drain`
- `GET /cron/status`
- `GET /cron/jobs`
- `GET /cron/jobs/:job`
- `GET /cron/jobs/:job/target`
- `GET /cron/runs`
- `POST /automation/run-once` (defaults to one-shot mode with `once: true`; continuous requests default the daemon on)
- `POST /cron/process-due`
- `POST /cron/jobs/:job/target`

The daemon no longer exposes local gateway routes. Headless hosted gateway contracts stay in `@murphai/gateway-core`, while assistantd stays focused on local assistant control.
