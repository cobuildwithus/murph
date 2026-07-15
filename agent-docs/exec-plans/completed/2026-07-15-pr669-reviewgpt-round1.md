# PR 669 ReviewGPT round 1 repair

Status: completed
Created: 2026-07-15
Updated: 2026-07-15

## Goal

- Complete ordered hosted audit receipt recovery when replaying the first
  receipt makes a later valid receipt's historical byte prefix differ.

## Constraints

- Keep immutable audit ID/content as the audit replay identity.
- Add no sequence reconciler, state, service, configuration, or compatibility
  layer.
- Preserve strict byte-prefix replay for every non-audit JSONL target.
- Replace redundant single-receipt success tests with one ordered two-receipt
  regression covering both missing and already-present earlier records.

## Review disposition

- Accepted: round 1 proved that the later receipt can still fail before the
  audit helper runs when its chained base is no longer the physical prefix.
- Rejected implementation suggestion: a receipt-log sequence reconciler would
  duplicate audit identity semantics and add another owner. The smaller fix is
  to route audit base-hash drift through the existing schema/ID validator.

## Verification

- Focused core operation suite and core typecheck.
- Core owner coverage, diff hygiene, exact-head PR CI, and ReviewGPT round 2.

## Outcome

- Collapsed three physical-position branches into one normal byte fast path and
  one audit-only schema/immutable-ID fallback. This deletes more production
  branching than the remediation adds.
- Replaced two one-receipt success tests with one ordered two-receipt test that
  covers both missing and already-present earlier records, repeated replay, and
  a later physical record shorter than the first receipt's chained base.
- Focused core suite: 42/42 passed. Core typecheck passed. Core coverage:
  706/706 passed with thresholds green. `git diff --check` passed.
Completed: 2026-07-15
