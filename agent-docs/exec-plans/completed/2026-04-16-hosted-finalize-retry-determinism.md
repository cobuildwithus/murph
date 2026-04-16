Goal (incl. success criteria):
- Prevent stale hosted runner results from writing a second durable commit/finalize transition after a newer run already owns or completed the same event.
- Keep finalize retries deterministic by honoring the active run lease on direct runner-result handling, with focused regression coverage.

Constraints/Assumptions:
- Keep the change narrow to the hosted Cloudflare runner transition path plus focused tests.
- Preserve the existing durable commit/finalize model and sanitized logging.
- Do not change hosted web behavior; the user already fixed the Prisma migration issue separately.

Key decisions:
- Treat the current incident as a stale-run fencing gap on the direct runner-result path.
- Reject obsolete direct runner results before they can persist another durable commit or finalize transition.
- Handle stale direct results as no-op recovery signals rather than ordinary dispatch failures.

State:
- completed

Done:
- Confirmed the duplicate durable commit mismatch came from a later runner result for an event that already had a committed record.
- Reviewed the direct runner-result path in `apps/cloudflare/src/user-runner/runner-dispatch-processor.ts` and the active run lease handling in `apps/cloudflare/src/user-runner/runner-queue-store.ts`.
- Added active-run lease validation for direct hosted commit/finalize transitions.
- Taught the dispatch processor to treat obsolete direct runner results as recovery no-ops instead of retry failures.
- Added focused regression coverage for active-run lease checks and stale finalize-result recovery.
- Verified with `pnpm --dir apps/cloudflare typecheck` and `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/runner-queue-store.test.ts apps/cloudflare/test/user-runner.test.ts --no-coverage`.

Now:
- Nothing pending.

Next:
- Commit the scoped hosted-runner reliability patch.

Open questions (UNCONFIRMED if needed):
- UNCONFIRMED: whether any live incidents also involve the runtime recomputing assistant deliveries during a non-resume rerun, separate from the stale-result path.

Working set (files/ids/commands):
- `apps/cloudflare/src/user-runner.ts`
- `apps/cloudflare/src/user-runner/runner-dispatch-processor.ts`
- `apps/cloudflare/src/user-runner/runner-queue-store.ts`
- `apps/cloudflare/test/user-runner.test.ts`
- `apps/cloudflare/test/runner-queue-store.test.ts`
Status: completed
Updated: 2026-04-16
Completed: 2026-04-16
