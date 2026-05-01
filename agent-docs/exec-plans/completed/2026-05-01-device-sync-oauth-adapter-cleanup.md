# Device Sync OAuth Adapter Cleanup

Status: completed
Created: 2026-05-01

## Goal

Remove OAuth compatibility methods from the shared `DeviceSyncProvider` shape so non-OAuth providers only expose generic handlers, while OAuth providers keep their legacy method surface through an explicit adapter type during migration.

## Scope

- `packages/device-syncd` provider types, registry/service/public-ingress resolution, and OAuth compatibility wrapper.
- Direct package/app tests that construct fake providers or assert provider capability shape.

## Constraints

- Preserve existing active Junction work and unrelated dirty files.
- Do not widen into connect-target routing or provider data normalization.
- Keep token/credential refresh fail-closed for provider-config accounts.
- Do not expose secrets or local personal identifiers in generated files or handoff.

## Verification

- `pnpm typecheck`
- Focused `packages/device-syncd` coverage or truthful `pnpm test:diff` for touched paths.
- Required security/privacy, coverage-write, and task-finish audit passes before handoff.
Updated: 2026-05-01
Completed: 2026-05-01
