# Device auth CLI and web control plane

Status: completed
Created: 2026-03-17
Updated: 2026-03-17

## Goal

- Add a provider-agnostic device auth surface that can start OAuth from `vault-cli` and from the local web app, while reusing the existing `@healthybob/device-syncd` runtime and leaving room for future Garmin/Oura providers.

## Success criteria

- `@healthybob/device-syncd` accepts a minimal safe return-origin configuration so a local web app can initiate auth and receive a post-connect redirect without weakening token handling.
- `vault-cli` exposes generic device sync commands for listing providers, starting auth, listing accounts, reconnecting, disconnecting, and manual reconcile without hard-coding WHOOP into the command graph.
- `packages/web` shows device provider/account status and offers a one-click connect/reconnect entrypoint against the same runtime.
- Shared docs describe the new trust boundary, runtime assumptions, and CLI command surface.
- Required checks and completion-workflow audits are rerun before handoff.

## Scope

- In scope:
  - `packages/device-syncd` config/service updates needed for cross-origin local return redirects
  - generic CLI device-sync client/services/contracts/commands and tests
  - local web routes/server UI for device connection status and auth initiation
  - architecture/runtime/command-surface docs for the new control-plane behavior
- Out of scope:
  - new provider implementations beyond the existing WHOOP runtime
  - live deployment or hosted auth infrastructure
  - background sync behavior changes unrelated to auth/control-plane access

## Constraints

- Do not read or expose `.env*`, tokens, secrets, or raw OAuth credentials.
- Preserve canonical health writes inside `@healthybob/core` via existing importer seams.
- Keep the CLI and web auth surface provider-agnostic even though WHOOP is the only current provider.
- Preserve adjacent dirty worktree edits, especially other active CLI lanes.

## Tasks

1. Add the device-sync return-origin/config seam needed for a separate local web origin.
2. Wire a generic CLI client plus commands on top of the existing HTTP API.
3. Add a server-rendered web device panel and auth route handlers.
4. Update docs/tests, then run required verification and completion audits.
Completed: 2026-03-17
