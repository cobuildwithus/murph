# Land the supplied red-light experiment onboarding patch against current onboarding work

Status: completed
Created: 2026-04-22
Updated: 2026-04-22

## Goal

- Land the supplied Red Light Glasses Before Bed experiment-onboarding patch so the generic Health Commons onboarding contract, red-light protocol onboarding data, web projection, assistant/operator guidance, and generated catalog outputs all line up on current `HEAD`.

## Success criteria

- The generic onboarding contract and guidance required by the supplied patch are present and consistent with the current repo shape.
- The red-light protocol page carries an onboarding block covering setup, safety, logging, and reminder policy.
- Health Commons generated outputs include the red-light onboarding block and a changed `runSpecRevisionId`.
- The hosted experiment-detail model exposes the onboarding data through the current contract version.
- Required verification and completion-workflow audit passes complete, and the task lands as a scoped commit without trampling overlapping active work.

## Scope

- In scope:
  - `packages/contracts/src/health-commons.ts`
  - directly coupled `packages/contracts/test/health-commons.test.ts`
  - `packages/health-commons/content/protocols/red-light-glasses-before-bed/red-light-glasses-before-bed.md`
  - directly coupled `packages/health-commons/{src/catalog.ts,generated/**,test/**}`
  - `apps/web/src/{lib/experiments/experiment-detail.ts,lib/health-commons/experiment-detail.ts,types/experiments.ts}`
  - directly coupled `apps/web/test/health-commons-experiment-onboarding.test.ts`
  - `packages/assistant-engine/src/assistant/system-prompt.ts`
  - directly coupled `packages/assistant-engine/test/system-prompt.test.ts`
  - `packages/openclaw-plugin/skills/murph/SKILL.md`
  - `agent-docs/{index.md,product-specs/health-commons.md,product-specs/index.md,product-specs/experiment-onboarding.md}`
- Out of scope:
  - Norwegian 4x4 onboarding content
  - unrelated Finnish-sauna research and grouped-study projection changes
  - broader experiment runtime or UI implementation beyond the projection/type contract

## Constraints

- Preserve unrelated dirty-tree edits and overlapping active rows.
- Treat the supplied patch as intent where it conflicts with the current onboarding schema or file layout.
- Keep the diff limited to onboarding plumbing plus the red-light protocol/data slice.

## Risks and mitigations

1. Risk: The supplied patch targets an older onboarding schema shape than the current in-flight generic contract.
   Mitigation: Port the red-light content into the current schema instead of replaying stale field names verbatim.
2. Risk: Shared files such as `packages/health-commons/generated/**`, `packages/health-commons/src/catalog.ts`, and `apps/web/src/lib/health-commons/experiment-detail.ts` also carry unrelated active work.
   Mitigation: Keep worktree edits narrow, and if needed stage only the exact red-light/onboarding content for commit while preserving overlapping dirty changes in the checkout.
3. Risk: Verification may exercise overlapping in-flight changes.
   Mitigation: Use the highest-signal truthful lane, record overlap explicitly, and rerun focused checks after any review-driven fixes.

## Tasks

1. Register the red-light onboarding lane and port the red-light protocol onboarding content onto the current generic onboarding contract.
2. Align the hosted web projection, contract version, tests, and assistant/operator guidance with the intended `experimentOnboarding` surface.
3. Regenerate the Health Commons catalog, run required verification and audit passes, then land a scoped commit.

## Decisions

- Use the current generic onboarding schema already present in the dirty tree as the owner shape, and adapt the red-light content to that shape.
- Keep the hosted-web field name aligned with the supplied patch summary: `experimentOnboarding`.

## Verification

- Commands to run:
  - `pnpm typecheck`
  - `pnpm test:diff <touched paths>`
  - `pnpm test:smoke`
  - focused `pnpm --dir packages/health-commons verify` if needed for generated-catalog proof
- Expected outcomes:
  - Green typecheck, diff-aware coverage, and smoke checks for the landed slice.
  - Direct proof that the red-light generated protocol entity contains onboarding data and a changed `runSpecRevisionId`.
Completed: 2026-04-22
