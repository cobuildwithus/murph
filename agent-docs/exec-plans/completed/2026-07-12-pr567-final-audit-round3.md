# PR 567 Final Audit Round 3

## Goal

Close the two validated exact-head ReviewGPT races without adding a lifecycle
state, queue, scheduler, or second provider-effect owner.

## Outcomes

1. Refresh the existing reservation epoch immediately before Retell dispatch,
   and bind reconciliation writes to the exact epoch they observed.
2. Bound post-dispatch database waits by the existing aggregate signal while
   observing late promise settlement and returning the typed durable call id.
3. Preserve the bounded Workflow retry contract; document and directly prove
   why concurrent reconciliation runs cannot create another Retell call.

## Constraints

- Keep `HostedPhoneCall` as the only lifecycle authority and retain the
  `starting | calling | failed` response contract.
- Do not invent a stable Workflow start id unsupported by Workflow SDK 4.2.4.
- Keep each background retry loop bounded with a no-progress exit.
- Do not add dependencies, migrations, queues, schedulers, or lifecycle enums.

## Verification

- Focused fake-clock dispatch-epoch and fake-timer hung-database regressions.
- Concurrent reconciliation idempotency proof.
- Full hosted-web tests, owner and dependent typechecks/tests, lint, diff/privacy
  checks, exact-head CI, and one final changed-head ReviewGPT round.

Status: completed
Updated: 2026-07-13
Completed: 2026-07-13
