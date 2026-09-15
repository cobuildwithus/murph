# Avoid unnecessary scheduled device reconciliation wakes

Status: active
Created: 2026-09-15
Updated: 2026-09-15

## Outcome and invariants

Avoid ordinary scheduled container work when complete provider content is unchanged, without delaying accepted dirty work, retained jobs, source setup, daily repair, or foreground input. Web owns cadence and admission; the runtime mailbox owns retained jobs and retry deadlines; the provider owns content comparison and repair eligibility.

## Investigation

Trace every preflight exclusion: checkpoint continuation, dirty/mailbox work, source inventory, profile readiness, missing/expired proof, and history/recovery. Use private aggregate diagnostics only in the session. Reproduce proven unnecessary exclusions with synthetic state before implementation. Distinguish ordinary cadence from independently owned continuation deadlines.

## Design constraints

- Prefer removing overly broad checks or deriving existing owner state. No new queue, scheduler, persisted proof format, or provider payload store unless a failing reproduction proves it necessary.
- Preserve locks, revalidation after provider reads, connection epochs, consent, metadata bounds, and complete collection semantics.
- Keep independent continuation schedules and payloads unchanged; missing or malformed authority fails closed.
- Preserve changed-data, source-addition, dirty-payload, history, and day-boundary execution paths.
- No production mutations are part of this implementation task.

## Work

1. Classify exclusions and locate the smallest responsible owner.
2. Add failing synthetic regressions, including concurrent changes and cold recovery where applicable.
3. Fix demonstrated issues and update the durable contract owner.
4. Run focused tests and relevant typechecks, review the complete candidate, and perform required final review.
5. Close this plan and make a scoped commit; report verification and remaining exclusions honestly.

## Verification

Provider preflight and scheduling tests; Web admission/unit and real PostgreSQL race tests; runtime continuation proof if its contract changes; package/Web typechecks; documentation and complexity checks. Any changed production behavior must fail against the base and pass with the fix. Public artifacts contain only synthetic reproduction details.

## Progress

- Fresh isolated checkout created from verified remote main.
- Three reproduced eligibility/storage bugs fixed at their existing owners.

## Reproduction and implementation evidence

- Synthetic tests failed on the original implementation for retained continuation
  eligibility, an explicit empty source inventory, and completion-marker eviction
  after success/failure diagnostic patches.
- Removed the blanket exclusions while retaining bounded continuation validation,
  source/epoch/content binding, mailbox/dirty admission, and final authority CAS.
- Added metadata retention priority separately from historical merge authority;
  the existing envelope remains bounded at 16 scalar entries.
- Focused provider/store/history/hydration/security tests: 160 passed. Web
  preflight/sweeper tests: 44 passed. Real PostgreSQL retained-retry and
  source/checkpoint/mailbox races: 42 passed, including existing retention
  regressions. Package and Web typechecks, documentation drift, and complexity checks passed.
  Parent candidate review is complete; exact-head PR CI and ReviewGPT remain.
- Remaining exclusions are meaningful: outstanding dirty/mailbox work, missing
  or expired baseline, and due profile/history/day repair require their existing
  owner. A fallback count does not prove provider contents changed.
