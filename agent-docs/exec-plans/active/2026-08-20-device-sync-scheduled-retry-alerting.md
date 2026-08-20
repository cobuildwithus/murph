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
- Each affected workspace has a canonical runtime wake scheduled in the future.
  The runtime stores the earlier of its model-free and assistant candidates, so
  an assistant reason can legitimately win before the retained device retry.
- Before this correction, the progress monitor aged every system-lane head from
  mailbox creation and did not consult the workspace's canonical scheduled wake.
- This makes legitimate multi-hour device retries alert after fifteen minutes,
  even though the runtime has a concrete future owner and execution time.
- A workspace wake covers only the checkpoint-imported system prefix. Applying
  it without the imported frontier could hide a newer durable mailbox suffix
  that never reached the runtime.

All evidence is aggregate or anonymously labeled and contains no production
identifiers.

## Constraints

- The hosted workspace remains the canonical owner of scheduled wake facts.
- Do not advance mailbox cursors, acknowledge dirty state, or create another
  retry owner.
- Suppress only an exact device-sync system head covered by the canonical
  imported-system frontier and a future runtime wake.
- The first live item above that frontier keeps its own creation-time clock;
  malformed or impossible frontier values fail closed.
- Once a scheduled retry is fifteen minutes overdue, the monitor must alert.

## Plan

1. Add PostgreSQL boundary coverage for a future imported device retry, an
   earlier assistant wake, an overdue device retry, unimported head and suffix
   work, malformed frontiers, and a non-device system head.
2. For an imported system-lane device head, age covered progress from the later
   of mailbox creation and the canonical workspace wake time while independently
   aging the first item above the imported frontier.
3. Run the focused unit and PostgreSQL proofs plus Web typecheck.
4. Push an exact candidate, run the required preliminary coverage review and
   final cross-cutting ReviewGPT gate with CI, then resolve all findings.
5. Merge and deploy the Web change, then verify that scheduled device retries
   no longer count as stalls while overdue work remains alertable.

## Verification

- Root cause: proven from current production workspace/mailbox state and the
  progress-monitor SQL.
- Completed locally: focused unit tests, the behavior-focused PostgreSQL cases,
  focused ESLint, and Web typecheck.
- The preliminary specialist's coverage findings are resolved. The complete
  six-case PostgreSQL file passes, including 20,001 qualifying imported device
  heads with live suffixes under an explicit 180-second statement timeout and
  proof that PostgreSQL uses the existing mailbox lane-sequence index.
- Final ReviewGPT, exact-head CI, deploy, and post-deploy production monitor
  proof: pending.
