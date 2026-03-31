# @murph/assistantd

Published local assistant runtime control plane for Murph.

`assistantd` is the local daemon boundary for the personal assistant runtime. It keeps the canonical vault write surface in Murph core/CLI while giving the assistant runtime a single loopback-owned control plane for chat turns, session access, outbox draining, cron processing, automation scans, diagnostics, and status through the explicit `@murph/assistant-core` headless surface.

Like `device-syncd`, the daemon binds the control plane to localhost by default and requires a bearer token for every control-plane request. It is meant to run one daemon per selected vault.

What it does:
- serves a localhost-only assistant control plane for local chat turns and runtime state inspection
- owns assistant session execution through one runtime authority per vault
- keeps assistant runtime state in sibling `assistant-state/**`, not in canonical vault files
- exposes status, session, outbox, cron, and automation control routes for local clients
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

All routes are loopback control-plane routes and require `Authorization: Bearer <token>`.

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
- `GET /cron/runs`
- `POST /automation/run-once` (defaults to `once: true` and `startDaemon: false`)
- `POST /cron/process-due`

## Gateway routes

assistantd now also serves the local derived gateway plane over loopback-only authenticated HTTP:

- `POST /gateway/conversations/list`
- `POST /gateway/conversations/get`
- `POST /gateway/messages/read`
- `POST /gateway/messages/send`
- `POST /gateway/attachments/fetch`
- `POST /gateway/events/poll`
- `POST /gateway/events/wait`
- `POST /gateway/permissions/list-open`
- `POST /gateway/permissions/respond`

These routes serve the operational conversation/message gateway surface for local MCP or other transport adapters without turning assistantd into a second canonical write owner.

Local gateway helpers now honor the same assistantd base-url/token environment variables as the assistant client path, so consumers can route steady-state gateway reads/sends through the daemon whenever it is configured.
