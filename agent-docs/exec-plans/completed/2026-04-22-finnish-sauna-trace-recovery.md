# Recover Finnish sauna patch from dead trace

Status: completed
Created: 2026-04-22
Updated: 2026-04-22

## Goal

- Recover the still-missing Finnish dry-sauna research improvements implied by the dead trace, using current primary-source evidence when the trace is incomplete or wrong, and land them as a narrow Health Commons plus `apps/web` experiment-detail patch.

## Success criteria

- The Finnish sauna research groups render from complete group-specific appraisals instead of falling back to the flat study list.
- The Finnish sauna source pages that the trace called out contain verified, user-readable metadata and caveats.
- The experiment-detail research UI uses the correct group appraisal per study and exposes clearer research-card copy without drifting from existing design patterns.
- Coupled generated Health Commons artifacts and focused tests are updated.
- Truthful scoped verification, required audit passes, and a scoped commit are completed unless a credibly unrelated blocker remains.

## Scope

- In scope:
  - Finnish dry-sauna source records and protocol research-group wiring under `packages/health-commons/content/**`.
  - Directly coupled generated Health Commons artifacts under `packages/health-commons/generated/**`.
  - The hosted experiment-detail projection and research-card UI in `apps/web/src/components/experiments/experiment-detail/**` and `apps/web/src/lib/health-commons/experiment-detail.ts`.
  - Focused app and Health Commons tests that prove the recovered behavior.
- Out of scope:
  - Unrelated sauna protocol copy sweeps outside the Finnish research trace recovery.
  - Non-sauna Health Commons work.
  - Broader experiment-detail redesign beyond the research grouping and wording needed here.

## Constraints

- Technical constraints:
  - Preserve current package ownership and regenerate only directly coupled Health Commons artifacts.
  - Use primary-source evidence when the trace summary conflicts with current accessible source material.
- Product/process constraints:
  - Preserve overlapping active `apps/web` experiment-detail work; keep this lane narrow and avoid unrelated UI churn.
  - Follow the repo completion workflow for a standard repo change, including required audit passes.

## Risks and mitigations

1. Risk: The dead trace summarized changes that were partially wrong or already landed.
   Mitigation: Treat the trace as intent only, verify specific study facts against primary sources, and compare against the current repo before editing.
2. Risk: The Finnish research UI shares files with other active experiment-detail rows.
   Mitigation: Keep the diff limited to Finnish-sauna research behavior, preserve unrelated patterns, and note overlap in the ledger and handoff.
3. Risk: Content edits require generated artifact updates that can broaden the diff.
   Mitigation: Regenerate only the directly coupled Health Commons outputs and verify that the generated diff matches the authored-source changes.

## Tasks

1. Identify which dead-trace sauna content and app changes are still missing in the current checkout.
2. Verify the disputed Finnish-sauna study facts against primary-source pages and update the source records.
3. Add the missing group-specific sauna protocol appraisals and fix the `apps/web` projection so grouped research cards use the current group's appraisal.
4. Tighten the Finnish research-card wording and summary-stat labels where the trace still aligns with current UX.
5. Regenerate the coupled Health Commons artifacts, update focused tests, and run scoped verification plus required audit passes.

## Decisions

- Treat the dead trace as a recoverable hint, not as authoritative patch truth.
- Prefer the current primary-source landing pages over the trace summary when they disagree, especially for participant counts and cohort metadata.

## Verification

- Commands to run:
  - `pnpm typecheck`
  - `bash scripts/workspace-verify.sh test:diff packages/health-commons/content/protocols/dry-sauna/murph-finnish-standard-3x-week.md packages/health-commons/content/sources/sauna/pmid-29720543.md packages/health-commons/content/sources/sauna/pmid-32615263.md packages/health-commons/content/sources/sauna/pmid-38836690.md packages/health-commons/generated/catalog.hash packages/health-commons/generated/catalog.json packages/health-commons/generated/entities.ndjson packages/health-commons/generated/recent-changes.json apps/web/src/lib/health-commons/experiment-detail.ts apps/web/src/components/experiments/experiment-detail/study-card.tsx apps/web/src/components/experiments/experiment-detail/protocol-tab.tsx apps/web/test/study-card.test.ts apps/web/test/health-commons-experiment-detail-page.test.ts apps/web/test/experiment-detail-protocol-tab.test.ts`
  - `pnpm test:smoke`
- Expected outcomes:
  - Typecheck and truthful diff-aware verification pass, or any unrelated blocker is named precisely.
  - Generated Health Commons artifacts are in sync with authored source changes.

## Progress

- Completed:
  - Recovered the missing Finnish-sauna source metadata and group-specific `protocolEvidence` coverage implied by the dead trace.
  - Fixed grouped research-card appraisal selection so each group uses its own appraisal instead of the first matching one.
  - Hardened the flat `studies` projection so overlapping sources keep neutral metadata unless a protocol has exactly one matching appraisal.
  - Added catalog validation that rejects grouped research sources without a same-group `protocolEvidence` appraisal.
  - Regenerated the coupled Health Commons artifacts and updated focused app/package regression coverage.
- Verification:
  - Passed `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/study-card.test.ts apps/web/test/experiment-detail-protocol-tab.test.ts --no-coverage`
  - Passed `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/health-commons-experiment-detail-page.test.ts --no-coverage -t "hands the Health Commons sauna protocol through to the client shell"`
  - Passed `pnpm --dir packages/health-commons verify`
  - Passed `pnpm typecheck`
  - Passed `pnpm test:smoke`
  - Passed `pnpm --dir apps/web typecheck`
  - Passed `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/experiment-detail-protocol-tab.test.ts apps/web/test/health-commons-experiment-detail-page.test.ts --no-coverage`
  - Passed `pnpm --dir packages/cli verify:package-shape` after refreshing the stale generated CLI artifacts needed for package-shape verification.
  - Passed `git diff --check`
  - Required audit passes completed; final narrowed review found no remaining material issues.
- Current blocker:
  - No scoped landing blocker remains for this lane.
  - Full `pnpm verify:acceptance` is credibly pre-red outside this diff because already-committed scheduled-log coverage gaps fail `packages/assistant-engine` (`src/assistant/cron/scheduled-log.ts`, `src/assistant/usage-attribution.ts`) and `packages/core` (`src/scheduled-logs.ts`, plus the stale constant expectation in `packages/core/test/core.test.ts`), while the truthful `apps/web` diff lane also still sees the unrelated pre-existing `apps/web/test/experiment-header.test.ts` and `apps/web/test/hosted-onboarding-privacy-foundation-migration.test.ts` failures.
Completed: 2026-04-22
