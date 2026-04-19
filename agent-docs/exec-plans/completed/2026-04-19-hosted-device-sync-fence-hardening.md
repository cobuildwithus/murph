## Title

Require explicit observed fences for every hosted device-sync runtime mutation.

## Goal

Close the hosted device-sync replay and stale-write gap by requiring explicit observation fences on every mutating runtime update: `observedUpdatedAt` for connection and local-state mutations, and `observedTokenVersion` for token mutations.

## Scope

- `apps/web/src/lib/device-sync/hosted-runtime-authority.ts`
- `packages/device-syncd/src/hosted-runtime.ts`
- `packages/assistant-runtime/src/hosted-device-sync-runtime.ts`
- focused tests under the same owners

## Constraints

- Keep `apps/web` as the canonical hosted device-sync authority.
- Fail closed on omitted mutation fences.
- Allow explicit `null` only as “observed absence”, not as an omitted field.
- Preserve unrelated dirty-tree work in the same owners.

## Verification

- `pnpm typecheck`
- `bash scripts/workspace-verify.sh test:diff apps/web/src/lib/device-sync/hosted-runtime-authority.ts packages/device-syncd/src/hosted-runtime.ts packages/assistant-runtime/src/hosted-device-sync-runtime.ts`
- targeted owner tests if the diff-aware lane leaves a direct proof gap

## Notes

- Direct proof needs three cases: omitted fences rejected, stale fences skipped without mutation, and fresh fences applied once.
Status: completed
Updated: 2026-04-19
Completed: 2026-04-19
