# Challenge standings Messages card

## Goal

Add one bounded response-card contract that can represent the three existing group-challenge formats and can be rendered by the Murph iOS Messages extension without introducing a second challenge-state or scoring owner.

## Decisions

- Reuse the existing response-card delivery path and inline Messages URL.
- Add one `challenge_standings` card kind rather than separate leaderboard, team, and progress card kinds.
- Keep scoring and evidence semantics on the existing challenge page/scorer boundary.
- Encode partial scores as verified lower bounds and missing scores as unscored, never zero.
- Keep the card immutable and offline; refreshes are new snapshots.
- Bound ranked cards to eight entries and the full URL to less than 2,048 characters.

## Verification

- Contract tests cover all three formats, ordering, ties, nullability, text bounds, row bounds, unknown keys, and aggregate URL size.
- Operator-config tests cover semantic fallback text, Linq layouts, and the exact schema-version-4 envelope consumed by iOS.
- Existing nutrition and compact-table schema assertions remain additive through `arrayContaining`.
