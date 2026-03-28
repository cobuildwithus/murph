# Production followups 1-5

Status: completed
Created: 2026-03-28
Updated: 2026-03-28

## Goal

Land the five reviewed production followups across hosted runtime hardening, device-sync control-plane failure isolation, assessment CLI/query alignment, and the first real `@murph/assistant-services` ownership move without widening into unrelated runtime or CLI redesign.

## Scope

- harden hosted internal HTTP fetch paths with shared timeout-safe helpers and tolerant non-JSON error handling
- keep hosted device-sync control-plane failures best-effort for non-`device-sync.wake` dispatches while preserving hard-fail wake behavior
- make the assessment list surface stop advertising unsupported `--status` filtering and tighten the corresponding runtime option types
- move hosted-facing operator-config/store ownership into `@murph/assistant-services` instead of direct `murph/*` passthroughs
- add focused regression coverage around the new hosted HTTP and maintenance behavior

## Constraints

- preserve the existing hosted health taxonomy, registry write invariants, and current-profile fallback seams
- preserve hard failure for real `device-sync.wake` control-plane errors
- keep the assistant-services move scoped to hosted-facing operator config and automation state ownership in this pass
- work on top of the already-dirty tree without reverting unrelated active-lane edits

## Verification

- focused hosted-runtime coverage:
  - `pnpm exec vitest --config packages/assistant-runtime/vitest.config.ts run packages/assistant-runtime/test/hosted-runtime-http.test.ts packages/assistant-runtime/test/hosted-runtime-maintenance.test.ts packages/assistant-runtime/test/assistant-services-boundary.test.ts --no-coverage --maxWorkers 1`
- targeted package checks where useful:
  - `pnpm --dir packages/assistant-runtime typecheck`
  - `pnpm --dir packages/assistant-services typecheck`
- required repo wrappers:
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm test:coverage`
- required completion-workflow audits:
  - `simplify`
  - `test-coverage-audit`
  - `task-finish-review`

## Notes

- The assessment descriptor/runtime/type work is already present in the live tree and not currently dirty; keep the closure for this task focused on the remaining hosted-runtime and assistant-services diffs.
- Current repo-wide wrapper failures are outside this task scope:
  - `pnpm typecheck` fails in `packages/contracts/scripts/verify.ts`
  - `pnpm test` and `pnpm test:coverage` fail in `packages/importers/src/providers/oura.ts`
Completed: 2026-03-28
