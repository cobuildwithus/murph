# Recover stalled runtime mailboxes

Status: active
Created: 2026-09-09
Updated: 2026-09-09

## Outcome and authority

Continue diagnosis, metadata-only telemetry improvements, reviewed fixes, and
production deployments until every workspace in the original incident cohort
has recovered. The user requires ReviewGPT to pass before deploying potential
fixes. This extends the completed local implementation plan without changing it.

## Completion proof

Track the original cohort through live control rows and bounded runtime logs.
Recovery requires the original pending obligations to be handled or transferred
under valid durable continuation ownership, continued progress on remaining
work, and no repeating idle or failed-owner loop. Expiration from an alert
window, a green deploy, and passing tests alone do not prove recovery.
Private cohort identifiers stay outside repository artifacts.

## Execution

1. Revalidate the committed device-frontier fix and current production evidence.
2. Open its PR, launch exact-head ReviewGPT concurrently with CI, resolve findings.
3. Merge and deploy only after ReviewGPT passes and required checks are green.
4. Verify the admitted runner release and each original workspace's recovery.
5. For remaining failures, add the smallest useful safe diagnostics, prove the
   failing owner, and repeat the review/deploy/readback loop.

## Boundaries

Preserve foreground priority, active device work, retry timing, connection
authority, checkpoint fencing, and the existing scheduling owners. No production
secrets or private payloads enter local code, fixtures, or review artifacts.
No new state owner or manual acknowledgement of unfinished mailbox work.

## Starting evidence

The prior local commit has four regressions that fail against its base and pass
with the fix, 353 passing runtime tests, runtime and Web typechecks, ten passing
changelog tests, and a passing complexity guard with unchanged file debt.
The new live readback still shows the original failure pattern. Exact-head CI,
ReviewGPT, deployment, and production convergence remain pending.
