# Hosted Device Account List

## Goal

Make `vault-cli device account list` report hosted device-sync connections from the hosted runtime authority when running inside hosted assistant execution, so assistant answers do not confuse missing local daemon state with missing hosted wearable connections.

## Constraints

- Keep local daemon account-list behavior unchanged outside hosted runtime or when an explicit local control-plane target is supplied.
- Do not expose provider tokens, raw external account identifiers beyond the existing device account CLI contract, or private hosted control-plane errors.
- Keep the bridge composable: add a small account-list bridge route/client instead of provider-specific logic.
- Preserve existing hosted `device connect` bridge behavior.

## State

Done:
- Confirmed local Postgres has one active WHOOP device connection with token material and a recent completed sync.
- Confirmed hosted runtime logs show device-connect context available and device-sync wake processed.
- Identified root cause: hosted CLI bridge supports connect links only; `device account list` falls back to local daemon availability in hosted runtime.
- Added hosted CLI bridge account-list support, hosted runtime snapshot routing, and CLI hosted account-list routing.
- Security audit found hosted account-list metadata leakage; bridge mapping now redacts metadata and client schema rejects non-empty metadata.

Now:
- Re-run focused verification after audit fixes and complete final audit.

Next:
- Commit audit follow-up changes through repo workflow if unblocked.

## Working Set

- `packages/hosted-execution/src/cli-runtime-bridge.ts`
- `packages/assistant-runtime/src/hosted-runtime/cli-runtime-bridge.ts`
- `packages/assistant-runtime/src/hosted-runtime/platform.ts`
- `packages/cli/src/device-services.ts`
- Focused tests under `packages/hosted-execution/test`, `packages/assistant-runtime/test`, and `packages/cli/test`
