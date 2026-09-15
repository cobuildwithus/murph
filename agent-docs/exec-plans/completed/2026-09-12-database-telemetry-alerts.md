# Reduce non-actionable database telemetry pages

Status: completed
Created: 2026-09-12
Updated: 2026-09-12

## Outcome and protected behavior

Brief missing telemetry stays queryable without paging. Six consecutive failed
five-minute collections produce one truthful monitoring alert. Available unsafe
signals still page immediately through the existing hourly provider fence.
Recovery withdraws monitoring evidence that has not entered a pending message;
admitted messages keep their immutable body and recipient idempotency keys.

## Evidence and owner

The Cloudflare database-health monitor currently promotes two failed collections
into a durable obligation and deliberately retains it through recovery behind
the hourly fence. Existing regression tests reproduce that noisy delivery path.
The specific provider omission remains unconfirmed because historical telemetry
access is unavailable; this correction addresses the proven paging policy.
Reuse the existing counter, sample evidence, incident and notification owners.
Read at most five prior failed samples to summarize the six-check threshold.
No new schema, dependency, retry, queue, or provider call is needed.

## Product UX

Outcome: actionable operator notifications with retained diagnostic evidence.
Reaches: brief gaps, sustained gaps, recovery while fenced, concrete pressure,
and ambiguous delivery across restart. Member conversations are unaffected.
Proof: synthetic provider responses through the real monitor and SQLite owner,
including the scheduled Durable Object path where available.

## Tasks

1. Reproduce short-gap and recovered-before-admission behavior in tests.
2. Change the threshold and withdraw only unadmitted recovered telemetry.
3. Update focused regressions and the durable owner documentation.
4. Run focused tests, Cloudflare typecheck, complexity review, and scoped commit.

## Failure and deployment

The persisted shape stays compatible with previous Workers, including existing
two-check obligations. Admitted notifications are retained because delivery may
be ambiguous. Worker-only policy rollout; no Web or warm-container protocol
change. Reverting code restores the earlier noisier policy. No production
mutation or deployment is part of local implementation proof.

## Verification

Ready for the local implementation boundary. Focused monitor, metrics, store,
and Worker routing tests pass (138 tests), as do the scheduled Durable Object
tests in workerd (6 tests) and the Cloudflare typecheck. Synthetic replays cover
the missing Postgres and PgBouncer metrics, five-check gaps across restart,
six-check sustained gaps, recovery behind the hourly fence, and preserved
pressure, connection-error, and ambiguous-delivery behavior.

`pnpm complexity:diff` and `git diff --check` pass. Parent review covered the
full diff, privacy, unchanged persisted shape, and bounded sample reads. The
modified admission hotspot retains its existing complexity; another abstraction
or refactor is not justified by this policy change. Internal operator monitoring
only; no public member changelog. No foreground reply operations are added.

Historical provider root cause remains unconfirmed. Production deployment,
post-deploy observation, and the applicable final ReviewGPT/CI gates for a
pushed PR remain outside this local commit; no live rollout is claimed.
Completed: 2026-09-12
