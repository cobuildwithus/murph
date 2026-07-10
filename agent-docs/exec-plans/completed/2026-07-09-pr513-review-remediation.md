# PR 513 ReviewGPT remediation

Status: completed
Created: 2026-07-09
Updated: 2026-07-10

## Goal

- Preserve the fixed seven-day Pulse Trial beta extension while eliminating the paid-conversion race and collapsing the one-time browser surface to the repository's production-script pattern.

## Success criteria

- Apply and marker-retry paths re-read current local and Stripe state under the shared member row lock and reconcile billing/usage ends before releasing it.
- A concurrent Start paid Pulse transition cannot be followed by a stale local trial restoration.
- Any post-dispatch failure in Start paid Pulse enters canonical Stripe reconciliation rather than returning an unclassified server error.
- The one-time campaign is dry-run by default, requires `--apply` plus the exact campaign key, and emits aggregate output only.
- Focused regressions, required verification, audits, ReviewGPT, and PR checks pass.

## Constraints

- Keep Stripe as billing authority and preserve trial start, usage spend, block state, and ledger history.
- Add no durable state, queues, managers, or broad transition abstraction.
- Delete the transient Ops page/API and their UI/route-specific tests and docs.

## Tasks

1. Move extension reconciliation inside a locked, freshly re-read candidate boundary and cover paid-conversion interleavings.
2. Make post-dispatch Start paid lock/transaction failures reconcile through Stripe.
3. Replace the one-time page/API with a confirmed dry-run/apply script and focused tests.
4. Run scoped/full verification and required re-audits, close the plan with a scoped commit, push, and rerun ReviewGPT.

## Decisions

- Reuse the existing hosted-member row lock; do not introduce another coordinator.
- Keep campaign idempotency in the existing Stripe metadata marker.
- Treat ReviewGPT's proposed broad owner abstraction as unnecessary; the narrow campaign owner will revalidate and write within its existing transaction.
- Hold the shared lock through Stripe and local reconciliation with a 780-second transaction timeout, covering the pinned Stripe client's 720-second worst-case retrieve-plus-update retry budget plus database/lock margin.
- Resolve and enforce the configured `launch_monthly` price before mutation; allow only the canonical legacy metered companion item.
- Deploy the shared locking behavior before running the one-time production script.

## Verification

- Focused Vitest: 55 tests passed.
- Web TypeScript check: passed.
- Focused ESLint: passed.
- Operator script help and fail-closed confirmation checks: passed.
- `pnpm test:diff`: passed, including 4,049 hosted-web tests (9 skipped), ESLint with 0 errors and 9 pre-existing warnings, and the Next.js production build.
- Coverage-write, frontend, security/privacy, simplify, and task-finish re-audits: passed after accepted corrections.
- Final bug hunt: passed with no actionable production blocker.
- Latest-main rebase verification, pushed-head ReviewGPT rerun, and PR checks: pending.
Completed: 2026-07-10
