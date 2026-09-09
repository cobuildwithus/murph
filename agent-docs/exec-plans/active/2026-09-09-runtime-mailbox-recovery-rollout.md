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

## Deployment propagation follow-up

The batch fix passed review, required CI, signed smoke, and live release
convergence. Pending-head telemetry passed review and CI but its staged Worker
activation failed the five-attempt public version check. A subsequent public
read returned the expected version. Rebuilding the same public and private
sources produced a different bundle fingerprint, so the existing pending
candidate correctly prevented silent replacement. The protected Worker-only
path retires that interrupted candidate into retained history before a fresh
full release; it does not count as runtime recovery.

Extend only the existing version-mismatch retry bound from five to thirty
attempts at the existing two-second interval. Synthetic propagation through
attempts six and thirty fails before the correction; all 56 smoke tests and the
Cloudflare typecheck pass afterward. Persistent mismatch still fails at the
bound, while HTTP errors and malformed metadata still fail immediately.
ReviewGPT and exact-head CI remain required before deploying this correction.
The original workspace cohort remains the completion boundary.

## Non-scheduled hint diagnostics

The propagation correction passed exact-head review and CI. The supported
Worker-only reconciliation and subsequent full release both passed all protected
gates, signed smoke, and convergence. Pending-head diagnostics now reach live
invocation logs. They distinguish valid retained ownership from a non-plain
pending hint, but cadence flags do not explain non-scheduled hint shape.

For non-scheduled device wakes, replace the five cadence flags with fixed
booleans for jobs, scopes, revoke warning, supported hint reason, and pending
checkpoint record. Scheduled wakes retain the existing cadence diagnostics.
Keep the same sixteen-value limit and fixed-value allowlist; disclose no payload
values and change no scheduling or acknowledgement behavior. Six synthetic
shape cases fail before this addition. Direct checkpoint, invocation, and log
wire-parser coverage must pass before exact-head review, CI, and deployment.

## Companion dirty-hint recovery

The companion metadata and RMSSD producers persist work through the same dirty
state and payload owner as webhook imports, but label their hints with two
distinct reasons. The mailbox plain-hint predicate accepts neither reason, so
an admitted retained owner leaves these otherwise redundant hints queued behind
its next retry. Four checkpoint/restore regressions reproduce that difference
with the two canonical producer reasons, acknowledgement retry, and a newer
dirty revision; the ordinary hint controls pass.

Recognize those two existing reasons in the shared plain-hint reason predicate
and use that predicate in diagnostics. Preserve explicit jobs, scopes, revoke
warnings, unknown reasons, epoch barriers, active retry work, and checkpoint
acknowledgement. Do not infer incident recovery from this synthetic proof: verify
the diagnostic release against the original cohort and then verify the reviewed
fix after its protected deployment. The overall recovery plan remains active.

## Deferred-hint admission

The companion reason correction passed review and required CI. Cold-restore
proof then showed that previously deferred plain hints still wait for the old
owner retry time. Six otherwise-identical deferred cases fail against that
correction while their non-deferred controls pass.

After normal runnable-work selection, reuse the existing compactor as a pure
eligibility proof before readmitting a validated retained owner. Admit only an
owner already inside the invocation selection whose admission can retire an
eligible webhook hint. Preserve explicit-work barriers and job availability;
do not retire idle dirty hints without owner execution. The composed cold
restore fetches dirty state once, preserves the future history job, and its
second restore adds no provider calls. Filter, invalid-projection, substantive
barrier, checkpoint retry, newer-revision, and foreground-preemption proof
remain required before review and deployment.

### Inactive-target pagination diagnostics

- Two protected deployment attempts rejected provider pagination evidence before
  native target admission or Worker activation. The existing error did not
  distinguish its four token rejection conditions.
- Keep every drain acceptance condition unchanged. Report only the fixed rejection
  category, page count, native row count, and oversized token length. Never emit
  cursor contents, application identity, or provider response bodies.
- Seven synthetic diagnostics assertions fail against the prior generic error;
  existing drain, pagination, admission, and provider-error redaction tests remain
  the regression surface.
- Read-only standard-provider pagination reproduced a repeated cursor with small
  pages. A larger bounded page returned terminal evidence. Request 1,000 rows per
  page while preserving complete traversal, stopped-native checks, cursor-cycle
  rejection, native-row/page/deadline bounds, and fail-closed activation.
- A reviewed protected deployment must verify the mitigation and release receipt;
  larger pages reduce exposure to the provider cycle without treating it as drain.

## Independent maintenance during due device work

The reviewed companion-hint and deferred-admission corrections, with the bounded
pagination mitigation, passed all protected gates, smoke, and native convergence.
Live invocation evidence now confirms original backlog recovery on that source.
The remaining active-device lane also exposed a due, untouched maintenance head.

The existing independent-maintenance regression covers a future device retry.
Changing only its retained job and owner to due reproduces the untouched head:
oldest-item selection chooses the transferred owner on every pass. Prefer an
eligible non-device item only when normal selection would choose a validated,
pending device continuation without a checkpoint record. Reuse the existing
filtered selector and preserve recording priority, future work, invalid ownership,
substantive device frontiers, and foreground preemption. No new queue or clock.
The composed regression must checkpoint independent progress with the exact
retained job unchanged and still due for the following pass.
