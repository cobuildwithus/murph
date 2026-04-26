# Land Pro measurement-method model patch

Status: completed
Created: 2026-04-25
Updated: 2026-04-26

## Goal

- Land a greenfield hard cut for first-class Health Commons measurement methods from the current design memo, preserving the skin PBM protocol intent while separating reusable measurement methods from biomarkers.

## Success criteria

- Current implementation intent is inspected before applying.
- Health Commons entity modeling cleanly distinguishes measurement methods from biomarkers and keeps protocol test plans semantically correct.
- Recently added skin image-derived pages are either migrated to measurement-method content or otherwise demoted so they are not treated as core biomarkers by default.
  - Affected tests and generated schema/catalog validation are updated.
- Required scoped verification and completion workflow audits pass, or blockers are documented as unrelated.
- A scoped commit lands the accepted changes, or overlapping active work makes a safe scoped commit impractical and the plan is closed with blockers noted.

## Scope

- In scope:
  - Contracts, content, catalog, and directly coupled web/query tests needed for a measurement-method entity or equivalent durable model.
  - Skin PBM protocol wiring for measurement methods, including the recent skin imaging complexity.
  - Landing the current design memo carefully against the dirty worktree.
- Out of scope:
  - New red-light research beyond the Pro-returned implementation/design patch.
  - Broad Health Commons redesign unrelated to measurement methods.
  - Clinic-grade skin-measurement product UX beyond content/model hooks needed by this slice.

## Constraints

- Technical constraints:
  - Preserve unrelated dirty work and active ledger lanes.
  - Treat Pro output as implementation intent, not overwrite authority.
  - Keep workspace package imports on declared public entrypoints.
- Product/process constraints:
  - Avoid conflating biomarkers with testing or measurement-method pages.
  - Keep protocol evaluation lightweight and honest about confidence.
  - Follow completion workflow before handoff.

## Risks and mitigations

1. Risk: Pro returns a stale patch against files already modified by other active lanes.
   Mitigation: inspect hunks and port manually only where ownership is clear.
2. Risk: Measurement methods become a second ambiguous taxonomy.
   Mitigation: keep the first model minimal and tied to concrete protocol measurement use cases.
3. Risk: The skin protocol defaults to too many burdensome measurements.
   Mitigation: separate default biomarkers from optional measurement-method packs and label burden clearly.

## Tasks

1. Inspect current overlapping diffs and coordinate the hard-cut write scopes.
2. Add the measurement-method contracts, catalog validation, and run-spec hashing.
3. Migrate the skin PBM content to measurement-method pages with no old-key redirects or route compatibility.
4. Add directly coupled web/tool surfacing needed to avoid inflated biomarkers.
5. Run scoped verification and required completion workflow audits.
6. Commit the scoped landing when safely separable from overlapping active work, otherwise close the plan with blocker notes.

## Decisions

- Use the current chat design memo as implementation intent because the user requested a greenfield hard cut.
- Keep the default skin PBM outcome set outcome-only; optional image-derived fields must live behind measurement paths.
- Do not add old biomarker redirects or old route compatibility; this is a greenfield hard cut.
- Keep compact runtime `measurementPlan` protocol-only; onboarding adaptation measurement plans stay under `experimentOnboarding`.
- Fail closed when web measurement-method or measurement-plan projections reference the wrong entity type.

## Verification

- Commands run:
  - `pnpm --dir packages/contracts exec vitest run test/health-commons.test.ts test/health-commons-experiment-onboarding.test.ts --config vitest.config.ts --no-coverage` passed.
  - `pnpm --dir packages/contracts verify` passed.
  - `pnpm --dir packages/health-commons exec vitest run test/catalog-coverage.test.ts test/catalog.experiment-onboarding.test.ts test/runtime.test.ts --config vitest.config.ts --no-coverage` passed.
  - `pnpm --dir packages/health-commons generate:check` passed.
  - `pnpm --dir packages/health-commons verify` passed.
  - `pnpm exec vitest run apps/web/test/experiment-detail-protocol-tab.test.ts apps/web/test/experiment-detail-client-contract.test.tsx apps/web/test/health-commons-measurement-method-page.test.ts apps/web/test/health-commons-measurement-method-detail.test.ts --config apps/web/vitest.workspace.ts --no-coverage` passed.
  - `pnpm --dir apps/web typecheck` passed.
  - `pnpm --dir apps/web lint` passed with existing warnings.
  - `pnpm --dir packages/assistant-engine exec vitest run test/health-commons-bound-tools.test.ts test/model-behavior.test.ts --config vitest.config.ts --no-coverage` passed.
  - `pnpm --dir packages/assistant-engine typecheck` passed.
  - `pnpm exec vitest run --config packages/cli/vitest.workspace.ts --no-coverage packages/cli/test/commons-command-coverage.test.ts` passed.
  - `pnpm --dir packages/cli typecheck` passed.
  - `git diff --check` over the measurement-method working set passed.
  - Required completion audit passes ran: simplify, security/privacy, frontend, coverage-write, and task-finish-review. Findings were addressed except browser/screenshot proof, which remains a residual UI check gap.
  - `bash scripts/workspace-verify.sh test:diff <measurement-method files>` failed at unrelated `packages/assistant-engine/test/provider-execution.test.ts`; the mock expected an older `executeCodexAppServerTurn` prompt object shape while the current call includes conversation context and execution options. This task did not touch that test or provider-execution path.
- Expected outcomes:
  - Affected checks pass, or unrelated pre-existing failures are documented with direct evidence.

## Commit status

- Scoped commit created after manual staged filtering because the shared checkout had overlapping active work in `packages/contracts/**`, `packages/health-commons/{content,src,test}/**`, `apps/web/**`, `packages/assistant-engine/**`, and `packages/cli/**`. Whole-file staging was avoided for mixed files.
Completed: 2026-04-26
