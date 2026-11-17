# Progress health and friends backend

Status: completed
Created: 2026-11-16
Updated: 2026-11-16

## Outcome

BE2 implements raw wearable trends, frozen baselines, held health/age awards,
Steps routes, Sleep journeys, friends totals and exact-audience additive sharing.
The locked Progress plan remains authoritative. No new table, endpoint, flag,
registry or local preference was added.

## Owners and invariants

- `companion-numbers.ts` owns unrounded canonical daily selection and settled
  Steps. Existing numbers presentation stays above that reader.
- `health.ts` owns D4/D5 coverage, mean/median statistics, held levels, earned
  dates and curated recommendations. Missing dates never become zeroes.
- `norms.ts` ports the iOS age tables and original-device rule. Age awards use
  the join-date bracket, so birthdays do not issue awards. Sleep has no norms.
- Baselines freeze once through the shared compare-and-set writer. Award
  settlement remains append-only and idempotent; corrections never revoke.
- Health authority is checked before/after decryption and at writes. The Steps
  image also rechecks live native/health authority before rendering.
- Friends ranks raw totals using competition ties. Private and invited people
  receive no total, rank, line, gap, award or sharing access. Sharing adds only
  the consented metrics to exactly two-person rooms, preserving other grants.
- Canonical quantity, ladder, route and number-formatting owners are reused.
  Encrypted nested fields and request bounds are classified in ARCHITECTURE.

## Fix round 2

- Rebased the two BE2 commits after the old stacked base onto recorded BE3 head
  `7eebc8b515ba0179ffed1fe7a064c12c00043d02`. Restored BE2-owned files that had
  originally lived in that old base; retained reviewed BE1/BE3 fixes.
- Polled BE3 every two minutes. After its squash merge at
  `da51e062ffe5a65d96a7fd71e61bbef73dd5ec71`, rebased onto main using the recorded
  BE3 SHA. Kept BE3's final renderer-owned style selection during resolution.
- Added required `HealthMetric.next.face`, built with the same owner as earned
  faces; VO2 faces show the target value. Shared formatting keeps +1,400 and
  +2,000 full and compacts +12k, following D20 over illustrative mock labels.
- Populated age `typical` from each supported rank table's median. Added fixed
  recommendation glyphs from the contract's closed list. Removed the redundant
  sleep wording. Sleep remains duration, with no invented score metric.
- Preserved Sleep `projection.on` through BE1's `projection()` and proved it.
- Steps maps use the same settled daily reader and retained join-date sums as
  Health, converted by the existing steps-to-metres owner. No game/walk mixing.
- Added `Route.here` and `Route.drawerHere` from the same geometry cut as the PNG.
  `drawerHere` is the extra requested-screen field: row 07's drawer has a
  different aspect from row 04's card, as BE3's `drawerTowns` already reflects.

## Plan differences and product proof

- Earlier BE2 refinements: `Friends.incomplete` for capped rankings (row 09),
  required sharing `audience` for exact consent (row 16), first-baseline
  preservation and Sleep's ladder selection (rows 06/11).
- Fix round 2 adds only the response refinements above; no new persisted field.
- Product UX: Ready at the backend boundary. Synthetic tests replay improving,
  flat, declining, missing/stale health, missing demographics, phone-only Steps,
  private friends, ties, pending invitations and exact sharing audiences.
- Route tables prove zero/partial/complete dots in both viewports and retained
  completion after shrinking totals. Route contracts prove the shared Steps
  input, live authority loss and one safe failure response.
- Presentation goldens remain illustrative, not D5 scoring inputs; the existing
  Frog record documents that boundary. Native/provider rendering proof remains
  with integration.

## Verification

- Before final rebase, `pnpm test:diff` on all 85 BE2 paths: exit 0 in 812 seconds.
  Web: 15,865 passed, 2,797 skipped; lint, dev smoke and production build passed.
- After final rebase, focused Progress, companion numbers, group-store and Home
  tests: 637 passed, 14 PostgreSQL opt-in tests skipped, exit 0.
- Separate isolated `game-progress-postgres.test.ts`: all 14 passed, exit 0.
  Migration setup and database drop both exit 0. No production access.
- Final `pnpm --dir apps/web typecheck:prepared`: exit 0.
- Scoped Oxlint, `pnpm complexity:diff`, `pnpm docs:drift`, whitespace and privacy
  checks: exit 0. Existing game-service lint warnings are unchanged.
- Initial focused expectations for the shared duration format and a synthetic
  town distance were corrected; the final focused suite passes.
- Required GitHub CI follows the final force-push and Ready transition. No
  ReviewGPT and no merge: both belong to the integrator.

## Release boundary

Deploy after the shared migration and BE3-compatible Worker, then integrate the
native wire fields. The routes have no shipped native caller yet; the integrated
Progress release owns the public changelog. Keep earned awards, baseline state
and unrelated sharing grants intact through rollback.
Completed: 2026-11-16
