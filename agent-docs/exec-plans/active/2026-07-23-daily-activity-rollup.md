# Repair daily workout rollups and shared activity summaries

Status: active
Created: 2026-07-23
Updated: 2026-07-23

## Goal

- Make a private daily workout summary include every distinct same-day workout
  while suppressing mirrored copies from multiple wearable sources.
- Keep workout duration, broad daily movement, and source freshness as separate
  product concepts.
- Ensure consented group projections and newsletters cannot turn an incomplete
  or stale daily value into an authoritative comparison.
- Make Murph answer daily workout questions from the complete workout rollup and
  avoid unsupported device-sync diagnoses.

## Success criteria

- Two distinct same-day workouts produce two sessions and the sum of their
  durations, even when their source-origin metadata differs.
- A mirrored copy of one workout is counted once.
- Additive workout fields sum across distinct sessions, daily extrema such as
  maximum heart rate use the correct reducer, and daily provider summaries are
  not double-counted with session-derived fallback values.
- Private wearable reads, stored metric projections, and `workout-days.v0`
  consume the same canonical workout-day rollup.
- `activity-minutes` is not presented as broad movement when its evidence is
  recorded workout duration.
- Group reads keep current-day values explicitly provisional, and newsletters
  exclude the open local day from settled comparisons while carrying observed
  day coverage.
- True provider daily-active-duration evidence owns `activity-minutes`; workout
  sessions own `workout-minutes`.
- Focused regressions, truthful diff verification, acceptance verification,
  required product/specialist/final review, CI, and the exact-head PR gate pass.

## Scope

- Wearable activity-session reconciliation and daily query summaries in
  `packages/query`.
- Daily metric catalog/projection semantics in `packages/health-metrics` and
  directly affected query contracts.
- Provider normalization for genuine broad daily activity duration in
  `packages/importers`.
- Consented Vault Share workout/activity projection records and hosted runtime
  refresh behavior in `packages/hosted-execution` and
  `packages/assistant-runtime`.
- Group shared-read/newsletter fact contracts and assistant guidance in
  `apps/web` and `packages/assistant-engine`.
- Focused fixtures, package tests, and durable product/architecture docs needed
  to keep the semantics explicit.

## Constraints

- Preserve all canonical workout records; do not repair the summary by dropping
  a source, disabling a sync path, or weakening ingestion.
- Deduplicate mirrored provider copies before adding distinct sessions.
- Keep group data bounded and consent-scoped. Freshness metadata must not reveal
  account ids, device ids, raw record ids, or ungranted provider details.
- Reuse the existing query and hosted wake/checkpoint owners. Do not add a
  second rollup store, queue, scheduler, or lifecycle manager.
- Preserve compatibility for existing granted scopes and stored snapshots
  across Web/Cloudflare deployment skew.
- Preserve unrelated working-tree and coordination-ledger work.

## Tasks

1. Add failing owner-level regressions for distinct multi-origin sessions,
   mirrored copies, metric reducers, stored projection, shared projection, and
   weekly arithmetic.
2. Implement one overlap-aware canonical workout-day rollup in the query owner.
3. Route private summaries and workout metric projection through that rollup.
4. Separate workout-minute and broad-movement semantics across metric and group
   contracts, with a compatibility-safe migration for existing scopes.
5. Add provisional-day handling and bounded observed-day coverage without
   mistaking projection replacement time for source completeness.
6. Tighten private/group/newsletter assistant guidance so answers enumerate
   complete workout facts and do not speculate about sync state.
7. Preserve the existing checkpoint-before-share-delivery ordering; do not add
   retry machinery because direct evidence rejected a projection failure as
   the cause of this incident.
8. Update current durable docs and complete required verification, reviews,
   commit, PR, CI, and ReviewGPT gates.

## Evidence

- A focused synthetic reproduction selected only one session from two valid
  same-day candidates split by source origin.
- The activity query currently groups sessions by date, raw provider, and full
  data-origin key, then selects one aggregate for session minutes and count.
- The legacy group activity/workout scopes project those selected summary
  metrics rather than recomputing from canonical sessions.
- A narrow read-only production inspection confirmed both source ingestion and
  a refreshed share snapshot without exposing private row contents; this ruled
  out a stale-snapshot-only explanation.
- The supplied evidence also showed that daily extrema could select the wrong
  source, proving reducer semantics beyond duration were affected.
- Existing tests cover same-origin addition and cross-origin winner selection
  separately, but not distinct cross-origin session union through the group
  boundary.
- Projection delivery is already offered after a clean pass and after
  checkpointing dirty/device-sync work. Production evidence showed a refreshed
  bad value, so a new retry owner would not correct this incident.
- Projection `updatedAt` proves only that Web replaced ciphertext; it cannot
  prove source ingestion or current-day completeness and therefore is not a
  safe freshness signal to expose.
- The canonical workout-day reducer now unions distinct same-day sessions,
  suppresses exact, stable-resource, and high-overlap mirrors, and applies
  additive versus maximum reducers per metric rather than selecting one
  source-origin aggregate.
- Direct query reads and stored projection recomposition were compared across
  19,000 generated multi-source cases with no user-visible value, confidence,
  provenance, or source-health divergence.
- Stored current-generation summary rows carry bounded privacy-safe
  reconciliation evidence and consistency fingerprints; malformed, hybrid,
  incomplete, and cross-generation evidence fails closed while legacy rows
  retain their legacy behavior.
- A focused end-to-end synthetic case proved that two distinct sessions are
  added, a cross-provider mirror is suppressed, direct and stored summaries
  agree, internal evidence remains private, and the open local day is excluded
  from settled group-weekly statistics.
- The complete query package passed 648 tests. Focused importer, health-metric,
  hosted-execution, assistant-runtime, assistant-engine, and Web regressions
  also passed with their package typechecks.
- `pnpm test:scenario-integrity` passed for all registered scenarios, sample
  inputs, and golden-output directories.
- Canonical diff verification passed every package in the changed data and
  assistant paths. Its only failures were in the unrelated hosted-local harness
  on a Linux Testbox that could not resolve a container bridge and then
  cascaded through harness-only tests; the task changes no hosted-local harness
  source or tests.
- Canonical `pnpm verify:acceptance` passed in a fresh secret-free Testbox,
  including all workspace typechecks, coverage suites, app builds, security and
  dependency guards, and Cloudflare Worker tests.
- A real Codex app-server turn against the scripted local provider consumed a
  canonical combined current-day workout result, returned the distinct workout
  count and combined duration with a "so far" qualifier, and made no unsupported
  sync or import claim.
- A second real app-server turn called the production `murph.group read_shared`
  tool under the current-chat newsletter execution contract, computed settled
  comparisons from completed days only, and kept open-day values in a separate
  "today so far" aside.
- Local product-experience review found no high, material, or
  experience-collapse issue. The two requested assistant-output proof gaps are
  covered by those focused app-server turns; no rendered UI proof applies
  because no production UI changed.
- A post-rebase range-diff audit confirmed that current group-message behavior
  from `main` remains intact alongside the new semantic gates, additive
  workout-day rollup, provisional-day handling, and non-causal diagnostic
  language.
- Deployment review established a runner-first immediate rollout followed by
  Web from the same commit. Existing unmarked group snapshots converge on the
  next ordinary grantor projection offer; derived browser/query projections
  rebuild normally and no canonical or PostgreSQL migration is required.
