# Repair scheduled cadence behind retained device history

Status: active
Created: 2026-09-08
Updated: 2026-09-08

## Outcome

Allow due scheduled reconciliation to progress while historical work is waiting,
without dropping the scheduled operation, discarding retained jobs, inventing
history coverage, bypassing source epochs, or creating a second continuation
owner for the connection.

## Evidence and current boundary

A synthetic mailbox reproduction uses one historical resource continuation and
one later plain scheduled wake with the same cadence. Three daily renewals and
checkpoint restores always select the historical owner. The scheduled wake
remains the first unhandled item.

The retained owner owns the connection serialization key. Its future retry
blocks later scheduled work. When it runs, the existing compaction preserves an
equal cadence because copying a timestamp does not prove that its scheduled
operation ran. Provider scheduler admission also excludes wakes with retained
job hints. These guards compose into the reproduced starvation case.

This proves a local failure mode. It does not prove the precise shape of any
production queue. PR #3070 supplies missing provider-readiness and follow-up
diagnostics; its full runner rollout is blocked by the account quota issue
documented in PR #3071. No private operational rows are included here.

PR #3070 is merged at `631970ccd1d23c324a4ebc5a5725361ff62414ec`.
Its final authored head passed all required CI checks and a validated full
ReviewGPT audit. The diagnostic fields are not yet available in running member
containers because the protected full release still needs account capacity.
The existing hosted ops form also requires an authenticated operator session.

## Implementation

The existing connection owner now admits the canonical provider scheduler after
restoring exact retained jobs. The scheduler still owns due checks, active-job
deduplication, and cadence advancement. No new queue, persisted field, protocol
version, provider request, or connection owner is introduced.

The owner's next attempt is the earlier of its actual job retry and a future
cadence. A past cadence after scheduler failure does not create an immediate
timer. Existing source-bound plain schedule hints can admit this owner early;
compaction still requires a strictly advanced cadence before retiring a tick.
Already-due admitted hints share the existing retry backoff after a pass cannot
progress. Bare webhooks and empty completion/dirty-remainder fences still skip
scheduling. Foreground preemption and canonical completion publication are
unchanged.

## Product UX

Effort: Patch.
Outcome: Keep scheduled device refreshes progressing while history waits.
Reaches: Active connected devices with a durable historical continuation;
scheduled and webhook-origin owners, warm retries and cold replacements.
Proof: Real provider scheduler, worker and reconstruction over three cadence
ticks; mailbox checkpoint/restore; scheduler failure and source epoch barriers.
No new member action or reconnect requirement. Provider history readiness is
still upstream-owned and incomplete history is never declared complete.

## Verification

The original synthetic starvation test now checks both advanced cadence and
failed-scheduler backoff across repeated checkpoints. A real Strava scheduler
proof restores the retained payload, retry time, priority and attempts into a
fresh machine-local store at each cadence, executes recent reconciliation,
retains history unchanged, and avoids duplicate scheduling on replay.

Focused runtime checks: 341 passed across the runtime, maintenance and mailbox
suites. Assistant-runtime typecheck passed. Complexity guard passed with no
added debt or maximum increase in any changed source file. Parent candidate
review found no lost-job, duplicate-owner, epoch or foreground regression.
Product UX replay: Ready for implementation; live rollout remains unverified.

Changelog rendering: 10 focused tests passed.
Pending: exact-head CI and ReviewGPT. The full runner rollout and live attribution remain separate from
this PR and remain subject to the capacity blocker above.

## Deployment

Current Web and Worker readers already accept the unchanged mailbox and job
shapes. A full runner release is required. Existing legacy owners recover on a
due job or compatible queued schedule; new owners carry their cadence timer in
existing nextAttemptAt. The old runtime can still parse and retain all jobs,
but reverting behavior would restore scheduler starvation until upgraded again.
No backward migration or data rewrite is required. Post-deploy proof must check
runner image convergence, scheduled frontier advancement, preserved retained
history, and absence of immediate zero-progress cycling.
