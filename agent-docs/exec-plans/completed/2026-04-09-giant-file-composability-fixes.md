# Land bounded giant-file composability fixes

Status: completed
Created: 2026-04-09
Updated: 2026-04-09

## Goal

- Land a small, safe subset of the 2026-04-08 giant-file composability review by extracting already-coherent helper seams out of two large owner files.

## Success criteria

- `packages/operator-config/src/operator-config.ts` no longer owns the CLI vault-default argv helper cluster directly; that logic lives in a dedicated sibling module while the existing public API remains stable.
- `packages/setup-cli/src/setup-wizard.ts` no longer owns the pure setup-flow/copy helper cluster directly; that logic lives in a dedicated sibling module while `runSetupWizard` remains the public wrapper.
- Existing behavior and tests stay green without widening runtime scope or changing product behavior.

## Scope

- In scope:
- `packages/operator-config/src/{operator-config.ts,operator-config/cli-vault-defaults.ts}`
- `packages/operator-config/test/operator-config-seam.test.ts` only if import or coverage adjustments are needed
- `packages/setup-cli/src/{setup-wizard.ts,setup-wizard-flow.ts}`
- `packages/setup-cli/test/setup-wizard.test.ts` only if focused helper coverage or imports need adjustment
- Out of scope:
- broader assistant-engine, hosted-web, inboxd, or device-syncd splits from the review
- behavior changes to default-vault injection or setup-wizard UX
- additional runtime-status or Ink-app extraction beyond what is needed for this bounded landing

## Constraints

- Preserve unrelated dirty-worktree edits.
- Keep the public facade files stable for current callers.
- Prefer the review's safe-first extraction path over broader reorganizations.

## Risks and mitigations

1. Risk: Refactoring facade files could change import surfaces unintentionally.
   Mitigation: Re-export moved public helpers from the facade and keep call sites stable.
2. Risk: The setup-wizard extraction could tangle with stateful Ink logic.
   Mitigation: Move only pure step/copy helpers in this turn; leave the nested app in place.
3. Risk: Dirty-worktree overlap could cause conflicts in nearby files.
   Mitigation: Stay inside the declared files, read current file state before edits, and use path-scoped commit tooling at the end.

## Tasks

1. Extract CLI vault-default helpers from `operator-config.ts` into `operator-config/cli-vault-defaults.ts`.
2. Extract setup-wizard flow/copy helpers from `setup-wizard.ts` into `setup-wizard-flow.ts`.
3. Run the required verification for touched package surfaces.
4. Run the required final review audit pass, address any findings, and create a scoped commit.

## Decisions

- The best fixes to land now are the review's lowest-risk "pure helper" extractions in packages without the heaviest active overlap.

## Verification

- Commands to run:
- `pnpm typecheck`
- `pnpm test:packages`
- Expected outcomes:
- The operator-config and setup-cli seams remain behaviorally unchanged, with package-level tests still passing under the repo package verification lane.
Completed: 2026-04-09
