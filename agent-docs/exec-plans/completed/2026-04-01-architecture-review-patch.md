# Land supplied architecture review patch

Status: completed
Created: 2026-04-01
Updated: 2026-04-01

## Goal

- Land the supplied architecture-review patch onto the live tree without overwriting unrelated edits, preserving the intended contract-model deduplication, hosted bundle-ref equality cleanup, review doc addition, and focused regression coverage.

## Success criteria

- The supplied patch intent is reflected in the live code and docs, adjusted only where the current tree requires a safe merge.
- Runtime-state and Cloudflare hosted bundle-ref comparisons use one shared helper.
- Core/query/shared helper types and constants are deduplicated onto contract-owned definitions where the live tree supports that change cleanly.
- Required verification is run: `pnpm typecheck`, `pnpm test`, and `pnpm test:coverage`.
- The mandatory `task-finish-review` audit pass is completed and any blocking findings are resolved.

## Scope

- In scope:
  - `apps/cloudflare` hosted bundle-ref equality cleanup.
  - `packages/runtime-state` shared bundle-ref helper plus focused tests.
  - `packages/core`, `packages/query`, and selected `packages/assistant-core` helper/type deduplication onto `@murph/contracts`.
  - Durable doc updates for the 2026-03-31 architecture review.
- Out of scope:
  - Broader assistant-core service-surface refactors beyond what is needed to keep this patch compiling.
  - Unrelated dirty-tree edits already present in the workspace.

## Constraints

- Technical constraints:
  - Preserve adjacent user/agent edits in the dirty worktree.
  - Do not introduce cross-package dependency cycles or reach into sibling package internals.
  - Keep hosted bundle identity based on `hash + key + size`; treat `updatedAt` as metadata only.
- Product/process constraints:
  - Use the coordination ledger while the task is active.
  - Run the repo-required verification and completion-review workflow before handoff.
  - Commit with the repo helper flow when the task is complete.

## Risks and mitigations

1. Risk: The supplied patch assumes stricter shared JSON typing than the current assistant-core service layer supports.
   Mitigation: Keep the safe deduplication slices, but narrow any live-tree-incompatible type tightening instead of forcing a wider refactor.
2. Risk: Hosted bundle-ref equality changes could affect finalize/idempotency behavior.
   Mitigation: Add focused regression coverage for the shared helper and rerun the required hosted/runtime verification.

## Tasks

1. Port the supplied patch intent onto the live tree, resolving stale-context mismatches safely.
2. Add/update focused regression tests for contract-model alignment and hosted bundle-ref equality behavior.
3. Run required verification, fix any regressions, and collect direct proof.
4. Run the mandatory final review audit, address findings, and finish with a scoped commit.

## Decisions

- Keep `packages/assistant-core/src/health-cli-method-types.ts` on its broader local `Record<string, unknown>` alias for this landing because the stricter contract `JsonObject` ripples into unrelated existing service surfaces and fails typecheck in the current tree.

## Verification

- Commands to run:
  - `pnpm exec vitest run --coverage.enabled=false packages/core/test/contract-model-alignment.test.ts packages/runtime-state/test/hosted-bundle.test.ts`
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm test:coverage`
- Expected outcomes:
  - Focused tests pass and confirm the intended contract alignment and bundle-ref identity behavior.
  - Repo-required commands pass, or any failure is documented as credibly unrelated to this diff.
- Results:
  - `pnpm exec vitest run --coverage.enabled=false packages/core/test/contract-model-alignment.test.ts packages/runtime-state/test/hosted-bundle.test.ts` passed.
  - `pnpm --dir apps/cloudflare exec vitest run --config vitest.node.workspace.ts test/user-runner.test.ts --no-coverage` passed after adding direct Cloudflare boundary coverage for `updatedAt`-only bundle-ref changes.
  - `pnpm --dir packages/assistant-core typecheck` passed.
  - `pnpm --dir packages/core typecheck` passed.
  - `pnpm --dir packages/query typecheck` passed.
  - `pnpm --dir packages/runtime-state typecheck` passed.
  - `pnpm typecheck` failed in `packages/cli/test/assistant-harness.test.ts` because TypeScript could not resolve `zod` and `ai`; this appears unrelated to the landed diff.
  - `pnpm test` failed in `packages/cli/scripts/verify-package-shape.ts` with `package.json package-local scripts must not point at legacy .mjs files`; this appears unrelated to the landed diff.
  - `pnpm test:coverage` failed on the same `packages/cli/scripts/verify-package-shape.ts` issue; this appears unrelated to the landed diff.
  - Required `task-finish-review` audit completed with two low findings; both were addressed, and the follow-up audit reported no remaining findings in scope.
Completed: 2026-04-01
