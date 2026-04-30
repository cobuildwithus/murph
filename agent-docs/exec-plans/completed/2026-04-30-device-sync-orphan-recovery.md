# Device Sync Orphan Recovery

Status: completed
Created: 2026-04-30
Updated: 2026-04-30

## Goal

Recover more gracefully when a previous Murph-managed local device sync daemon
is still listening after launcher state or `.runtime` was removed.

## Success Criteria

- `murph onboard` / `murph device connect <provider> --open` can restart the
  managed device-sync daemon when port 8788 is occupied by an identifiable
  orphaned Murph `device-syncd` process.
- Murph does not terminate arbitrary non-Murph listeners on the target port.
- Existing fail-closed behavior remains for unknown listeners, remote base
  URLs, missing provider credentials, and unhealthy managed processes.
- Recovery does not print tokens, secrets, vault contents, or user-local paths.

## Scope

- `packages/operator-config/src/device-daemon.ts`
- `packages/operator-config/src/device-daemon/types.ts`
- Focused operator-config and CLI device-daemon tests if needed.

## Constraints

- Keep the control-plane boundary loopback-only and bearer-authenticated.
- Do not persist new state; this is process recovery only.
- Keep recovery bounded to one terminate-and-retry attempt.
- Preserve unrelated dirty tree work and active ledger rows.

## Tasks

1. Add a narrow injectable process recovery seam for unmanaged loopback
   listener conflicts.
2. Use it only after an unauthenticated health check proves a listener is
   reachable but the current vault is not managing it.
3. Retry startup once when the listener is safely terminated.
4. Add regressions for safe orphan recovery and unknown-listener fail-closed
   behavior.
5. Run focused verification and typecheck.
Completed: 2026-04-30
