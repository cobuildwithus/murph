# PR 295 ReviewGPT round 9 fixes

## Goal

Resolve the accepted ReviewGPT round 9 findings for hosted Retell phone calls.

Success criteria:

- Synthesized fallback `initial` input cannot authorize phone-call side effects
  or participate in phone-call request keys.
- Phone-call result notifications use the normal AI-gated notification path,
  not exact hard-coded outbound copy.
- The migration assertion matches the member-scoped request-key unique index.
- Focused verification and typechecks pass before pushing and rerunning
  ReviewGPT.

## Constraints

- Keep one hosted phone-call row and the existing result handler.
- Do not add new approval tables, task tables, supervisors, queues, or policy
  gateways.
- Do not expose member identity or idempotency keys to the model.
- Preserve unrelated active-plan and working-tree edits.

## Approach

1. Remove `initial` source eligibility from phone-call accepted input filtering.
2. Update the assistant phone-call tests to prove `initial` is rejected.
3. Change the result notification wake from exact text to AI-gated
   instructions/metadata using the existing notification path.
4. Update the migration privacy/foundation assertion for the composite unique
   index.
5. Run focused verification, commit, push, and rerun ReviewGPT.

## State

Ready for scoped commit.

## Notes

- Round 9 finding 1: fallback accepted input id `initial` can collapse two
  distinct manual approvals with the same brief.
- Round 9 finding 2: result notifications used `require_send_exact_text`, which
  violates the hard-coded automatic outbound message invariant.
- Round 9 finding 3: the migration test still asserted the old global request
  key unique index.
- Fixed by excluding `source: "initial"` from phone-call accepted input
  eligibility.
- Fixed by changing phone-call result notifications to `responsePolicy:
  require_send` with structured instructions instead of exact user text.
- Fixed the hosted phone-call migration assertion to require the scoped
  `(member_id, request_key)` unique index.
- Verification passed:
  `pnpm --dir packages/assistant-engine exec vitest run test/assistant-phone-calls.test.ts`;
  `pnpm exec vitest run --config apps/web/vitest.workspace.ts apps/web/test/phone-calls-service.test.ts apps/web/test/phone-calls-retell.test.ts apps/web/test/phone-calls-retell-routes.test.ts apps/web/test/phone-calls-retell-real-consult-route.test.ts apps/web/test/hosted-onboarding-privacy-foundation-migration.test.ts --no-coverage`;
  `pnpm --filter @murphai/assistant-engine typecheck`;
  `pnpm --filter @murphai/hosted-web typecheck`;
  `git diff --check`.
Status: completed
Updated: 2026-06-25
Completed: 2026-06-25
