# Respect fresh mailbox arrivals during usage pauses

Status: active
Created: 2026-10-21

## Outcome and protected invariant

An imported assistant notification paused by the canonical usage gate must not
become a stall merely because fresh mailbox work arrives. Unimported work that
reaches the existing 15-minute boundary must remain alertable. Import evidence
does not acknowledge work or prove handling.

## Owner and evidence

The Web progress monitor currently requires the imported sequence to equal the
entire durable high water before checking usage. Its existing synthetic
notification/device fixture reproduces the false alert when a fresh device row
is appended. Production evidence remains private.

## Smallest correction

Derive the highest live pending sequence already at least 15 minutes old within
the existing pending-row window query. Permit the existing read-only usage
exclusion only when a valid imported frontier covers that aged prefix and the
notification head. Add no state, query round trips, execution authority, or
runtime recovery. Keep unknown evidence, model-free heads, unavailable allowance,
and exhausted bounded allowance-read budgets alertable.

## Verification and deployment

- Unit proof: fresh suffix suppression, aged suffix alerting, invalid frontiers,
  restored allowance, and existing bounded serial gate reads.
- PostgreSQL proof: actual query, exact age boundary, newer arrivals cannot hide
  an older unimported row, and import completion restores intentional pause.
- Run focused monitor tests, Web typecheck, complexity guard, and parent review.
- Web-only change with no schema or wire migration; older/newer runners remain
  compatible. Production rollout is separate from local proof.
- Operator-only correction; no member-visible behavior or changelog entry.

## Progress

- The new unit scenario and real PostgreSQL regression failed on the original
  monitor and pass with the correction.
- All 50 monitor unit tests and all 14 PostgreSQL tests passed on an isolated,
  current-schema local database. Web typecheck passed.
- Complexity guard passed: maximum changed-source complexity remains 16;
  no hotspots exceed 20. Parent diff/privacy review found no additional changes.
- External review and exact-head CI remain pending; no production mutation.
