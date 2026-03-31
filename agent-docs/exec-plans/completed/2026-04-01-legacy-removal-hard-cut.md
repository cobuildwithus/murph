# Hard cut legacy removal

Status: completed
Created: 2026-04-01
Updated: 2026-04-01

## Goal

- Remove the remaining legacy compatibility surfaces covered by the supplied audit patch now that the repo can hard-cut stale local state and dead alias paths.

## Success criteria

- Assistant-core no longer exposes CLI-shaped inbox or vault service aliases in source submodules.
- The repo no longer carries the `murph/vault-cli-services` path alias or related compatibility assertions.
- Gateway opaque id readers reject legacy v1 envelopes and tests cover the hard failure.
- Workout-format scans no longer skip stale pre-canonical markdown and tests cover the new failure mode.
- The audit snapshot doc is present and indexed, and focused verification passes or any unrelated failure is documented.

## Scope

- In scope:
- Remove dead assistant-core alias exports/types.
- Remove the remaining repo alias path for `murph/vault-cli-services`.
- Hard-cut gateway opaque-id v1 reads and update tests/fixtures.
- Hard-cut workout-format stale-doc tolerance and update CLI tests.
- Add the supplied legacy-removal audit snapshot and index entry.
- Out of scope:
- Broad service-boundary refactors beyond the remaining alias cleanup.
- Migrating or repairing stale local user data beyond documenting the consequence of the hard cut.

## Constraints

- Technical constraints:
- Preserve unrelated in-flight worktree edits.
- Patch against the current tree rather than assuming the supplied diff applies cleanly; several CLI shim removals are already landed.
- Product/process constraints:
- User explicitly approved the hard cut because there are no live deployments.
- Skip the optional `simplify` audit for this turn, but still complete the remaining required verification/review flow unless another user instruction says otherwise.

## Risks and mitigations

1. Risk: stale local gateway projections or queued intents with v1 opaque ids stop resolving.
   Mitigation: make the hard failure explicit in tests and document the stale-state consequence in the audit snapshot.
2. Risk: one malformed workout-format markdown file now blocks list/show/log flows.
   Mitigation: update CLI tests to assert the new hard failure and document the cleanup expectation.
3. Risk: some supplied patch hunks target files already removed from the CLI package.
   Mitigation: apply only still-relevant deltas and leave already-landed hard cuts untouched.

## Tasks

1. Register the lane and add the execution plan.
2. Apply the still-relevant hard-cut code, test, and doc changes.
3. Run focused verification, complete the remaining audit/review step, and finish with a scoped commit.

## Decisions

- Treat the supplied patch as behavioral intent, not as overwrite authority.
- Accept the stale-state breakage for gateway ids and workout-format scans because the repo has no live deployment compatibility obligation.

## Verification

- Commands to run:
- `pnpm typecheck`
- `pnpm --dir packages/assistant-runtime test assistant-core-boundary.test.ts`
- `pnpm --dir packages/cli test cli-expansion-workout.test.ts`
- `pnpm --dir packages/cli test gateway-local-service.test.ts`
- `pnpm --dir apps/cloudflare test user-runner.test.ts`
- Expected outcomes:
- Typecheck still passes with the removed aliases and path mappings.
- Focused tests pass with the new hard-cut behavior.
- Actual outcomes:
- `pnpm typecheck` failed in the existing workspace build lane with unrelated `packages/importers/src/device-providers/{garmin-helpers,oura,shared}.ts` resolution errors for `@murph/contracts`.
- `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts test/assistant-core-boundary.test.ts --no-coverage` passed.
- `pnpm exec vitest run --config packages/cli/vitest.workspace.ts packages/cli/test/cli-expansion-workout.test.ts packages/cli/test/gateway-local-service.test.ts --no-coverage` passed.
- `pnpm --dir apps/cloudflare exec vitest run --config vitest.node.workspace.ts test/user-runner.test.ts --no-coverage` passed.
- `pnpm exec tsx packages/cli/scripts/verify-package-shape.ts` passed.
- `pnpm test` passed.
- `pnpm test:coverage` emitted an `ENOENT` for `coverage/.tmp/coverage-6.json` and then stalled in the existing `apps/cloudflare verify` lane; the lingering process tree was terminated after capturing the failure details.
Completed: 2026-04-01
