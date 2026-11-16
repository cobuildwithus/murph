# Progress health and friends backend

Status: active
Created: 2026-11-16
Updated: 2026-11-16

## Goal

- Implement the locked Progress BE2 lane: health wins and sums, age ranking,
  friends totals, and additive pair-room health sharing.

## Success criteria

- Raw values drive D4/D5 coverage and earned dates; missing days stay missing.
- Health authority holds before/after decryption and at every health write.
- Friends rank unrounded totals; private rows disclose no amount or chart.
- Existing numbers wire and other pair-board grants remain unchanged.
- Focused contracts, diff-scoped verification, typecheck and lint pass.

## Scope

- In scope: raw health reader, pure health/norm functions, friends, three routes.
- Out of scope: new storage owners, BE1 games/ladders, BE3 maps/media, iOS.
- Necessary BE0 seams: immutable baseline merge, incomplete friends responses,
  and exact consent audience echoed by the sharing request.

## Constraints

- Reuse BE0 types and writers after its branch is published; never duplicate them.
- Typed inputs below route parsing, no retry or swallowed failure, no new flags.
- Health is bounded to the 365-day replica. Baselines and awards use sealed state.
- Commit and open a draft PR, ready after checks; no merge or ReviewGPT here.

## Risks and mitigations

1. Display rounding can mint false wins. Extract raw selection below presentation.
2. Sharing grants belong to a room. Recheck the exact two-person audience and add
   only Steps/Sleep at the existing sharing owner.
3. Concurrent authority/state changes. Use BE0 compare-and-set and transaction
   authority checks; perform external work outside transactions.

## Tasks

1. Read owners and mock rows; extract the raw reader and port age norms.
2. Rebase onto BE0; implement health derivation and writes against its contracts.
3. Implement friends ranking and additive sharing, then route/view contracts.
4. Prove invariants, review the candidate, commit, push and open the PR.
5. Integrate published BE1 series/bank and BE3 route views; rebase onto main
   after the integrator requests it, then mark Ready. Health goldens stay as
   presentation examples; D5 route assertions remain authoritative.

## Decisions

- The locked plan takes precedence over illustrative mock numbers.
- Product UX: new, sparse, stale, improving, flat and declining health; ties,
  private friends and pair versus group sharing. Contract tests replay these
  journeys through the API. Native rendering is owned by the iOS lanes.

## Verification

- Fix-round `pnpm test:diff` across the eleven touched paths: exit 1. The full
  Web suite passed 15,740 tests and skipped 2,794; its only failure was the
  unchanged Google KMS retry-backoff deadline test (plus its unhandled rejection).
  The standalone KMS file then passed all 32 tests, exit 0. That isolated pass
  does not replace broad proof; the production build was not reached. Frog
  records the timer race. Keep the PR draft with this verification hold.

- Fix round: 145 tests across ten focused Progress and Home-view files, exit 0.
  Seven-date tables cover wearable anchors, absent/old Sleep, phone-only data,
  and the member-local midnight boundary. Cohort and route contracts cover
  pending known/unbound invitees, expiry, cancellation, joining, blocks and
  exclusion from totals, charts, awards and sharing.
- Fix round: Web typecheck and final prepared typecheck, scoped lint, complexity,
  docs drift and whitespace/privacy review all pass, exit 0. Existing lint
  warnings in the game service are unchanged.
- Fix-round Product UX: Ready at the backend route boundary. Rows 14 and 05
  now follow the integrator's decisions. D5 scoring and presentation goldens
  remain unchanged. Native/deployed proof remains with the integration lanes.

- Final integrated `pnpm test:diff` on the 56 BE2/integration paths: exit 0.
  Web: 15,713 tests passed, 2,794 skipped; production build passed. Its final
  Web typecheck and repository boundary checks passed.
- Focused Progress/companion suite: 409 tests across 25 files, exit 0.
  Subsequent cap recheck/route contracts: 14 tests, exit 0. Map/picture/health
  contracts after the workspace import repair: 29 tests, exit 0.
- PostgreSQL: 45 tests across Progress and existing pair-board contracts,
  exit 0. All migrations applied to an isolated task-owned database, which was
  removed afterward. Computed patches preserve the first frozen baseline.
- Scoped lint, complexity, docs drift, workspace boundaries and whitespace
  checks: exit 0. New functions remain at or below complexity 20.
- Age norms byte comparison against the original iOS resource: exit 0.
  Twenty-one shared Swift golden cases and separate interpolation tests pass.
- The first integrated diff check found two direct Zod imports in BE3 files.
  They now use the contracts namespace export; affected checks and the final
  diff selector pass. The earlier friends empty-line assertion was corrected.

## Progress and integration holds

- BE0 is integrated at `9ceaa81ba4cec07d94f1280f8e9634b793053e8d`.
  Its PR remains open; the requested main rebase follows its merge.
- Implemented raw health selection, D4/D5 scoring, frozen baselines, age norms,
  recommendations, bounded sums, three routes, friends ranking/awards and
  additive exact-audience sharing. No additional endpoint, table or flag.
- All eleven friends golden views match BE0. The not-connected health golden
  is replayed through the route. Other health goldens contain illustrative
  500/1,400-step awards that conflict with D5's 1,000-step levels; preserve D5
  as authoritative scoring; the goldens remain presentation examples.
- Integrated BE1 #5063 and BE3 #5060 dependencies locally. Steps now uses the
  shared route owner and Sleep uses its own curated time ladder (rows 07/11).
  Generic medal presentation carries health, age, friend and route awards.
  Zeroed corrections preserve stored journey achievements.
- Post-decryption room caps propagate to `Friends.incomplete` and withhold all
  ranking data; the route contract verifies that response.
- Friends uses BE1 task normalization and contribution rules, including per-day
  quantities for historical posts. Typed quantity payloads alone are decrypted.
  The shared state writer preserves frozen baselines and computed route patches.
- BE3 owns the remaining map route/style delivery; this lane composes its private
  map path and frozen geometry, with provider calls mocked in route contracts.
- Fix round: derive missing wearable metrics as off when HR/VO2 evidence exists
  in the last seven member-local dates; no OS permission input or persisted state.
- Fix round: include current unjoined invitees using Home's sealed label owner.
  They receive no total, rank, chart, award or health-sharing access. Cancellation,
  expiry, joining and block changes are rechecked at the existing read boundaries.
- Product UX patch: Outcome: resolve rows 14 and 05. Reaches: phone-only and
  wearable members, pending and joined friends. Proof: date-boundary tables,
  cohort transitions and private route contracts. No new table, endpoint or flag.
- Integration handoff: the integrator requested no main rebase until BE1/BE3
  merge. The backend fixes are implemented; the integrator will request that
  rebase separately and owns ReviewGPT, merge and native/deployed proof. Keep
  this plan active while the broad verification hold and integration remain.
- Changelog: integrated native Progress release owns the member-facing entry;
  these backend routes alone have no shipped client caller.
