# Remove assistant transcript distillation

Status: completed
Created: 2026-04-03
Updated: 2026-04-03

## Goal

- Remove assistant transcript distillation from the local runtime so Murph relies on recent transcript replay, provider-native resume, and provider-native compaction instead of writing or injecting local distillation summaries.

## Success criteria

- No assistant runtime code writes, reads, exports, or injects transcript distillation records.
- Assistant-state path/contracts/runtime-event surfaces no longer expose transcript-distillation-specific entries.
- Docs and tests describe the continuity model without transcript distillation.
- Required repo verification passes for the touched assistant/runtime surfaces.

## Scope

- In scope:
- `packages/assistant-core` transcript-distillation implementation, provider injection, runtime events, and exported surface
- `packages/runtime-state` assistant-state paths that only existed for distillations
- `packages/cli` re-exports and tests tied to transcript distillation
- Durable docs that currently describe transcript distillation as part of the assistant runtime
- Out of scope:
- broader assistant memory or provider-resume redesign
- changing non-distillation assistant transcript retention limits

## Constraints

- Technical constraints:
- Preserve unrelated dirty-tree edits and keep the lane limited to distillation removal.
- Remove the feature cleanly instead of leaving dead exports, schemas, or path plumbing behind.
- Product/process constraints:
- Repo code workflow requires the coordination ledger, an active plan for this multi-file change, and the standard verification commands for the touched package surfaces.

## Risks and mitigations

1. Risk: Distillation removal leaves dead contract or export references that break the assistant runtime or tests.
   Mitigation: Trace every import/export/reference first, then remove the feature end-to-end and run the repo verification baseline.
2. Risk: The dirty worktree leads to accidental overlap with unrelated active lanes.
   Mitigation: Touch only the assistant distillation files/docs/tests and avoid reverting or reformatting unrelated edits.

## Tasks

1. Register the lane and capture the concrete removal scope.
2. Remove transcript-distillation runtime code, exports, and assistant-state plumbing.
3. Update assistant docs/tests for the new continuity model.
4. Run verification and prepare the scoped commit path.

## Decisions

- Fully remove transcript distillation rather than narrowing it to fallback-only behavior.
- Treat provider-native resume/compaction plus recent raw transcript replay as sufficient continuity for now.

## Verification

- Commands to run:
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- Expected outcomes:
- Commands pass with transcript-distillation code paths removed and updated assistant/runtime docs/tests staying consistent.
- Results:
- `pnpm typecheck`: passed
- `pnpm test`: passed
- `pnpm test:coverage`: failed in the dirty worktree because `apps/cloudflare/src/hosted-email{.ts,/routes.ts}` already had unrelated type errors in the active hosted-email lane; the assistant-runtime/package surfaces still passed during the same run.
Completed: 2026-04-03
