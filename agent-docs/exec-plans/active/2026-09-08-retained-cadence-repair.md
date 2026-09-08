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

## Smallest correction to investigate

Reuse the existing connection continuation and canonical scheduler. Derive
admission from actual queued scheduled work, retain the original history jobs,
and retire a schedule only after its work is durably represented. Do not relax
equal-cadence compaction alone: that would discard an unexecuted obligation.
Check cadence publication and future wake calculation together with admission.
Do not add a second per-connection continuation or a replacement queue.

## Verification

The focused characterization passes across three renewals and cold restores.
Assistant-runtime typecheck passes. This test intentionally records the current
failure mode and must become a progress regression when the correction is
implemented; it is not intended to establish starvation as desired behavior.

Pending: live diagnostic attribution, a bounded correction, actual provider and
mailbox composition proof, source/disconnect barriers, concurrent foreground
work, exact-head CI and review, protected deployment, and live queue progress.
