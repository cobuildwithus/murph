# PR 295 ReviewGPT round 16 fixes

## Goal

Resolve the accepted ReviewGPT round 16 findings for hosted Retell phone calls.

Success criteria:

- Signed live `ask_murph` callbacks can recover a Retell provider call id when
  the start path created the provider call but lost the post-start DB update.
- Retell ISO timestamp strings persist as the actual timestamp, not a numeric
  prefix interpreted as epoch seconds.
- Focused route/result tests and hosted web typecheck pass before pushing and
  rerunning ReviewGPT.

## Constraints

- Keep provider-specific recovery isolated in `apps/web`.
- Do not weaken callback/provider mismatch checks.
- Do not add new tables or provider event framework.
- Preserve unrelated active-plan and working-tree edits.

## Approach

1. Add a minimal provider-id claim path for signed live Retell consultation
   callbacks with Murph call metadata and a null stored provider call id.
2. Tighten Retell timestamp parsing so numeric-string handling only applies to
   digit-only strings.
3. Add focused tests for both reachable failure modes.
4. Run focused verification, commit, push, and rerun ReviewGPT.

## State

Ready to finish.

## Notes

- Round 16 finding 1: terminal webhooks can recover provider ids from Murph
  metadata, but `ask_murph` consult rejects `providerCallId=null`.
- Round 16 finding 2: `Number.parseInt("2026-...")` persisted a 1970 date.
- Verification passed:
  - `pnpm exec vitest run --config apps/web/vitest.workspace.ts apps/web/test/phone-calls-retell.test.ts apps/web/test/phone-calls-retell-real-consult-route.test.ts apps/web/test/phone-calls-retell-routes.test.ts --no-coverage`
  - `pnpm --filter @murphai/hosted-web typecheck`
  - `git diff --check`
Status: completed
Updated: 2026-06-25
Completed: 2026-06-25
