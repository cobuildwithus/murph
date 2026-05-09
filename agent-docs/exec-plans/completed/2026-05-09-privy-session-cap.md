# Privy Session Cap

## Goal

Fix the Deepsec finding "Privy completion can be replayed to create unbounded app sessions" with the smallest durable invariant: hosted app-session issuance must keep session rows bounded per member and Privy identity.

## Scope

- `apps/web/src/lib/hosted-onboarding/app-session.ts`
- `apps/web/test/hosted-app-session.test.ts`
- `apps/web/test/hosted-app-session-production-cookie.test.ts` if transaction mocks need alignment
- `.deepsec/data/murph/**` only if scoped revalidation/report output changes generated Deepsec state

## Constraints

- Keep `apps/web/app/api/hosted-onboarding/privy/complete/route.ts` as orchestration only unless implementation proves a route change is necessary.
- Prefer service-level ownership over route-specific rate limiting or a new replay table.
- Do not add a schema migration unless correctness or practical query performance requires it.
- Preserve unrelated dirty worktree edits.

## Plan

1. Add a small cap constant to hosted app-session issuance.
2. Create the new session inside one Prisma transaction.
3. Serialize issuance for a member inside the transaction using the smallest existing database lock shape available.
4. Delete older active overflow sessions for the same `(memberId, privyUserId)` while excluding the newly issued session.
5. Add focused service tests for cap behavior, scoping, expired/revoked exclusions, self-exclusion, and transaction usage.
6. Run focused tests, app typecheck, scoped verification, required audits, and Deepsec revalidation for the Privy finding.

## Verification

- Focused app-session tests.
- `pnpm --dir apps/web exec tsc --noEmit --pretty false`
- `scripts/workspace-verify.sh test:diff` over touched files when truthful.
- Required `security-privacy-review`, `coverage-write`, and `task-finish-review` passes.

Status: completed
Updated: 2026-05-09
Completed: 2026-05-09
