# Device Sync Secret Lifecycle

## Goal

Keep local managed device-sync OAuth credential encryption stable across daemon stop/start and crash-restart lifecycles.

Success criteria:

- Managed daemon control bearer rotation no longer changes the fallback `DEVICE_SYNC_SECRET`.
- A vault-local managed encryption secret is generated once, stored privately, and reused across launches.
- Normal daemon stop removes only launcher/control-token state, not the encryption secret.
- Focused tests cover stop/start and stale-state restart behavior.

## Constraints

- Keep the control bearer token and encryption secret as separate lifecycle concepts.
- Do not change device-syncd token encryption format or provider account storage.
- Keep the new persisted state under `.runtime/operations/device-sync/**` with private file permissions.
- Preserve unrelated working-tree edits.
- Do not expose secrets, local usernames, home paths, or direct personal identifiers in diffs or logs.

## Scope

Planned files:

- `packages/operator-config/src/device-daemon.ts`
- `packages/operator-config/src/device-daemon/state.ts`
- `packages/operator-config/src/device-daemon/paths.ts`
- focused device-daemon tests under `packages/operator-config/test/**` and/or `packages/cli/test/**`

Out of scope:

- Key rotation/keyring migration for already encrypted local OAuth tokens.
- Hosted device-sync crypto changes.
- Provider reconnect UX changes.

## Verification

Done:

- Focused tests for managed daemon secret lifecycle passed.
- Security-review follow-up added fail-closed validation for unreadable/invalid existing encryption-secret state and safe permission repair.
- Final-review follow-up moved directory permission repair before secret-file inspection to close writable-directory replacement risk.
- `pnpm --dir packages/operator-config test:coverage` passed.
- `pnpm --dir packages/cli test:source:coverage` passed.
- `pnpm --dir packages/operator-config typecheck && pnpm --dir packages/cli typecheck && pnpm --dir packages/device-syncd typecheck` passed.

Blocked broader checks:

- `pnpm typecheck` is red in an unrelated dirty hosted-web test file.
- Scoped `pnpm test:diff ...` reached and passed the relevant package tests, then failed in unrelated dirty Cloudflare deploy workflow verification.
Status: completed
Updated: 2026-05-06
Completed: 2026-05-06
