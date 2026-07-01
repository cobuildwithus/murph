# PR 354 Family Invite CI Follow-Up

Goal (incl. success criteria):
- Clear PR 354's blocked `Release app verification (ubuntu)` check after the
  hosted family-plan test fixture expired on July 1, 2026.
- Success means the family-plan test no longer depends on the wall clock, local
  verification passes, the fix is pushed, ReviewGPT is green, and CI is green.

Constraints/Assumptions:
- This is a test-only unblock outside the original hosted cron diff.
- Do not change hosted family-plan production behavior unless the local repro
  proves a product bug.
- Keep the fixture simple; no new scheduler, state, or broad test harness layer.

Key decisions:
- Default pending invite fixtures should stay pending relative to the test run.
- Explicit expired/accepted invite tests continue to override `expiresAt`.

State:
- Local family-plan fixture fix verified; ready to commit and push.

Done:
- Confirmed the failing app-verification file is not part of the PR diff.
- Confirmed the default helper expiry is `2026-07-01T12:00:00.000Z`.
- Changed the default pending invite expiry to stay in the future relative to
  the test run.
- Verification passed:
  - `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/hosted-family-plan.test.ts --no-coverage -t "accepts phone-bound invites only from the invited phone number"`
  - `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/hosted-family-plan.test.ts --no-coverage`
  - `git diff --check`
  - `pnpm typecheck`
- `pnpm --dir apps/web verify` got past app tests, lint, and Next build, but
  local dev smoke timed out/failed in this unlinked worktree.

Now:
- Commit the test fixture fix.

Next:
- Push and wait for GitHub checks to turn green after the remaining ReviewGPT
  fix is committed.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- apps/web/test/hosted-family-plan.test.ts
- agent-docs/exec-plans/active/COORDINATION_LEDGER.md
Status: completed
Updated: 2026-07-01
Completed: 2026-07-01
