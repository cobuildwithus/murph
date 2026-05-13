# Active-Turn Notification Rerun

## Goal

Preserve event-driven active-turn input admission after removing the generic live
poll pump by making overlapping input-available notifications schedule one
follow-up admission pass.

Success criteria:

- A notification that arrives while `input_available` admission is already in
  flight cannot be lost to promise coalescing.
- The controller remains event-driven: no timers, no generic polling loop, and
  no provider-registration admission side effect.
- Existing provider-boundary and pre-provider admission behavior remains intact.
- Focused regression coverage proves the in-flight notification rerun path.

## Constraints

- Preserve unrelated dirty work in the checkout.
- Keep the fix inside the active-turn controller and focused test surface.
- Do not reintroduce compatibility pump machinery or background retry loops.

## Plan

1. Register the follow-up in the coordination ledger.
2. Change input-available admission coalescing to remember in-flight
   notifications and rerun once the current pass settles.
3. Add a regression for notification arrival during an in-flight admission.
4. Run focused assistant-engine tests and required diff/type verification.

## Verification

Completed:

- `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts test/assistant-local-service-runtime.test.ts --testNamePattern "active-turn controller" --no-coverage`
- `bash scripts/workspace-verify.sh test:diff packages/assistant-engine/src/assistant/active-turn-input-controller.ts packages/assistant-engine/test/assistant-local-service-runtime.test.ts agent-docs/exec-plans/active/2026-05-13-active-turn-notification-rerun.md`
- `pnpm typecheck`
- `git diff --check --` for the touched follow-up files
- Stale pump-symbol scan found no matches in `packages`, `apps`, or this
  active plan.

Status: completed
Updated: 2026-05-13
Completed: 2026-05-13
Completed: 2026-05-13
