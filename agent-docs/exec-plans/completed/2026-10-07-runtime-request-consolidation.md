# Consolidate runtime media admission and snapshot checks

Status: completed
Created: 2026-10-07
Updated: 2026-10-07

## Outcome and invariant

Remove redundant Web requests while preserving exact runtime ownership, media
retirement, snapshot identity, and stale-owner rejection. Postgres remains the
only authority; no cache, new durable state, dependency, or retry layer.

## Evidence and existing owners

Runner media GET currently authorizes through the owner endpoint and then reads
through the media endpoint. The existing media transaction already fences writes.
Snapshot abort and selected recovery paths repeat a standalone owner check next
to resource commands that already validate the same identity transactionally.

## Design and scope

- Add `admit_read` with mandatory runtime identity to the existing media command
  union. Reuse its transaction and read implementation. Delete the Worker media
  preflight helper. Preserve legacy `read` only for deployed older Workers.
- Delete redundant snapshot owner calls immediately before transactionally
  fenced deletion/publication. Preserve stale-owner errors during cleanup.
- Leave artifact authorization, device-source freshness, and runtime logs alone.
- No schema changes, production mutations, or user-facing behavior changes.

## Deployment and failure

Deploy compatible Web before Worker. Older Workers retain their standalone
check and legacy read; newer Workers use `admit_read`. Older Web rejects the new
operation rather than silently discarding authority. Web must remain at this
consumer version while newer Workers are active. Remove legacy `read` acceptance
after older Worker versions are drained and excluded from rollback. No new
capability flags or request fallback. Existing resource errors reject stale runs.

## Proof and tasks

1. Extend the media contract and reuse transactional ownership admission.
2. Remove equivalent snapshot preflights and preserve rejection behavior.
3. Prove media call count, stale identities, expiration, rolling compatibility,
   and snapshot retirement races with focused tests, including local Postgres.
4. Run affected typechecks, complexity guard, and parent diff review.
5. Complete scoped commit and required external review/PR checks where available.

## Verification

Implementation and parent review complete. This is internal request consolidation;
no public changelog or assistant-model journey is needed.

- Cloudflare focused outbound, Worker entrypoint, and resource-client suites:
  525 passed. Tests assert one media admission callback, no owner preflight,
  encrypted media round-trip, rejected reads before storage, snapshot abort
  call count, and stale deletion after expired-session cleanup.
- Hosted-execution media protocol: 6 passed, including legacy read acceptance
  and mandatory identity on `admit_read`.
- Web media tests against an isolated loopback Postgres database: 11 passed,
  including stale generation, retired owner, descriptor mismatch, expiration,
  legacy callers, and concurrent read/registration serialization for both commands.
- Cloudflare and Web typechecks passed.
- Previous consumer parser compiled directly from the base commit: accepts legacy
  `read` and rejects `admit_read`. New Worker rejects unsupported operations
  without reading storage or falling back.
- Complexity guard passed; snapshot completion decreased from 58 to 57. Existing
  outbound dispatch (22) and snapshot-ref comparison (22) are unchanged. Further
  broad extraction would add churn unrelated to request elimination.
- Production code has a net deletion. No production rollout performed. PR CI and
  required final external review remain delivery gates, recorded on the PR.

Completed: 2026-10-07
