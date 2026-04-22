# Land Finnish sauna experiment onboarding patch

Status: completed
Created: 2026-04-22
Updated: 2026-04-22

## Goal

- Land the supplied Finnish dry-sauna experiment-onboarding patch against the current tree without replaying stale shared-onboarding hunks that are already present from overlapping work.

## Success criteria

- The Finnish dry-sauna protocol page carries the intended `experimentOnboarding` block.
- Directly coupled generated Health Commons artifacts reflect that onboarding block and the updated runnable protocol revision.
- Verification proves the authored content and generated outputs are in sync, and the required audit passes complete before a scoped commit.

## Scope

- In scope:
  - `packages/health-commons/content/protocols/dry-sauna/murph-finnish-standard-3x-week.md`
  - Directly coupled `packages/health-commons/generated/{catalog.hash,catalog.json,entities.ndjson}`
  - Directly coupled `packages/health-commons/test/catalog.test.ts`
- Out of scope:
  - Reworking shared onboarding contracts, assistant prompts, or hosted projections that are already present in the current tree.
  - Broader Finnish-sauna research-copy or `apps/web` UI changes beyond any generated output effects that follow from the onboarding block.

## Constraints

- Technical constraints:
  - Treat the supplied patch as intent only; port it onto the current onboarding schema and generated-output format.
  - Preserve overlapping dirty-tree edits in the same protocol and generated files.
- Product/process constraints:
  - Keep this lane narrow even though the checkout already contains broader Finnish-sauna and experiment-onboarding work.
  - Follow the standard repo-change completion workflow, including required audit passes and a scoped commit.

## Risks and mitigations

1. Risk: The supplied patch is stale against the current onboarding infrastructure and generated catalog shape.
   Mitigation: Reuse the already-landed shared onboarding support and add only the sauna-specific content plus regenerated artifacts.
2. Risk: The protocol and generated artifacts overlap an active Finnish-sauna research row.
   Mitigation: Merge on top of the current file state, avoid reverting any adjacent research edits, and call out the overlap in the final handoff.
3. Risk: Regeneration could broaden beyond the intended slice.
   Mitigation: Regenerate through the package workflow, inspect the resulting diff, and commit only the directly coupled generated outputs.

## Tasks

1. Register the lane and compare the supplied patch against the current onboarding-capable tree.
2. Add the missing Finnish dry-sauna `experimentOnboarding` block to the protocol page.
3. Regenerate the coupled Health Commons artifacts and confirm the sauna onboarding object plus `runSpecRevisionId` updated.
4. Update any directly coupled deterministic catalog expectation that intentionally changes because of the onboarding block, then run truthful scoped verification and collect direct scenario proof.
5. Run the required `coverage-write` and `task-finish-review` audit passes, then create the scoped commit.

## Decisions

- Shared onboarding contracts, validation, web projection, and assistant guidance already exist in the working tree and do not need to be replayed from the stale patch.
- The landing will focus on the still-missing sauna-specific authored content and the generated artifacts that derive from it.

## Verification

- Commands to run:
  - `pnpm typecheck`
  - `bash scripts/workspace-verify.sh test:diff packages/health-commons/content/protocols/dry-sauna/murph-finnish-standard-3x-week.md packages/health-commons/generated/catalog.hash packages/health-commons/generated/catalog.json packages/health-commons/generated/entities.ndjson packages/health-commons/test/catalog.test.ts`
  - `pnpm --dir packages/health-commons generate:check`
  - `pnpm test:smoke`
- Expected outcomes:
  - The scoped diff-aware lane and package generation check pass on the intended slice.
  - The generated catalog contains the Finnish sauna onboarding block and a new `runSpecRevisionId` for that protocol.

## Progress

- Completed:
  - Confirmed the supplied patch no longer applies cleanly because the shared onboarding infrastructure already exists in the current tree.
  - Added the Finnish dry-sauna `experimentOnboarding` block using the current repo onboarding schema.
  - Regenerated the directly coupled Health Commons artifacts and confirmed the sauna entity now exposes onboarding plus `runSpecRevisionId = sha256:99ccf2b48a613677bbb2a58101a97526d385cd9eaedcb8ac0076d8ef57edd996`.
  - Updated the deterministic Health Commons catalog test to assert the sauna onboarding payload and the new run-spec hash.
  - Passed `git diff --check` on the touched files.
  - Passed `pnpm typecheck` after the final test-file adjustment.
  - Passed `pnpm --dir packages/health-commons generate:check`.
  - Passed `pnpm test:smoke`.
  - Passed focused app proof with `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/health-commons-experiment-detail-page.test.ts apps/web/test/experiment-detail-protocol-tab.test.ts --no-coverage -t "hands the Health Commons sauna protocol through to the client shell|caps focus cards at three and moves overflow signals into context pills"`.
  - Required `coverage-write` audit pass completed with no additional changes needed.
  - Required `task-finish-review` audit pass completed with no material findings.
- Remaining:
  - Create the scoped commit with the touched paths and close the plan.
- Current blocker:
  - The truthful diff-aware lane `bash scripts/workspace-verify.sh test:diff packages/health-commons/content/protocols/dry-sauna/murph-finnish-standard-3x-week.md packages/health-commons/generated/catalog.hash packages/health-commons/generated/catalog.json packages/health-commons/generated/entities.ndjson packages/health-commons/test/catalog.test.ts` still fails in reverse-dependent `apps/web verify` on unrelated existing issues: `apps/web/test/hosted-onboarding-privacy-foundation-migration.test.ts` expects an older migration list, `apps/web/test/experiment-header.test.ts` has a pre-existing Bryan Johnson baseline-label expectation, and `apps/web/test/health-commons-experiment-detail-page.test.ts` has a broader pre-existing non-Finnish protocol-variant expectation mismatch.
Completed: 2026-04-22
