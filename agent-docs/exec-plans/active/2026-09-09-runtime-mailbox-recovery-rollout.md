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

## Remaining-head diagnostic probe

The reviewed production release has begun draining the original cohort, but
remaining pending heads are reported only as missing continuation owners. That
classifier describes transfer ownership and does not identify scheduling gates.
Add bounded, fixed boolean diagnostics derived from the already-read mailbox and
validated continuation projection. Report due/recording state, plain/manual hint
shape, epoch agreement, and relative cadence; never log identifiers or payloads.
The log reader keeps only fixed key=true/false scalar strings, including when
status comes from a restored snapshot. The array stays within the existing
16-value wire limit. Round-one ReviewGPT caught an unsupported object-array
representation; direct device and non-device wire-parser tests reproduced that
failure and now pass without changing consumers or parser limits. Use existing progress status and invocation logs;
add no database/provider calls, event types, scheduling decisions, or state owner.
ReviewGPT and required CI must pass before this telemetry is deployed.

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

## Reviewed rollout and follow-up

PR #3082 passed exact-head ReviewGPT and required CI, merged, and entered the
protected production deployment. The compatible Web reader from PR #3084 was
verified Ready on the canonical alias before runner activation. Live telemetry
from PR #3080 confirmed a valid retained-job field was rejected by the old reader.
The original cohort remains the recovery boundary; deployment alone is not closure.

A composed cold-restore regression then proved a second gap: three strictly
covered schedule hints retired only one hint and parked the others behind the
future retained retry. The follow-up derives invocation eligibility from the full
admitted mailbox, while selecting runnable work from the existing frontier. Idle
compaction can therefore retire every eligible covered hint in one checkpoint.
Route, wake-kind, and dedupe-prefix restrictions still apply, and the retained
owner and its jobs remain unchanged. The regression failed before this change
and passes after it, including a second restore without another checkpoint.
