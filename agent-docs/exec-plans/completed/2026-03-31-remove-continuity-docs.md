# Remove obsolete continuity docs

Status: completed
Created: 2026-03-31
Updated: 2026-03-31

## Goal

- Remove the requested root-level `CONTINUITY_*.md` files from the repository, verify the repo state as far as the current branch allows, and land the deletion in a scoped commit without disturbing unrelated in-progress work.

## Success criteria

- The ten requested continuity docs are deleted and no other requested file content changes are introduced.
- Required repo verification commands are run and their outcomes are recorded accurately.
- The commit includes only the intended continuity-doc removals plus the completed plan artifact created for this lane.
- The deletion commit is pushed to the current branch.

## Scope

- In scope:
  - Deleting the named root-level continuity docs.
  - Creating and closing the narrow execution plan needed for repo verification/commit workflow.
  - Running the required verification commands and recording any unrelated pre-existing failures.
  - Committing and pushing only the intended removals and plan artifact.
- Out of scope:
  - Editing unrelated worktree changes already in progress elsewhere in the repo.
  - Rewriting immutable historical plan snapshots that mention these continuity docs.
  - Any product, runtime, or test-behavior changes beyond this docs cleanup.

## Constraints

- Technical constraints:
  - Preserve unrelated dirty worktree edits.
  - Do not include the active coordination ledger in the final commit.
- Product/process constraints:
  - Follow the docs/process-only verification baseline unless blocked by unrelated existing branch failures.
  - Use the plan-bearing finish path for the final commit because the repo test wrapper requires an active execution plan for this change set size.

## Risks and mitigations

1. Risk: Unrelated in-progress files could be swept into the commit.
   Mitigation: Stage only the deleted continuity docs and the closed plan artifact, then inspect the staged diff before committing.
2. Risk: Repo-wide verification may fail for reasons unrelated to these deletions.
   Mitigation: Run the required commands anyway and record exact failing commands/targets in the plan and handoff.

## Tasks

1. Confirm repo workflow/docs guidance and inspect the current worktree for unrelated edits.
2. Delete the requested continuity docs only.
3. Run `pnpm typecheck`, `pnpm test`, and `pnpm test:coverage`, capturing any unrelated pre-existing failures.
4. Close the execution plan and create a scoped commit for the deletions plus plan artifact.
5. Push the commit to the current branch.

## Decisions

- Do not modify the immutable completed plan that references `CONTINUITY_pro-watch-patch-landings.md`; leave historical snapshots intact.
- Use the repo-provided execution-plan workflow because `pnpm test` enforces an active plan for this change set size.
- Use scoped docs-proof alongside the required repo-wide commands because the branch already has unrelated verification failures outside the deleted files.

## Verification

- Commands run:
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm test:coverage`
  - `for f in CONTINUITY_assistant-reliability-remediations.md CONTINUITY_assistant-runtime-extraction.md CONTINUITY_assistant-runtime-reliability-refactor.md CONTINUITY_device-sync-hosted-parity.md CONTINUITY_goal-entity-definition.md CONTINUITY_hosted-side-effect-outbox.md CONTINUITY_murph-rename-migration.md CONTINUITY_oura-webhook-correctness.md CONTINUITY_pro-watch-patch-landings.md CONTINUITY_registry-entity-rollout.md; do test ! -e "$f" || exit 1; done`
- Outcomes:
  - `pnpm typecheck`: failed in `packages/cli/test/gateway-local-service.test.ts` with `TS2353` because `dispatchMode` is not a known property on the tested object type. Unrelated to these docs deletions.
  - `pnpm test`: failed in `packages/assistantd/test/http.test.ts` because `packages/gateway-core/src/index.ts` imports missing `./contracts.js`. Unrelated to these docs deletions.
  - `pnpm test:coverage`: failed with `ENOENT` for `coverage/.tmp/coverage-16.json` during Vitest V8 coverage generation after the same branch was already exercising unrelated gateway-core/assistantd work.
  - Direct proof passed: all ten requested continuity docs are absent from the worktree.
Completed: 2026-03-31
