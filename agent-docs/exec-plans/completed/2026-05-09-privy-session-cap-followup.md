# Privy Session Cap Followup

## Goal

Address the xhigh review findings on commit `3ed3a73be`: close the issue/logout replay storage-growth gap and simplify tests so they prove the session-row cap semantically instead of overfitting to Prisma call shapes.

## Scope

- `apps/web/src/lib/hosted-onboarding/app-session.ts`
- `apps/web/prisma/schema.prisma`
- `apps/web/prisma/migrations/2026050900_hosted_web_session_row_cap_index/migration.sql`
- `apps/web/test/hosted-app-session.test.ts`
- `apps/web/test/hosted-app-session-production-cookie.test.ts`
- `apps/web/test/hosted-onboarding-privacy-foundation-migration.test.ts`
- `.deepsec/data/murph/**` only if scoped revalidation/report output changes generated Deepsec state

## Constraints

- Keep the Privy completion route unchanged and orchestration-only.
- Keep the invariant in the app-session service.
- Do not add a new table or route-specific rate limiter.
- Add only the narrow session-row-cap index needed to keep the cleanup query bounded under stale-row buildup.
- Preserve unrelated dirty worktree edits.

## Plan

1. Change overflow cleanup from active-session-only pruning to total row pruning for the same `(memberId, privyUserId)`.
2. Keep the cap private to the service and remove test-only exported surface.
3. Add the narrow composite index for the row-cap query.
4. Replace brittle query-shape-heavy tests with a small in-memory hosted web session fake that proves the row set outcome and rejects unsupported filter/order regressions.
5. Run focused tests, focused lint, app typecheck/diff verification where not blocked by unrelated dirty work, required audits, privacy/whitespace guards, and scoped Deepsec revalidation/report refresh for the Privy finding.

## Verification

- Focused app-session tests.
- Focused lint on touched app-session files.
- `pnpm --filter @murphai/hosted-web typecheck` or a documented unrelated blocker.
- Required security/privacy, coverage, and final review audits.
- Deepsec scoped revalidation/report refresh for the Privy finding.

## Outcome

- Done: total hosted app session row cap now prunes by `(memberId, privyUserId)` without active-only filters.
- Done: added the narrow hosted web session cap index.
- Done: removed test-only app-session exports.
- Done: tests now assert row-set behavior, transaction ordering, scoped cleanup, cookie flags, and migration baseline.
- Verification passed:
  - `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-app-session.test.ts apps/web/test/hosted-app-session-production-cookie.test.ts apps/web/test/hosted-onboarding-privacy-foundation-migration.test.ts`
  - focused `eslint` on touched app-session source/tests
  - `pnpm --dir apps/web exec prisma validate`
  - `git diff --check` on touched files
  - Deepsec scoped revalidation and report refresh for the Privy finding
- Verification passed before unrelated dirty-tree drift:
  - `pnpm --filter @murphai/hosted-web typecheck`
- Blocked unrelated after later dirty-tree drift:
  - `pnpm --filter @murphai/hosted-web typecheck` now fails in `apps/web/test/hosted-onboarding-webhook-workflows.test.ts` on missing mocked workflow symbols unrelated to this task.
  - `bash scripts/workspace-verify.sh test:diff ...` fails in `apps/web/test/hosted-onboarding-telegram-dispatch.test.ts` on an existing hosted routing expectation mismatch unrelated to this task.
- Audits:
  - five xhigh review subagents completed and their actionable findings were addressed
  - simplify audit completed; low cleanup applied
  - security/privacy audit completed with no findings
  - coverage-write audit completed with no edits and reran the focused Vitest lane
  - task-finish-review completed with no findings
Status: completed
Updated: 2026-05-09
Completed: 2026-05-09
