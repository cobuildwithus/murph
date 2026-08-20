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

- In scope: the narrow explicit Junction profile predecessor transition,
  focused diagnostics if needed, tests, and matching durable documentation.
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
- Reaches: Existing Junction profiles in the released updated-at shape; current
  profiles and unrelated device facts retain their existing journey.
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

## Verification

- Focused Junction explicit-profile migration run passed: 1 file, 4 tests
  (including both malformed-predecessor negative cases), 242 skipped.
- `pnpm --filter @murphai/importers test` passed: 19 files, 551 tests.
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
- The read-only diff reviewer confirmed its member-deletion and member-time
  findings are resolved in the corrected code and regressions.
- ReviewGPT, exact-head CI, merge, deploy, and production convergence remain
  pending under the parent task.
