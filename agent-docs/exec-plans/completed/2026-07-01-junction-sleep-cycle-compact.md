# Junction Sleep Cycle Compact Import

## Goal

Fix Junction `sleep_cycle` normalization so provider imports keep dense stage intervals as raw evidence and emit compact sleep-stage product facts that pass the core device batch guard.

## Scope

- `packages/importers/src/device-providers/junction.ts`
- `packages/importers/test/device-providers-junction.test.ts`
- Focused verification for Junction importer behavior and core dense telemetry policy.

## Constraints

- Do not store raw provider stage timelines as default device samples.
- Preserve raw evidence artifacts for audit/debug.
- Keep normalized sleep-stage facts queryable as compact observations.
- Avoid exposing user identifiers or raw provider payloads.

## State

Implemented. Ready for PR-lane ReviewGPT after scoped commit/push/PR.

## Verification

- `pnpm --filter @murphai/importers test -- device-providers-junction` passed: 13 files, 249 tests.
- `pnpm --filter @murphai/importers typecheck` passed.
- `pnpm build:workspace:incremental` passed.
- `pnpm test:diff packages/importers/src/device-providers/junction.ts packages/importers/test/device-providers-junction.test.ts` was attempted after generating Health Commons artifacts. It passed dependency policy, workspace boundaries, guards, affected package typechecks, affected package tests, apps/cloudflare verify, and then failed in apps/web verify when local dev smoke exited early. A direct `pnpm --dir apps/web dev:smoke` rerun failed because the isolated worktree is not linked to a Vercel project; this is a local worktree setup blocker, not importer behavior.
Status: completed
Updated: 2026-06-30
Completed: 2026-06-30
