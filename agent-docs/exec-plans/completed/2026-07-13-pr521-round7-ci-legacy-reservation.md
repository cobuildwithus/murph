# PR 521 Round 7 CI Legacy Reservation

## Goal

Preserve distinct adjacent Junction daily aggregates while retaining Round 6
historical-owner recovery after an external reference moves.

## Root cause

Historical primary-ref recovery consulted the owner-bearing history index before
honoring the existing in-batch legacy reservation. An adjacent record whose
primary ref was reserved as another record's proven legacy alias therefore
reclaimed the reserved spine and collapsed two records into one.

## Invariants

- A unique moved primary reference still resolves to its current spine.
- An in-batch legacy reservation prevents another entry from claiming that ref.
- Cross-day, cross-account, ambiguous, tombstoned, and user-edited protections
  remain intact.
- No new persisted state or identity layer.

## Verification

- Failing importer reproduction: reproduced, then passed
- Full Junction importer test file: 133 passed
- Focused core legacy/moved-owner/cross-account/ambiguous matrix: passed
- Core and importer typechecks: passed
- Security/privacy/data-integrity specialist: zero medium-or-higher findings
- Coverage-write specialist: no unresolved gap; no test change needed
- Exact-head ReviewGPT and GitHub CI: pending pushed commit
Status: completed
Updated: 2026-07-12
Completed: 2026-07-12
