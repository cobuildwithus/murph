# Diet wins and payoff posts

Status: completed
Created: 2026-11-26

## Scope

Generate protein and fiber wins from the member's meal replica. Let the winner
of a recently settled pair game share a payoff photo with that game's players.
This change covers the server contracts and synthetic companion fixtures.

## Decisions

- Use complete daily nutrient sums at their original precision. Qualify months
  at 80% coverage and compare the current month with at least three prior months.
- Keep suggestions sealed. A number-free Diet card removes both grams and icons.
- Retain the game ID on post tombstones and after game deletion. Apply the
  audience during pagination and on every read through the shared post predicate.
- Prepare and seal the payoff outside the transaction. Under member authority
  and the game lock, recheck eligibility and atomically publish the photo, post
  and ticket redemption. A retry returns the original receipt.
- Deploy the migration and game-aware readers before enabling the payoff writer.
  Keep those readers available once the first scoped post exists.

## Verification

- All 800 distinct tests across 33 focused and regression suites passed.
  Local PostgreSQL covered audience changes, concurrent writes, atomic rollback,
  ordinary game redemption and cached Diet offers after generation turns off.
- The feed retained its author index and returned 21 visible rows after 30
  newer posts from other games. The 23-card fixture preserved the original 18.
- The prepared Web typecheck, complexity diff, documentation drift check and
  documentation gardening check passed.
Updated: 2026-11-26
Completed: 2026-11-26
