# PR 513 ReviewGPT round 3 remediation

Status: completed
Created: 2026-07-10
Updated: 2026-07-10

## Goal

- Close the two independently validated ReviewGPT round-three findings without broadening the one-time campaign architecture.

## Success criteria

- Every paused Start-paid Stripe mutation uses the shared member mutation lock.
- Every ambiguous paused mutation failure or failure after a successful paused mutation enters the existing canonical provider reconciliation path.
- Campaign Apply is documented as blocked until the prior production bundle has drained for the full old-request lifetime plus margin and the production alias is re-proved.
- The rollback floor keeps the lock-capable deployment live through Apply and the zero-work reconciliation dry run.
- Focused regressions, required verification, completion audits, exact-head ReviewGPT, and PR checks pass.

## Constraints

- Reuse the existing member lock, canonical reconciliation owner, and Vercel alias resolver.
- Add no retry layer, durable state, coordinator, or separate lifecycle owner.
- Keep the campaign dry-run default and exact Apply confirmation unchanged.
- Treat the ReviewGPT response as candidate evidence because it reported `MODEL_CONFIRMATION: UNKNOWN`.

## Tasks

1. Route paused cleanup and resume mutations through the existing member lock and canonical fallback.
2. Add production-faithful regressions for post-mutation shape/reconciliation failures and lock serialization.
3. Require a 19-minute prior-function drain, exact production-alias recheck, and explicit rollback floor before Apply.
4. Run required verification and completion audits.
5. Commit, push, rerun exact-head ReviewGPT on Phlebas, and confirm PR checks.

## Decisions

- Accept the paused Start-paid finding: the branch currently returns directly from the paused helper, whose update/resume calls are unlocked and whose post-success failures escape canonical reconciliation.
- Accept the rollout finding: an old production invocation can remain in the pre-lock mutation path for the documented 720-second provider budget after deployment cutover.
- Use the existing null result as the only fallback signal; the top-level service already owns canonical retrieval and reconciliation.
- Use a 1,140-second drain, covering three sequential 360-second provider-operation budgets plus 60 seconds of local completion margin, followed by the existing exact-alias SHA resolver before Apply.

## Verification

- Combined focused Vitest: 170 tests passed across Start-paid, Stripe-event reconciliation, usage allowance, campaign service, and campaign script suites.
- Hosted-web TypeScript check: passed.
- Hosted-web lint: 0 errors and 9 unrelated pre-existing warnings.
- Coverage-write re-audit: clean after adding the successful-cleanup then deterministic-resume-failure regression.
- Security/privacy audit: clean with no medium-or-higher issue.
- Simplify re-audit: clean after widening the production drain to 1,140 seconds.
- Final `pnpm test:diff`: passed, including 4,065 hosted-web tests (9 skipped), dev smoke, and the 181-page production Next.js build.
- Final production-breaking bug hunt: finish-ready with no actionable finding.
- Final task-finish review: finish-ready with no blocker.
- Exact-head ReviewGPT rerun and final PR checks: pending.
Completed: 2026-07-10
