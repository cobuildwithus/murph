# Add private protocol profile contract

Status: completed
Created: 2026-04-26
Updated: 2026-04-26

## Goal

- Add the first durable storage seam and agent-facing CLI flow for private reusable Health Commons adaptations by introducing a private `protocol_profile` contract, experiment references/snapshots, Health Commons adaptation policy, baseline-mode run plans, and plan/start commands.

## Success criteria

- Private vault records can represent a reusable protocol adaptation with source Health Commons refs, lineage, structured diff, effective spec, personalization, and revision/hash fields.
- Experiment frontmatter can reference a private profile revision and snapshot the effective protocol at run start.
- Experiment run plans can record whether baseline data is prospective, retrospective, or omitted.
- Health Commons onboarding can declare typed adaptation policy/targets without forcing agents to write invalid experiment frontmatter paths.
- CLI exposes agent-friendly `protocol profile upsert`, `experiment plan`, and `experiment start` commands backed by typed vault-usecase orchestration.
- Focused contract/core/query/Health Commons tests cover the new schema and existing strictness.

## Scope

- In scope:
  - `packages/contracts` frontmatter schemas, vault family/layout metadata, examples, and generated JSON schemas.
  - `packages/core` canonical private protocol-profile read/write helpers and focused tests.
  - `packages/query` read/projection support and focused tests needed to find profile records and carry experiment snapshot refs.
  - Health Commons onboarding schema additions for `adaptationPolicy` and typed setup slot `target`.
  - Additive experiment `runPlan.baseline` metadata for baseline mode/source/date semantics.
  - `packages/vault-usecases` and `packages/cli` command seams for profile upsert and plan/start orchestration.
  - Product/contract docs directly needed to document the new persisted-state family.
- Out of scope:
  - Low-level multi-file transaction batching beyond preflighted command orchestration.
  - Public/community protocol forks, outcome aggregation, or cohort-learning behavior.
  - Broad migration of all existing Health Commons `writePath` strings.

## Constraints

- `protocol_profile` is private vault product truth, not a public Health Commons page.
- Do not mutate the legacy private `protocol` v1 schema into a Health Commons adaptation shape.
- Preserve exact public Health Commons lineage through `protocolRef`; use `protocolProfileRef` only for the private adaptation layer.
- Experiment history must not depend on mutable profile state; store an `effectiveProtocolSnapshot` on the experiment.
- Current user request explicitly widened this slice into CLI/usecase plan/start commands; preserve unrelated active CLI/usecase edits while landing only the protocol-profile flow.
- Do not print or persist personal identifiers, secrets, local paths, or private setup notes in tests/docs/examples.

## Risks and mitigations

1. Risk: Adding strict frontmatter fields breaks older readers if deployed out of order.
   Mitigation: Keep changes additive inside current schemas and cover generated JSON schemas/tests.
2. Risk: Profile records duplicate existing private `protocol` semantics.
   Mitigation: Use a separate `docType: protocol_profile`, separate id prefix, and separate vault family/directory.
3. Risk: Effective profile specs drift from experiment snapshots.
   Mitigation: Make the experiment snapshot explicitly authoritative for historical runs.
4. Risk: Health Commons adaptation policy affects duplicate recipe detection.
   Mitigation: Put policy under `experimentOnboarding`, so it affects `runSpecRevisionId` but not `recipeHash`.

## Tasks

1. Land contract/schema additions for `protocol_profile`, experiment refs, and effective snapshots.
2. Add Health Commons onboarding `adaptationPolicy` and typed setup slot targets with focused revision tests.
3. Add additive `runPlan.baseline` mode/source/date metadata.
4. Add core/query protocol-profile storage/read support.
5. Add vault-usecases and CLI support for `protocol profile upsert`, `experiment plan`, and `experiment start`.
6. Integrate generated schemas/examples/docs and focused tests.
7. Run scoped verification, required security/privacy and coverage/final review passes.
8. Close the plan; do not create a scoped commit while overlapping active work owns shared touched files.

## Decisions

- Use `protocol_profile` as the new private document type.
- Keep public protocol identity in `protocolRef` and add optional `protocolProfileRef`.
- Include the first CLI seam now because the current task explicitly asks to land all five priority items.
- `experiment start` preflights the full experiment frontmatter and orchestrates profile upsert plus experiment create/update; it is not yet a lower-level write-batch transaction.

## Verification

- Passed:
  - `pnpm --dir packages/contracts generate`
  - `pnpm --dir packages/contracts test:coverage`
  - `pnpm --dir packages/core test:coverage`
  - `pnpm --dir packages/query test:coverage`
  - `pnpm --dir packages/vault-usecases typecheck`
  - `pnpm --dir packages/vault-usecases test:coverage`
  - `pnpm --dir packages/cli typecheck`
  - `pnpm --dir packages/cli exec vitest run --config vitest.workspace.ts test/cli-expansion-experiment-journal-vault-phase2.test.ts --no-coverage`
  - `pnpm --dir packages/cli test:source`
  - `pnpm --dir packages/health-commons typecheck`
  - `pnpm --dir packages/health-commons generate:check`
  - `pnpm --dir packages/health-commons exec vitest run --config vitest.config.ts test/catalog.experiment-onboarding.test.ts test/catalog.test.ts --no-coverage`
  - `pnpm typecheck`
  - `pnpm test:smoke`
  - `git diff --check -- packages/contracts packages/core packages/query packages/health-commons packages/vault-usecases packages/cli docs/contracts/02-record-schemas.md agent-docs/exec-plans/completed/2026-04-26-protocol-profile-contract.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- Blocked:
  - `bash scripts/workspace-verify.sh test:diff -- packages/contracts packages/core packages/query packages/health-commons packages/vault-usecases packages/cli` reaches unrelated `packages/device-syncd/test/service.test.ts` failure in the active device-syncd lease-fence lane: expected webhook trace status `processed`, got `claimed`.
Completed: 2026-04-26
