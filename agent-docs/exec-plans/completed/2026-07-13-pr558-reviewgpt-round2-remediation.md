# PR 558 ReviewGPT round 2 remediation

Status: completed
Created: 2026-07-13
Updated: 2026-07-13

## Goal

- Resolve the three accepted exact-head ReviewGPT findings without adding a
  second membership, cleanup, delivery, or orchestration owner.
- Keep inactive routed-group leave self-service, replay-safe across explicit
  rejoin, and visibly acknowledged without assistant or model execution.
- Finish PR #558 on current `main` with focused verification, required CI, and
  a clean exact-PR-head ReviewGPT round.

## Findings and required outcomes

1. A consumed duplicate provider event must be mutation-terminal; it must never
   call the leave transaction again after a participant explicitly rejoins.
   An unconsumed accepted duplicate may still finish the transaction.
2. Share-revoke mailbox rows committed by inactive leave need an immediate
   pointer-only Temporal signal into the existing workspace, while durable
   reconciliation remains the backstop. This signal must not admit conversation
   input, create a workspace, or run assistant/model/provider runtime work.
3. Every recognized inactive leave outcome needs one deterministic,
   server-authored Linq result. Delivery must remain bound to the current route,
   use the provider event id for idempotency, and revalidate any membership-state
   claim so delayed delivery cannot contradict a rejoin.

## Scope

- Web inactive Linq leave planning, post-commit wake ordering, Linq result
  transport, mailbox/system-pointer helpers, focused tests, and the durable group
  departure/Temporal contracts.
- No new database state, scheduler, queue, assistant notification, model call,
  read receipt, or generic inactive-runtime provider permission.

## Tasks

1. Make consumed duplicate evidence terminal and preserve unconsumed completion.
2. Carry one durable cleanup item through the existing webhook handoff and add a
   narrow existing-workspace system-only Temporal signal helper.
3. Add post-handoff deterministic result delivery with route, idempotency, and
   current-membership guards.
4. Add replay/rejoin, signal-boundary, ordering, store, and transport regressions;
   update durable docs and index routing.
5. Run Web tests/typecheck/lint and repository guards, finish the scoped commit,
   merge any newer `main`, push with an exact remote-head lease, and run
   ReviewGPT concurrently with CI on the exact pushed head.

## Verification

- Six focused Web files passed 173 tests; the final transport recheck passed 42
  tests including inactive-route dispatch, rejoin suppression, and route
  rebinding rejection.
- The full prepared Web suite passed 4,910 tests with 135 expected skips.
- Prepared Web typecheck and scoped ESLint passed.
- `pnpm docs:drift`, `pnpm hosted-temporal:guard`,
  `pnpm test:scenario-integrity`, and `git diff --check` passed.
- Exact pushed-head CI and ReviewGPT remain the post-commit merge-readiness
  gates.
Completed: 2026-07-13
