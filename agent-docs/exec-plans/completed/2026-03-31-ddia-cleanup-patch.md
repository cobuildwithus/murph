# DDIA Cleanup Patch Landing

Status: completed
Created: 2026-03-31
Updated: 2026-03-31

## Goal

- Land the supplied DDIA cleanup patch across assistant service extraction and shared registry metadata/query cleanup, then rerun the required repo verification and audits on the rebased tree.

## Success criteria

- The supplied patch intent is applied without overwriting unrelated dirty worktree edits.
- `pnpm typecheck`, `pnpm test`, and `pnpm test:coverage` complete successfully after the landing.
- Required audit passes complete with no unresolved high-severity findings.

## Scope

- In scope:
  `packages/cli/src/assistant/{local-service,prompt-attempts,provider-turn-runner,service-result,service-turn-routes,service-usage,service}.ts`
  `packages/contracts/src/{bank-entities,index,registry-helpers}.ts`
  `packages/query/src/health/{bank-registry-query-metadata,health-registry-query-metadata,registries}.ts`
  `packages/query/src/model.ts`
  `packages/query/test/health-registry-definitions.test.ts`
  `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- Out of scope:
  Unrelated dirty gateway and Cloudflare edits already present in the worktree.

## Constraints

- Technical constraints:
  Preserve adjacent dirty edits and port only the supplied patch delta where the live tree drifted.
- Product/process constraints:
  Use the required repo verification baseline for this multi-file repo change and close the plan before final handoff.

## Risks and mitigations

1. Risk: the supplied patch can drift against the live tree and partially apply.
   Mitigation: inspect the rebased files, resolve conflicts manually, and verify the final footprint before tests.
2. Risk: registry metadata extraction can subtly change query projections or exports.
   Mitigation: keep the existing behavior shape and cover it with repo verification plus the query metadata test.

## Tasks

1. Register the coordination-ledger scope and inspect the live target files.
2. Apply the supplied patch, resolve drift, and confirm the landed footprint.
3. Run the required verification commands and a focused direct proof check if needed.
4. Run required audit reviews, fix findings, and close the plan before handoff.

## Decisions

- Treat the supplied patch as behavioral intent and rebase it onto the current tree instead of forcing a blind apply.

## Verification

- Commands to run:
  `pnpm typecheck`
  `pnpm test`
  `pnpm test:coverage`
- Expected outcomes:
  All required commands pass on the landed patch, and no unresolved audit findings remain.
Completed: 2026-03-31
