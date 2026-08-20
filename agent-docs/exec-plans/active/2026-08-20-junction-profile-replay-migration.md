# Junction profile replay migration

Status: active
Created: 2026-08-20
Updated: 2026-08-20

## Goal

- Let profiles written by the preceding Junction timestamp normalizer migrate
  once to the stable creation-time representation without weakening equal-source-
  revision conflict protection.

## Success criteria

- A synthetic predecessor profile whose canonical event time was pinned to
  provider `updated_at` safely migrates to the current `created_at`-pinned form.
- Equal-revision changes to height or other semantic profile content still fail
  closed.
- Member-authored revisions and unrelated device facts remain protected.
- Focused importer/core tests, affected typechecks, ReviewGPT, and exact-head CI
  pass before merge.

## Scope

- In scope: the narrow stable-identity Junction profile predecessor transition,
  exact equal-revision no-ID replay retention required by the account-wide
  admission bump, focused diagnostics if needed, tests, and matching durable
  documentation.
- Out of scope: relaxing generic external-reference conflicts, accepting
  provider revisions with changed values, rewriting unrelated profile
  identities, or mutating production data directly.

## Constraints

- Preserve canonical event-spine ownership and atomic imports.
- Reuse the existing legacy/migration seam; add no second conflict state owner.
- Diagnostics may name bounded diff categories only and must not expose profile
  values, provider identifiers, or member identifiers.

## Product UX

- Effort: Patch.
- Outcome: Existing members' unchanged connected-health profiles converge
  after the timestamp rollout without losing corrections or restoring deleted
  facts.
- Reaches: Existing stable-identity Junction profiles in the released
  updated-at shape. Re-admitted no-ID profiles retain their current event spine
  when the provider revision and semantic facts are unchanged; unrelated
  device facts retain their existing journey.
- Proof: Provider-shaped integration coverage exercises ordinary replay,
  member-edited values and chronology, member deletion, malformed predecessor
  chronology, and real same-revision content changes.
- Walkthrough: Ready. The exact legacy profile migrated once and replayed as a
  no-op; member value and timestamp edits stayed authoritative; deleted facts
  stayed deleted through a later provider revision; malformed and semantically
  changed inputs stopped without changing accepted content.

## Tasks

1. [completed] Reproduce the old `updated_at`-pinned event replaying under the current
   `created_at`-pinned normalizer at the same source revision.
2. [completed] Implement the smallest one-way legacy migration that preserves member edits
   and equal-revision conflict checks.
3. [completed] Add focused canonical round-trip and negative conflict tests.
4. [in progress] Run focused tests, affected typechecks, diff/privacy inspection, ReviewGPT,
   and exact-head CI.
5. Merge, deploy, and verify the repeated profile failure stops without
   changing accepted profile content.

## Decisions

- The repeated `#height` failure is treated as a Murph rollout-compatibility
  defect until the synthetic predecessor/current-normalizer reproduction proves
  or disproves that path; it is not evidence that the provider changed height.
- Generic equal-revision conflicts remain terminal and atomic.
- The synthetic predecessor reaches `EVENT_SOURCE_REVISION_CONFLICT` before
  the fix with an unchanged explicit profile: its external reference and
  `updatedAt` version are identical, while only occurrence and raw observed
  time move from `updatedAt` to `createdAt`.
- The compatibility path is gated by a new stable-profile normalizer marker
  and exact core proof that the generic predecessor differs only by that
  one-way timestamp move. It does not relax the generic equal-revision guard.
- Independent review found that an initial implementation could overwrite a
  member-edited occurrence and covered deletion only at the migration revision.
  The retained member revision now preserves its edit chronology and any
  changed occurrence/day, while a profile deletion remains deleted on a later
  provider revision. Focused regressions cover both paths.
- Parent review further narrowed the released predecessor proof: its
  `recordedAt` must equal the provider revision and its `dayKey` must equal that
  revision's UTC day. Focused negative cases reject either altered field.
- Rollout review raised a second released cohort: explicit profiles already
  stored with created-at timestamps but the generic marker. A direct regression
  proved that equal-revision replay is already a canonical semantic no-op for
  this cohort because normalizer metadata is excluded from the content key. The
  generic diagnostic marker therefore remains unchanged; adding a marker-only
  canonical rewrite would create event-spine churn without changing health data
  or repairing an invariant. Regression coverage now proves the no-op preserves
  member edits and tombstones while a real same-revision semantic change still
  rejects atomically.
- The old-head preliminary specialist pass identified a real proof gap in the
  positive migration scenario: every live facet had a member revision and both
  timestamps landed in the same month shard. The accepted test-only patch moves
  `created_at` into the prior month, adds an untouched provider-owned gender
  facet, and proves old-shard predecessor storage plus new-shard migration.
