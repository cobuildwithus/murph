# Verify Linq idempotency and outage recovery timing

Status: active
Created: 2026-10-08
Updated: 2026-10-08

## Goal

Recheck the local recovery design against current provider documentation and
prove actual elapsed-time behavior under synthetic transient outages.

## Success criteria

- Distinguish retrying one request from replacing a definitively failed message.
- Exercise persisted due times using a controlled clock and real local Postgres.
- Preserve current owner, scheduler and all dispatch safety fences.

## Scope and constraints

- Provider review and local proof first; authorized PR, ReviewGPT, CI, merge and
  documented production release follow. No historical resends or live customer failures.
- Keep prior completed plans immutable and private support correspondence out of source.

## Decisions

- Current Linq send documentation returns the original response for a processed
  key. Its 4006 page explicitly describes reuse returning a stored failed message
  without sending. Retain stable per-attempt keys and fresh replacement keys after
  definitive 4001 no-send failures. No production code correction is required.
- Timeout guidance is not proof of no delivery; retain the stricter ambiguity fence.
- Three minutes is the dispatch window from original recorded acceptance, not
  from first failure or last retry, and not a final-delivery deadline.
- Synthetic timing tests cover both prompt and 30-second terminal-failure reporting,
  a 45-second outage, and a longer outage that exhausts the time budget first.
- Synchronous POST errors remain closed. A provider outage description alone does
  not prove a failed HTTP call created no message or was never processed.

## Tasks

1. Verify public provider idempotency contract.
2. Add elapsed-time Postgres recovery scenarios and clarify the owner contract.
3. Completed: focused proof (95 tests) and local Web typecheck.
4. Publish draft PR, finish exact-head ReviewGPT and CI, and remediate findings.
5. Merge and release through the protected migration/deployment owners, then verify
   exact deployed revisions and non-destructive production health.

## Verification

- 95 targeted tests passed across terminal retry Postgres, request and workflow tests.
- New controlled-clock tests advance to persisted due times without editing timers.
  A 45-second outage recovers at 56–70 seconds with prompt terminal failures,
  or 84–90 seconds when each terminal failure takes 30 seconds.
- A persistent outage with 30-second failures stops after three replacements:
  the time budget wins before a fourth replacement. Original acceptance anchors expiry.
- Web typecheck passed. Production behavior and key derivation are unchanged.
- Prior full local evidence: 359 tests across nine files, migration, schema,
  typecheck, complexity and Workflow compilation passed.
- Exact-head CI, ReviewGPT and production release verification pending.
- PR #4108's first CI run identified the production migration guard's explicit
  admission requirement for defaulted non-null columns. Use its existing
  per-migration compatibility map; do not relax the SQL classifier. Actual SQL
  against connection-local PostgreSQL tables proves preexisting rows and old
  inserts receive zero count, empty history and null recovery pointers.
- Correction proof: 151 focused migration/retry tests, guarded local migration
  deploy, Web typecheck and complexity check passed. The initial review remains
  bound to its original snapshot; the corrected head needs the next review.
