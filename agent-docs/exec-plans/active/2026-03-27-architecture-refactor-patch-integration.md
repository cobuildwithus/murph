# Architecture Refactor Patch Integration

Status: in_progress
Created: 2026-03-27
Updated: 2026-03-27

## Goal

Integrate the supplied `healthybob-architecture-refactor-full.patch` on top of the current dirty tree without discarding newer branch work that already overlaps the same hosted-execution, Cloudflare, hosted-share, and runtime-boundary surfaces.

## Scope

- Compare the supplied patch against the current worktree and identify which hunks are already present versus still missing.
- Land the remaining patch behavior across:
  - `packages/hosted-execution` canonical builders, parsers, side-effect contracts, and slimmer event payload contracts
  - the new `@healthybob/assistant-services` hosted service boundary plus the narrower CLI/assistant-runtime packaging changes it requires
  - `apps/cloudflare` per-user runner queue/env/ref handling, parser-backed hydration, and direct control-path updates
  - `apps/web` async hosted share acceptance, internal payload hydration, and hosted-execution outbox drain wiring
- Update directly affected docs and tests only when required to keep the landed behavior truthful.

## Constraints

- Preserve unrelated dirty edits already present in the shared worktree.
- Do not revert newer branch improvements just because the supplied patch was cut from an older snapshot.
- Keep the integration behaviorally aligned with the supplied patch summary: share-by-reference, explicit runtime boundaries, async hosted share acceptance, and the internal outbox-drain seam.
- Reuse the already-active hosted execution and Cloudflare plan context where possible instead of inventing a conflicting architecture.

## Risks

1. Patch hunks may overlap rows already in flight and partially landed changes may differ structurally from the supplied patch.
   Mitigation: build a clean reference worktree from the patch, compare it to the shared tree, and manually port only the missing behavior.
2. The patch may conflict with newer runtime/package boundaries already landed in this branch.
   Mitigation: prefer the current branch shape when it already satisfies the patch's behavior and only reconcile contract mismatches that still matter.
3. Repo-wide verification may still be blocked by unrelated dirty-tree failures.
   Mitigation: run focused verification first, then the required repo commands, and explicitly separate unrelated blockers from this lane.

## Verification Plan

- Focused comparison and targeted tests for the changed hosted-execution, `apps/web`, and `apps/cloudflare` surfaces while integrating.
- Required repo commands after integration:
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm test:coverage`
- Required completion-workflow audit passes via spawned subagents:
  - `simplify`
  - `test-coverage-audit`
  - `task-finish-review`

## Working Notes

- The shared tree already contains active rows and dirty edits for assistant-runtime extraction, execution-outbox minimization, and hosted bootstrap/user-env separation; this integration must layer on top of those rather than replay them blindly.
- The patch should be treated as a behavioral reference, not as an instruction to overwrite the current branch shape file-for-file.
