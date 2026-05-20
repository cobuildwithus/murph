# Device Sync Reconnect Review Fixes

## Goal

Resolve the concrete post-commit subagent findings against device-sync reconnect recovery while keeping the architecture simple and preserving `device_connection` as the lifecycle authority.

## Constraints

- Preserve unrelated hosted snapshot/R2/dev-local dirty work.
- Do not add a reconnect lifecycle table or parallel reconnect route.
- Keep logs metadata-only: no tokens, raw claim URLs, raw provider credentials, contact identifiers, or raw provider bodies.
- Prefer shared provider/target resolution over duplicate matching logic.

## Implementation Shape

- Narrow WHOOP `invalid_request` reauth classification to token-invalid descriptions instead of every refresh-token invalid request.
- Enforce terminal `reauthorization_required`/`disconnected` invariants in local sync hydration and queue cleanup.
- Fix `/connect` duplicate-state and pending-action race edge cases.
- Ensure reconnect notices use registered log event codes, include production Junction sources, and avoid claim-in-path SMS links.

## Verification

- `pnpm typecheck`
- Focused vitest suites for `device-syncd`, `assistant-runtime`, `hosted-execution`, and web reconnect/settings routes.
- `bash scripts/workspace-verify.sh test:diff ...`
- `git diff --check`
Status: completed
Updated: 2026-05-20
Completed: 2026-05-20
