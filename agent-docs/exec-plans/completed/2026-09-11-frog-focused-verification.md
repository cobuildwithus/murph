# Make focused verification selection actionable

Status: completed
Created: 2026-09-11
Updated: 2026-09-11

## Goal

Resolve Frog #3293 and #2917: explain ambiguous or empty live-test selectors
before login/provider work, and keep documented focused tests genuinely focused.

## Cause and design

The existing runner already enumerates exact Vitest names but discards them
when rejecting a selector. Reuse that data for a bounded diagnostic list and
provide the existing read-only Vitest discovery command. Do not introduce a
second test discovery owner or change live journey admission.

The changelog guide inserts an extra pnpm separator before the file filter.
Remove it using the repository's direct Vitest invocation convention.

## Scope and invariants

Only local test tooling, its tests, and owning documentation change. Keep the
one-journey requirement, auth selection, provider calls, and model behavior
unchanged. No new state or dependencies. Large ambiguity output shows the first
20 names and the omitted count.

## Tasks

1. Prove missing names/discovery guidance with focused negative cases and the
   existing real Vitest parameterized-title fixture.
2. Add diagnostics at the current selector owner and correct documentation.
3. Run focused tests, tools typecheck, complexity, and docs checks.
4. Review, commit, open the PR draft, admit required CI, and merge after gates.

## Verification

- Four new assertions failed on the original diagnostics, including the real
  Vitest parameterized-title fixture. Both focused files now pass: 11 tests.
- The advertised command successfully enumerates 279 live journeys without
  running a test or checking provider login.
- Tools typecheck passes. `pnpm complexity:diff` passes with zero debt and no
  hotspots; changed-file maximum remains 19. `pnpm docs:drift` passes.
- Parent review confirms bounded diagnostics at the existing owner, preserved
  one-journey admission, and no runtime behavior or provider-input changes.
- Exact-head required CI and merge remain PR delivery gates. Internal-only
  tooling; no changelog, member UX, or final ReviewGPT is required.
Completed: 2026-09-11
