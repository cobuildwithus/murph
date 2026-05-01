# Startup Recovery Greenfield Input Cleanup

## Goal

Remove the legacy auto-reply capture fallback from assistant startup recovery so accepted assistant input only comes from stored `AssistantInputEvent` records.

## Constraints

- Preserve the current assistant input spine: source adapter -> `AssistantInputEvent` -> accepted-input journal -> provider work/checkpointing.
- Do not synthesize assistant-input candidates from legacy inbox captures.
- Keep the change narrow to startup recovery and directly coupled tests.
- Preserve unrelated dirty work in the checkout.

## Plan

1. Inspect the legacy fallback path and tests that exercise it.
2. Delete the legacy metadata constants, capture lookup helper, and non-`ain_` inbox lookup branch.
3. Update focused tests to assert greenfield fail-closed behavior for non-event input ids.
4. Run focused package verification, typecheck, required audits, and finish with a scoped commit.

## Verification

- `pnpm --dir packages/assistant-engine test -- assistant-automation-runtime.test.ts` passed after implementation: 84 files / 789 tests.
- `pnpm --dir packages/assistant-engine typecheck` passed.
- `pnpm --dir packages/assistant-engine test:coverage` passed.
- `pnpm typecheck` passed.
- `git diff --check -- packages/assistant-engine/src/assistant/automation/startup-recovery.ts packages/assistant-engine/test/assistant-automation-runtime.test.ts agent-docs/exec-plans/active/2026-05-01-startup-recovery-greenfield-input.md` passed.
- Required `security-privacy-review` passed with no findings; residual proof gaps were closed with focused tests.
- Required `coverage-write` made no changes and reported existing proof was sufficient before the final extra fail-closed tests.
- Required `task-finish-review` found a grouped-input partial recovery bug; fixed by rejecting the whole candidate if any grouped input id is invalid or missing and added a grouped missing-event regression test.
- `bash scripts/workspace-verify.sh test:diff packages/assistant-engine/src/assistant/automation/startup-recovery.ts packages/assistant-engine/test/assistant-automation-runtime.test.ts` failed in unrelated reverse-dependent CLI audit packaging because existing generated Workflow route files under `apps/web/app/.well-known/workflow/v1/**/route.js` are blocked by `pnpm no-js`.
Status: completed
Updated: 2026-05-01
Completed: 2026-05-01
