# Device Account Provider Alias Filtering

## Goal

Make `device account list --provider <provider>` return direct provider accounts and aggregator-backed accounts whose active source provider aliases canonicalize to the same public provider identity.

Success criteria:
- `--provider whoop` finds Junction-backed `whoop_v2` sources.
- The matching is provider-generic, so future descriptor aliases work the same way.
- Local daemon and hosted runtime snapshot filters behave consistently.

## Constraints

- Keep storage provenance unchanged: Junction records remain `provider=junction`, source records remain raw source slugs such as `whoop_v2`.
- Use the shared provider descriptor canonicalization seam.
- Do not add provider-specific tables, special WHOOP branches, or broad CLI rewrites.

## Implementation Notes

- Patch local SQLite account filtering.
- Patch hosted Prisma snapshot filtering.
- Add focused tests for direct and Junction alias matches.

## Verification

- Run focused package/app tests covering the changed filters.
- Run typecheck unless blocked by unrelated working-tree state.
Status: completed
Updated: 2026-06-16
Completed: 2026-06-16
