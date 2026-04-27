# Device Daemon Stale Runtime Recovery

## Goal

Make `murph onboard` / `murph device connect` recoverable when the local device-sync daemon is still alive but its launcher state was cleared.

## Scope

- `packages/operator-config/src/device-daemon.ts`
- `packages/operator-config/test/device-daemon-runtime.test.ts`
- `packages/cli/test/device-daemon.test.ts`

## Constraints

- Do not reuse or authenticate to arbitrary listeners on the default port after launcher state is missing.
- Preserve managed daemon reuse only when launcher state still records a live process for the base URL.
- Return a clear conflict message with a port-specific `lsof` recovery command and `DEVICE_SYNC_PORT` fallback when a listener is already reachable.
- Preserve explicit daemon lifecycle semantics.

## Verification

- Focused CLI and operator-config device daemon regression tests.
- Operator-config coverage.
- CLI and operator-config typecheck.
Status: completed
Updated: 2026-04-27
Completed: 2026-04-27
