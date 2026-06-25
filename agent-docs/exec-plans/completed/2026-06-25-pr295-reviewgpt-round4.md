# PR 295 ReviewGPT round 4 fixes

## Goal

Resolve the accepted high-impact ReviewGPT round 4 findings for the hosted
Retell phone-calling PR without adding a broader orchestration layer.

Success criteria:

- Hidden `murph.create_phone_call` execution fails closed unless the current
  hosted turn has user-approved manual phone-call authority.
- `ask_murph` can return `continue` only for bounded information already present
  in the stored approved call brief.
- Focused regressions prove both behavior changes.
- Scoped verification passes before pushing and rerunning ReviewGPT.

## Constraints

- Preserve the architecture primitive set: one call brief, one hosted phone-call
  row, one hosted runtime port, one Retell runtime, one consult path.
- Keep Retell/provider behavior in `apps/web`; do not introduce task/attempt
  tables, supervisors, queues, or policy gateways.
- Do not expose secrets, direct user identifiers, local account names, home
  paths, Retell payload bodies, transcripts, or raw phone numbers in committed
  docs or logs.
- Preserve unrelated active-plan and working-tree edits.

## Approach

1. Revalidate the two Round 4 findings against current code.
2. Add execution-time phone-call authority checks at the assistant hosted-tool
   context/executor boundary.
3. Add a deterministic, bounded live-consultation `continue` path sourced only
   from `shareableFacts`.
4. Add focused tests and run owner verification.
5. Commit, push, and run the next ReviewGPT round against the pushed PR head.

## State

Ready for scoped commit.

## Notes

- ReviewGPT round 4 accepted finding 1: planning hides the phone-call tool for
  non-manual hosted turns, but direct server tool execution only checked for the
  phone-call transport and non-empty accepted input ids.
- ReviewGPT round 4 accepted finding 2: the signed `ask_murph` route wired to a
  production consult function that only transferred or ended calls, so it could
  never continue even for facts already approved in the call brief.
- Fixed by adding a phone-call-specific request-key scope sourced from the same
  eligible input filter as planning, and by requiring that scope at dynamic-tool
  execution time before calling the hosted phone-call port.
- Fixed live consultation with a deterministic `shareableFacts` answer path;
  unmatched questions still fall back to transfer/end.
- Verification passed:
  `pnpm --dir packages/assistant-engine exec vitest run test/assistant-phone-calls.test.ts`;
  `pnpm exec vitest run --config apps/web/vitest.workspace.ts apps/web/test/phone-calls-service.test.ts apps/web/test/phone-calls-retell.test.ts apps/web/test/phone-calls-retell-routes.test.ts apps/web/test/phone-calls-retell-real-consult-route.test.ts --no-coverage`;
  `pnpm --filter @murphai/assistant-engine typecheck`;
  `pnpm --filter @murphai/hosted-web typecheck`;
  `git diff --check`.
Status: completed
Updated: 2026-06-25
Completed: 2026-06-25
