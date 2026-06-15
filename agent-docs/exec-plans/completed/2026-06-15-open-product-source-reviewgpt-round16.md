# Open Product Source ReviewGPT Round 16

## Goal

Close ReviewGPT round 16's source-key synchronization finding for PR 176.

Success criteria:

- Add a regression check that contaminant-only import source keys are represented
  in the runtime hidden-search origin list.
- Keep the fix test-only and avoid new runtime abstraction.
- Run focused verification and the next ReviewGPT pass.

## Scope

- `apps/web/test/product-tests-schema.test.ts`

## Status

Implemented and locally verified.

Verification completed:

- `pnpm --dir apps/web test:prepared -- apps/web/test/product-tests-schema.test.ts apps/web/test/foods-lib.test.ts apps/web/test/supplements-lib.test.ts`
- `git diff --check`
Status: completed
Updated: 2026-06-15
Completed: 2026-06-15
