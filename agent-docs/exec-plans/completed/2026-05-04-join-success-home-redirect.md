# Join Success Home Redirect

## Goal

Stop hosted onboarding users from getting stuck on `/join/[inviteCode]/success` after Stripe checkout by sending eligible authenticated users to `/home` while backend activation continues settling.

## Scope

- Update the hosted join success client redirect condition.
- Update focused success-page tests for pending checkout/activation behavior.
- Preserve existing guarded fallback behavior for unauthenticated, invite-mismatched, terminal, preview, and no-session cases.

## Constraints

- Do not weaken invite/session matching.
- Do not expose sensitive checkout/session details in UI or logs.
- Keep the change narrow to `apps/web` hosted onboarding success behavior.

## Verification

- Run focused Vitest coverage for the join success client.
- Run the repo-required app verification lane if feasible.

## Status

Implementation, focused tests, required review passes, and post-review verification complete. Ready to close with `scripts/finish-task`.

## Evidence

- `pnpm --dir apps/web test -- join-invite-success-client.test.ts` passed.
- `pnpm test:diff apps/web/src/components/hosted-onboarding/join-invite-success-client.tsx apps/web/test/join-invite-success-client.test.ts` passed, including hosted-web verify.
- `pnpm typecheck` passed.
- `git diff --check` passed.
- `security-privacy-review` completed with no findings.
- `frontend-review` completed with no findings.
- `task-finish-review` found one low-severity checkout regression-test gap; fixed with a pending-reconciliation checkout redirect test.
Status: completed
Updated: 2026-05-04
Completed: 2026-05-04