- Its changelog finding was an evidence-packaging gap, not a product defect. The
  already-verified mobile and desktop artifacts will be named in the corrected
  head's fresh full-snapshot review packet; no UI or copy rewrite is required.
- The old-head final review found a production reachability gap: the importer
  and Core migration could not run for accounts whose one-shot profile marker
  was already current at normalization revision 1. The accepted correction
  advances that existing scalar to revision 2 and strengthens the existing
  reconcile regression to prove a revision-1 account fetches once, records
  revision 2 only after import, and then skips the profile again.
- Final review round 2 found that this account-wide admission bump also
  re-fetched supported no-ID profiles. When an earlier `created_at` appeared
  while `updated_at` stayed unchanged, the timestamp-derived external identity
  changed and Core could append a duplicate, split a member correction, or
  bypass a deletion. Because account metadata cannot distinguish this cohort,
  narrowing admission would require new state or a vault preflight. The
  retrospective therefore keeps the one bounded account-wide refresh, narrows
  the promised migration to stable identities, and treats an exact no-ID
  equal-revision timestamp replay as a canonical no-op on the existing spine.
- The no-ID replay binding uses the existing scoped predecessor index and its
  stored provider baseline, including a latest deletion. It requires an exact
  source/facet scope, valid timestamp-derived identities, equal provider
  revision, earlier incoming creation time, and identical semantic content.
  Ambiguous owners fail as alias conflicts and semantic changes fail atomically
  as source-revision conflicts. The existing strictly newer no-ID identity
  migration remains unchanged.
- Independent challenge review caught that the first new regression seeded a
  synthetic generic predecessor rather than the dangerous current
  `junction-no-id-profile.v1` shape. The corrected regression now starts with a
  normal current-v1 import whose identity is derived from `updated_at`, then
  replays an earlier `created_at` at the same provider revision.

## Verification

- Focused Junction explicit-profile migration run passed after rollout
  remediation: 1 file, 5 tests (the exact old timestamp migration, the
  created-at generic-marker no-op, both malformed-predecessor negatives, and
  deletion retention), 242 skipped.
- `pnpm --filter @murphai/importers test` passed after the no-ID remediation:
  19 files, 553 tests.
- The focused five-test run and the full 552-test importer suite passed again
  after adding cross-month and untouched-provider-facet proof.
- Focused device-sync admission proof passed: 1 file, 2 tests, 319 skipped.
- Focused production-shaped revision-2 no-ID reconcile proof passed: 1 file,
  1 test, 321 skipped. It begins with revision-1 metadata and a persisted
  current-v1 no-ID profile, runs the real bounded scheduled reconcile, retains
  a member height correction and deleted demographics without an event-spine
  append, advances revision 2, skips the replay, and rejects a same-revision
  height change atomically.
- Focused current-v1 no-ID canonical replay proof passed: 1 file, 1 test, 247
  skipped; the combined stable/no-ID profile run passed 8 tests.
- Focused equal-revision no-ID ambiguity proof passed: 1 file, 1 test, 184
  skipped.
- `pnpm --filter @murphai/device-syncd test` passed after the production-shaped
  reconcile regression: 49 files, 1,256 tests.
- `pnpm --filter @murphai/device-syncd typecheck` passed.
- `pnpm --filter @murphai/core test` passed: 46 files, 810 tests.
- `pnpm --filter @murphai/core typecheck` passed.
- `pnpm --filter @murphai/importers typecheck` passed.
- `pnpm docs:drift` passed after updating the durable-doc index entry.
- `git diff --check` passed.
- The task diff and plan passed the direct-identifier, local-path, credential,
  and environment-variable scan.
- Public changelog item `2026-08-20 · stable-junction-profile-replays` records
  the member-visible recovery without private evidence or implementation-only
  detail.
- Focused changelog coverage passed: 2 files, 45 tests.
- `pnpm --dir apps/web typecheck` passed after generating the ignored changelog
  registry and Prisma client.
- `pnpm test:diff` reached and passed every affected package typecheck but found
  two unrelated pre-existing workspace-boundary violations in
  `packages/cli/test/junction-body-composition-e2e.test.ts` and
  `packages/vault-usecases/test/junction-workout-features-query.test.ts`. The
  run was stopped before its broad affected-test phase because this PR does not
  change either file and the focused/full owning-package suites were already
  green.
- The read-only diff reviewer confirmed its member-deletion and member-time
  findings are resolved in the corrected code and regressions.
- ReviewGPT runs started against the pre-regression head are non-authoritative
  for the corrected candidate; the new pushed head requires the normal fresh
  exact-head review gate.
- ReviewGPT, exact-head CI, merge, deploy, and production convergence remain
  pending under the parent task.
