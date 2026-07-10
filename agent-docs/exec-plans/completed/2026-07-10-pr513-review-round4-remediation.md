# PR 513 ReviewGPT round 4 remediation

Status: completed
Created: 2026-07-10
Updated: 2026-07-10

## Goal

- Close the three independently validated ReviewGPT round-four findings without broadening the one-time campaign architecture.

## Success criteria

- A Stripe trial with any scheduled cancellation is skipped before campaign mutation or local reconciliation.
- A campaign update is not dispatched unless a fresh post-retrieve clock proves the original trial survives the complete explicit Stripe update retry budget plus rounding margin.
- Metadata-owned subscription events resolve the member before the canonical provider read/write lock boundary.
- Focused production-faithful regressions, required verification, completion audits, exact-head ReviewGPT, and PR checks pass.

## Constraints

- Use pinned Stripe SDK types and the existing member lookup/lock/reconciliation owners.
- Add no durable state, retry owner, freshness scheme, or broad event lifecycle abstraction.
- Keep campaign output aggregate-only and dry-run by default.
- Treat the ReviewGPT response as candidate evidence because it reported `MODEL_CONFIRMATION: UNKNOWN`.

## Tasks

1. Add canonical Stripe cancellation fields and fail-closed campaign classification with no provider/local writes.
2. Sample time after retrieve and enforce an explicit 361-second update runway tied to 80-second/two-retry request options.
3. Resolve subscription event metadata ownership before entering the existing member-scoped canonical read/write path.
4. Add cancellation, timing-boundary, request-options, and deferred lock-order regressions.
5. Run required verification/audits, commit, push, rerun exact-head ReviewGPT on Phlebas, and confirm PR checks.

## Decisions

- Accept all three round-four candidates after independent code-path validation.
- Skip cancellation-scheduled subscriptions even when campaign-marked. The campaign has not run in production, and a later user cancellation must take precedence over marker-repair reconciliation.
- Keep the pinned Stripe client's two retries but pass its 80-second timeout and retry count explicitly; reject unmarked updates with 361 seconds or less remaining after the canonical retrieve.
- Reuse the existing subscription metadata lookup and outer member lock; do not add a second lock or event freshness mechanism.

## Verification

- Focused campaign, billing, and Stripe reconciliation suites: 178 passed.
- Hosted web typecheck: passed.
- Hosted web lint: passed with 0 errors and 9 unrelated existing warnings.
- Completion coverage re-audit: clean; audit run passed 61 tests.
- Security/privacy audit: clean; no medium-or-higher finding.
- Simplification re-audit: clean.
- Full `pnpm test:diff`: passed (4,074 tests passed, 9 skipped; dev smoke passed; production build generated 181 pages).
- Task-finish review: clean and ready to archive/commit.
- Final production-breaking bug hunt: clean; no reachable production-breaking or material correctness finding.
- Exact-head ReviewGPT round five and PR checks: pending.
Completed: 2026-07-10
