# 2026-05-29 Retention Deep Review Fixes

## Goal

Fix the important post-review issues from the dense raw retention and hosted delivery work while keeping the architecture narrow:

- Hosted Linq recovery must not expand sender authority when no explicit sender route is known.
- Dense raw pruning must remain bounded by hosted idle/deadline constraints.
- Dense raw pruning must make progress on a single oversized candidate instead of reporting permanent backlog.
- Malformed retention metadata must fail closed instead of falling back to role-string pruning.

## Scope

- `packages/assistant-runtime/src/hosted-provider-effects.ts`
- Focused hosted-runtime tests for Linq recovery authority.
- `packages/core/src/wearable-storage-migration.ts`
- Focused core wearable storage migration tests.

## Out Of Scope

- Existing uncommitted Junction identity redaction work in `packages/device-syncd/test/junction-provider.test.ts`, `packages/importers/src/device-providers/junction-resources.ts`, and `packages/importers/test/device-providers.test.ts`.
- New retention frameworks, new cron systems, or broad storage refactors.
- Changing the current sparse `weight` retention policy.

## Verification Plan

- Focused core wearable storage migration tests.
- Focused hosted-runtime Linq recovery/maintenance tests.
- `pnpm typecheck`.
- Scoped `bash scripts/workspace-verify.sh test:diff ...` for the touched files if it remains truthful despite unrelated dirty work.
- Required completion audits: security/privacy, coverage-write, task-finish review, plus a deep-review check as requested.

## Notes

- Preserve all unrelated dirty work.
- Keep new behavior explicit and fail-closed.
