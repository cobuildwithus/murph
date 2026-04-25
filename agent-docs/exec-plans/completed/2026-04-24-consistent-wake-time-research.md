# Run Consistent Wake Time Health Commons research

Status: completed
Created: 2026-04-24
Updated: 2026-04-25

## Goal

- Complete the Murph Health Commons research workflow for the `consistent-wake-time` protocol and land the evidence-ready Health Commons package.

## Success criteria

- The existing `output-packages/research/consistent-wake-time-20260424-090632Z` workspace is continued from its completed charter and first discovery shard.
- Remaining discovery shards, snowball/gap-fill, source-ledger reducer, extraction batches, section synthesis, page builder, evidence QA, safety QA, and final landing reducer are completed or a concrete unrecoverable blocker is recorded.
- The final landing package creates or updates the intended family, protocol, source, artifact, biomarker, and generated Health Commons files only after evidence QA and safety QA are available.
- The landed page keeps consistent wake time separate from CBT-I, sleep restriction, bedtime-only regularity, full sleep hygiene, morning light exposure, evening light avoidance, melatonin, shift-work adaptation, and clinical circadian protocols unless the research outputs justify a specific adjacent relation.
- Verification and the required completion workflow are run, then a scoped commit lands the tracked patches when safe.

## Scope

- In scope:
  - `output-packages/research/consistent-wake-time-20260424-090632Z/**`
  - Health Commons content and generated catalog files directly produced by the final landing reducer
  - `.agents/skills/health-commons-research/SKILL.md` for browser-lane load-balancing and tab-cleanup workflow notes requested during the run
  - This active plan and its coordination-ledger row
- Out of scope:
  - Broad sleep-hygiene, CBT-I, light-exposure, melatonin, shift-work, or chronotherapy product work
  - Unrelated Health Commons protocols or generated catalog churn
  - Apps/web UI changes unless final landing verification exposes a directly coupled blocker

## Constraints

- Preserve unrelated dirty-tree work and active ledger rows.
- Use the workspace-specific research runner and saved thread URLs rather than duplicating good threads.
- Spread new research sends and harvests across lower-load managed browser profiles when possible instead of concentrating every seam in one lane.
- Close completed seam tabs and prune stale non-thread ChatGPT tabs so managed browser lanes do not accumulate avoidable load.
- Treat normalized downloads under the research workspace as the research source of truth for artifact seams.
- Do not commit local research workspace artifacts because `output-packages/**` is ignored; land only tracked repo patches produced by the final package.
- Keep the protocol low-burden and non-moralizing; safety and sleep-opportunity constraints must be clearer than efficacy claims where evidence is indirect.

## Risks and mitigations

1. Risk: Evidence is mostly bundled sleep regularity or CBT-I rather than wake-time-specific.
   Mitigation: Preserve directness labels and make adjacent evidence contextual instead of primary efficacy support.
2. Risk: A fixed wake time shortens sleep when bedtime does not shift.
   Mitigation: Keep insufficient sleep opportunity, daytime sleepiness, safety-sensitive work, and clinical sleep disorders as first-class safety boundaries.
3. Risk: Observational regularity literature overclaims causality.
   Mitigation: Separate intervention evidence from associations, measurement context, and public-health guidance.
4. Risk: Research threads run long or return artifacts under drifted names.
   Mitigation: Let harvest wrappers use their long wake budget and rely on normalized local artifact contracts.

## Tasks

1. Register the task in the coordination ledger.
2. Send and harvest remaining discovery shards.
3. Run snowball/gap-fill and source-ledger reducer.
4. Generate and run source extraction batches.
5. Generate and run section synthesis seams.
6. Run page builder, evidence QA, safety QA, and final landing reducer.
7. Apply final repo patches, regenerate Health Commons outputs if required, and verify. DONE.
8. Run required completion workflow audits and commit the scoped tracked changes. NOW.

## Decisions

- Continue the existing timestamped workspace instead of starting a duplicate.
- Keep `consistent-wake-time` as both family and starter protocol slug for this run, while preserving aliases to broader sleep-wake regularity in page metadata.
- Classify full sleep schedule regularity, bedtime-only regularity, social-jetlag reduction, clinical fixed-rise-time programs, and shift-worker scheduling as adjacent or future variants unless source extraction proves separable wake-time claims.
- Update the Health Commons research skill so future runs consider currently open managed browser tabs, share load across `phlebas`, `hercules`, `vonneumann`, `eragon`, or other named lanes, and clean up completed or non-thread tabs.

## Verification

- Commands to run:
  - research harvest artifact validation through `pnpm research:run`
  - `git diff --check`
  - Health Commons generated catalog verification or the nearest package-local verify command after tracked content lands
  - repo `pnpm typecheck` unless blocked by unrelated active work
  - completion-workflow audits required by the routed task class
- Expected outcomes:
  - Required research artifacts normalize under `downloads/<seam>/...`.
  - Landed Health Commons files contain source-backed claims and no local identifiers.
  - Scoped commit includes only this task's tracked files.

## Landing notes

- Evidence QA and safety QA completed and produced blocker edits.
- The remote final landing reducer seam timed out after its long wake budget while still showing a partial assistant response; the partial response named the same blocker set already covered by the local deterministic reducer.
- The landed package uses the page-builder archive plus QA-required conservative wording, source-key normalization, source classification fixes, Health Commons frontmatter normalization, and safety-override adherence handling.
Completed: 2026-04-25
