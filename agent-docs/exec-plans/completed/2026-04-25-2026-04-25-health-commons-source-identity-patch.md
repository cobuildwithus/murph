# Land Health Commons source identity patch

Status: completed
Created: 2026-04-25
Updated: 2026-04-25

## Goal

- Land the supplied Health Commons source-identity patch so canonical source identity, duplicate-source guardrails, reusable source findings/appraisals, and generated source lookup indexes are represented by typed contracts and package build code.

## Success criteria

- The patch is applied against the current checkout without absorbing unrelated dirty work.
- Existing ad hoc Tabata `canonicalMetadata` blocks are migrated to typed `sourceIdentity` blocks.
- Known duplicate source pages have explicit source-identity relation exceptions.
- Health Commons generation/validation, package tests, typecheck, and diff hygiene pass or any pre-existing unrelated blocker is documented precisely.
- Required completion audits run before handoff.
- A scoped commit lands if the working tree allows a safe task-only commit.

## Scope

- In scope:
- `packages/contracts/src/health-commons.ts`
- `packages/health-commons/src/**`
- `packages/health-commons/test/**` only if focused proof needs updates
- directly touched `packages/health-commons/content/sources/**` migration/duplicate exception pages
- ignored/generated `packages/health-commons/generated/**` outputs only as verification artifacts unless the repo tracks the specific changed file
- Out of scope:
- New research-lane content, `output-packages/**`, unrelated Health Commons research pages, and unrelated active hosted/runtime work.

## Constraints

- Technical constraints:
- Preserve package boundaries and use existing Health Commons load/catalog/build patterns.
- Treat generated Health Commons outputs as build artifacts unless git already tracks a specific changed generated file required by the task.
- Product/process constraints:
- Preserve unrelated dirty-tree work and active ledger rows.
- Avoid storing local personal identifiers or local filesystem paths in code, docs, comments, logs, or commit text.

## Risks and mitigations

1. Risk: source duplicate validation blocks existing intentional duplicates.
   Mitigation: require explicit relation exceptions for known same-work/registry/publication links and verify generation.
2. Risk: evidence appraisals become a second source of truth for private results.
   Mitigation: keep the new records in public Health Commons content only and validate them as source/protocol edges.
3. Risk: generated output churn overlaps active research lanes.
   Mitigation: inspect tracked/ignored status and commit only scoped tracked outputs required for this patch.

## Tasks

1. Apply the supplied patch and inspect the resulting diff. Done.
2. Run focused Health Commons generation/tests plus repo typecheck/diff hygiene. Done.
3. Run required security/privacy, coverage, and final-review audit passes. Done.
4. Fix any valid findings and rerun affected checks. Done; audits reported no findings.
5. Commit the scoped patch landing or document why a safe scoped commit is blocked. Done; scoped commit prepared for handoff.

## Decisions

- Keep the helper-created double-dated plan filename stable for this task so the ledger and finish helper can match it exactly.

## Verification

- Commands to run:
- `pnpm --dir packages/health-commons generate`
- `pnpm --dir packages/health-commons test:coverage`
- `pnpm --dir packages/contracts test:coverage`
- `pnpm --dir packages/contracts typecheck`
- `pnpm --dir packages/health-commons typecheck`
- `pnpm typecheck`
- `pnpm test:smoke`
- `pnpm --dir packages/health-commons generate:check`
- `git diff --check`
- Expected outcomes:
- Health Commons generation and package coverage pass.
- Typecheck passes or any unrelated branch blocker is documented with target and reason.
- Diff hygiene passes.

## Verification results

- `pnpm --dir packages/health-commons generate`: passed.
- `pnpm --dir packages/health-commons test:coverage`: passed; 9 files / 27 tests.
- `pnpm --dir packages/contracts test:coverage`: passed; 13 files / 80 tests; schema artifacts verified.
- `pnpm --dir packages/contracts typecheck`: passed.
- `pnpm --dir packages/health-commons typecheck`: passed.
- `pnpm typecheck`: passed.
- `pnpm test:smoke`: passed; 151 scenarios, 6 sample inputs, 22 golden-output directories.
- `pnpm --dir packages/health-commons generate:check`: passed.
- `git diff --check`: passed.
- Direct proof: touched source/schema/test paths have no remaining `canonicalMetadata`; generated `source-index.json`, `source-artifact-index.json`, and `evidence-appraisals.json` parse with expected top-level keys.
Completed: 2026-04-25
