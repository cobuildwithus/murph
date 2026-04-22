# Land the supplied Norwegian 4x4 experiment onboarding patch and fill the missing proof/docs needed for repo acceptance

Status: completed
Created: 2026-04-22
Updated: 2026-04-22

## Goal

- Land the supplied Norwegian 4x4 experiment-onboarding patch so Health Commons protocols can carry structured onboarding guidance, the Norwegian 4x4 page exposes that onboarding data through generated catalogs and the hosted experiment model, and assistant/Murph guidance stays aligned with that new contract.

## Success criteria

- The supplied onboarding contract and Norwegian 4x4 onboarding content are integrated cleanly on current `HEAD`.
- Missing repo-local proof/docs omitted from the supplied patch are added only where needed for acceptance, especially the experiment-onboarding product spec and focused regression coverage.
- Required verification passes or a truthful scoped alternative complete with recorded evidence.
- Required completion-workflow audit passes complete, and the task lands as a scoped commit.

## Scope

- In scope:
  - `packages/contracts/src/health-commons.ts`
  - `packages/health-commons/content/protocols/norwegian-4x4/norwegian-4x4.md`
  - directly coupled `packages/health-commons/{src/catalog.ts,generated/**,test/**}`
  - `apps/web/src/{lib/health-commons/experiment-detail.ts,types/experiments.ts}`
  - `packages/assistant-engine/src/assistant/system-prompt.ts`
  - `packages/openclaw-plugin/skills/murph/SKILL.md`
  - `agent-docs/{index.md,product-specs/index.md,product-specs/experiment-onboarding.md}`
  - directly coupled `packages/contracts/test/**` and `apps/web/test/**` only if needed for truthful proof
- Out of scope:
  - unrelated Health Commons source-evidence rewrites
  - broader experiment creation/runtime implementation beyond the schema and guidance surfaced here
  - unrelated hosted-web design/content work already active elsewhere

## Constraints

- Technical constraints:
  - Preserve current `HEAD` behavior outside the onboarding contract/projection/guidance slice.
  - Keep generated Health Commons artifacts deterministic and consistent with the content/schema updates.
  - Do not widen into unrelated active hosted-web or Health Commons lanes.
- Product/process constraints:
  - Follow the standard repo change workflow with plan, ledger, verification, mandatory audit passes, and a scoped commit.
  - Do not expose personal identifiers in docs, comments, diffs, or handoff.

## Risks and mitigations

1. Risk: The supplied patch summary and the patch file differ, so a literal apply could land incomplete behavior or missing proof.
   Mitigation: Treat the patch as intent, port the concrete hunks onto current files, and add only the missing spec/tests required to make the landed slice coherent and verifiable.
2. Risk: Generated Health Commons outputs may drift from current `HEAD` or from omitted test fixtures.
   Mitigation: Regenerate from the current tree, inspect the resulting diffs carefully, and add focused verification around the Norwegian 4x4 revision/hash changes.
3. Risk: The `apps/web` slice overlaps other active experiment-detail work.
   Mitigation: Keep the web change limited to the onboarding field projection/type surface and avoid unrelated UI or data-shaping edits.

## Tasks

1. Port the supplied onboarding contract/content/guidance changes onto the current repo state.
2. Add the missing experiment-onboarding product spec and focused regression coverage for the new schema/catalog behavior.
3. Run the required verification and audit workflow, then finish the task with a scoped commit.

## Decisions

- Use a plan-bearing standard repo-change path because the supplied patch broadened into multi-file schema, generated artifact, app, assistant, and doc/test work.
- Treat the supplied patch as behavioral intent rather than overwrite authority because its summary claims files that are not present in the patch itself.

## Verification

- Commands to run:
  - `pnpm typecheck`
  - `pnpm test:diff <touched paths>`
  - `pnpm test:smoke`
  - focused package/app-local test reruns as needed after review findings
- Expected outcomes:
  - Green typecheck and truthful diff-aware coverage for the touched owners.
  - Green smoke check and focused proof that the Norwegian 4x4 onboarding block participates in generated catalog and revision hashing.
- Completed:
  - `pnpm typecheck`
  - `pnpm test:smoke`
  - `pnpm --dir packages/contracts exec vitest run test/health-commons.test.ts --config vitest.config.ts --no-coverage`
  - `pnpm --dir packages/health-commons exec vitest run test/catalog.test.ts test/catalog-coverage.test.ts --config vitest.config.ts --no-coverage`
  - `pnpm --dir packages/assistant-engine exec vitest run test/system-prompt.test.ts --config vitest.config.ts --no-coverage`
  - `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/health-commons-experiment-onboarding.test.ts --no-coverage`
  - required `coverage-write` and `task-finish-review` audit passes completed before landing
