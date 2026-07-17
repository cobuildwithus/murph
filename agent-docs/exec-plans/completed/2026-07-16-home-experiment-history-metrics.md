# Compact home experiment history metrics

Status: completed
Created: 2026-07-16
Updated: 2026-07-16

## Goal

- Make completed experiment cards on `/home` substantially more compact while
  showing the run's measured outcomes instead of reducing a multi-metric run to
  one arbitrarily selected trend.

## Success criteria

- Completed history cards remove redundant baseline/latest and completion UI,
  keep the full card as the navigation target, and occupy materially less
  vertical space on desktop and mobile.
- A completed run with several comparable outcome signals shows each concise
  metric delta, preserving primary-first source order and honest sentiment.
- Active and paused experiment cards retain their progress-first treatment.
- Focused tests, truthful scoped verification, desktop/mobile browser proof,
  required frontend and coverage audits, second-model UI review, parent final
  review, scoped commit, and PR gates complete with no unresolved findings.

## Scope

- In scope: the `/home` experiment-history card projection, rendering, focused
  tests, and any narrow durable design-system documentation needed to describe
  the compact history-card pattern.
- Out of scope: experiment analysis semantics, canonical experiment storage,
  detail-page results, progress-card images, experiment status normalization,
  and active/paused card redesign.

## Constraints

- Keep experiment data flow projection-driven and browser-safe.
- Do not rank or cherry-pick outcomes across unlike units; preserve the run's
  primary-first signal order and make the detail page the full analysis owner.
- Do not modify the active PR feedback symbols `runStatusForTrackedExperiment`
  or `splitHomeExperimentCards` in `library-cards.ts`.
- Add no persisted state, schema, dependency, or new component abstraction.

## Tasks

1. Validate the real multi-metric run and current one-metric projection path.
2. Project all concise comparable metrics and render the compact history state.
3. Add focused projection and component regressions.
4. Run verification, visual proof, specialist audits, second-model review, and
   parent final review; resolve evidence-backed findings.
5. Close the plan with the scoped commit, open the PR, and complete its gates.

## Decisions

- Prefer a compact list of measured deltas over choosing the most favorable
  metric. This resolves the missing-metric complaint without hiding an adverse
  or unchanged primary outcome.
- Keep baseline/current detail on the experiment page. The home history card is
  an index entry, not the complete result report.

## Verification

- Focused component and projection coverage passed: 2 files, 11 tests.
- Serialized diff-aware verification passed, including repository guards,
  TypeScript, 437 test files (5,381 tests passed, 141 skipped), ESLint with no
  errors, the development smoke test, and the production Next.js build.
- Coverage-write and final frontend review completed with no unresolved
  findings. The parent final review confirmed active cards retain their existing
  primary-metric selection while history cards use the complete ordered metric
  projection.
- The second-model UI review's evidence-backed responsive, status, and sparse
  metric findings were corrected before the final review.
- Desktop and mobile browser inspection could not run because no browser backend
  was available. Static server-render coverage verifies the responsive classes,
  compact/history split, full-card link, privacy label, and status treatment;
  rendered visual proof remains the explicitly reported verification gap.
Completed: 2026-07-16
