# Honor Scheduled Device Retries In Runtime Progress Alerts

Status: active
Updated: 2026-08-20

## Goal

Stop the hosted runtime progress monitor from reporting deliberately retained
device-sync mailbox work as stalled while preserving alerts for retries that
remain unhandled after their scheduled execution time.

## Production Evidence

- The remaining Junction dirty connections are imported into their hosted
  workspaces and retained behind the system handled-through frontier.
- Each affected workspace has a typed `device-sync.reconcile` wake scheduled in
  the future. One checkpointed within the current observation window; the
  others are on the bounded device-provider retry ladder.
- The progress monitor currently ages every system-lane head from mailbox
  creation and does not consult the workspace's canonical scheduled wake.
- This makes legitimate multi-hour device retries alert after fifteen minutes,
  even though the runtime has a concrete future owner and execution time.

All evidence is aggregate or anonymously labeled and contains no production
identifiers.

## Constraints

- The hosted workspace remains the canonical owner of scheduled wake facts.
- Do not advance mailbox cursors, acknowledge dirty state, or create another
  retry owner.
- Suppress only the proven typed device retry case.
- Once a scheduled retry is fifteen minutes overdue, the monitor must alert.

## Plan

1. Add PostgreSQL boundary coverage for a future typed device retry, an overdue
   typed device retry, and an unrelated future wake reason.
2. For system-lane `device-sync.reconcile` work, age progress from the later of
   mailbox creation and the canonical workspace wake time.
3. Run the focused unit and PostgreSQL proofs plus Web typecheck.
4. Push an exact candidate, run the required preliminary coverage review and
   final cross-cutting ReviewGPT gate with CI, then resolve all findings.
5. Merge and deploy the Web change, then verify that scheduled device retries
   no longer count as stalls while overdue work remains alertable.

## Verification

- Root cause: proven from current production workspace/mailbox state and the
  progress-monitor SQL.
- Focused tests, typecheck, ReviewGPT, CI, deploy, and post-deploy production
  monitor proof: pending.
