# CLI Shim Moved-Checkout Recovery

Status: completed
Created: 2026-04-01
Updated: 2026-04-01

## Goal

- Keep the generated `murph` and `vault-cli` shims usable after a local repo rename or move, and document the in-flight multi-file repo change so the docs-drift guard no longer blocks verification.

## Success criteria

- Generated shims resolve the repo root from either the original generated checkout, an explicit `MURPH_REPO_ROOT`, or the current working tree ancestry.
- The stale local `murph` and `vault-cli` shims are regenerated from the patched source and no longer hard-code the pre-rename repo path.
- Targeted CLI shim tests cover moved-checkout recovery and the updated rebuild fixture behavior.
- `pnpm test` no longer fails immediately on the docs-drift "architecture-sensitive code/process changed" guard for this lane.

## Scope

- In scope:
- `agent-docs/exec-plans/active/2026-04-01-cli-shim-move-recovery.md`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `packages/cli/src/setup-services/shell.ts`
- `packages/cli/test/setup-cli.test.ts`
- Out of scope:
- Broader CLI setup UX changes beyond shim repo-root recovery.
- Unrelated repo-wide test failures already present in `pnpm test` / `pnpm test:coverage`.

## Constraints

- Technical constraints:
- Preserve the existing fast path when the originally generated repo root is still valid.
- Keep the shim Bash-compatible and avoid introducing new external dependencies.
- Product/process constraints:
- Do not weaken the repo docs-drift guard just to land this change; satisfy it with the required active-plan/documentation workflow.
- Preserve unrelated dirty-tree changes and exclude generated doc inventory or Next route-type churn from the scoped commit unless this lane intentionally changes them.

## Risks and mitigations

1. Risk: runtime repo-root discovery could resolve the wrong directory and launch from an unrelated checkout.
   Mitigation: only accept directories that look like a Murph CLI checkout by requiring `packages/cli/src/bin.ts` or `packages/cli/dist/bin.js`.
2. Risk: the shim test fixtures could drift from the generated shim template and produce false greens.
   Mitigation: update the shared expected-shim helper and add a direct moved-checkout regression test.

## Tasks

1. Patch the generated shim template to resolve the repo root at runtime and use dynamic CLI/workspace package paths.
2. Update CLI setup tests to match the new shim template and add coverage for moved-checkout recovery.
3. Regenerate the local `murph` and `vault-cli` shims from the patched source and verify the stale-path repair directly.
4. Run required verification, note any unrelated baseline failures, then finish the task through the plan-aware commit path.

## Decisions

- Use runtime repo-root discovery in the shim rather than a repo-policy exception, because the user-facing failure is caused by stale generated absolute paths after a local rename.
- Satisfy the docs-drift guard with an active execution plan for this multi-file lane instead of weakening the test wrapper.

## Verification

- Commands to run:
- `pnpm exec vitest run --config vitest.config.ts test/setup-cli.test.ts --no-coverage` in `packages/cli`
- direct shim proof: `murph run --help`
- direct shim proof: `vault-cli --help`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- Expected outcomes:
- Targeted CLI setup tests pass, including the moved-checkout regression.
- The repaired local shims launch from the renamed checkout instead of failing on the stale pre-rename path.
- `pnpm typecheck` passes.
- `pnpm test` and `pnpm test:coverage` clear the docs-drift guard; any remaining failures must be documented with exact unrelated failing targets before handoff.
Completed: 2026-04-01
