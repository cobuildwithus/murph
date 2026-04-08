# Raise owned @murphai/device-syncd provider coverage

Status: completed
Created: 2026-04-08
Updated: 2026-04-08

## Goal

- Raise the owned `packages/device-syncd` provider files above the shared per-file coverage gates without changing provider behavior or touching shared/root coverage config.
- Keep the package-local `vitest.config.ts` on the shared default coverage helper with no lower override.
- Preserve the current dirty shared worktree, especially the existing in-flight provider and non-provider edits already present under `packages/device-syncd/**`.

## Success criteria

- Focused source and test edits stay within the owned provider lane:
  - `packages/device-syncd/src/providers/{garmin.ts,oura.ts,oura-webhooks.ts,shared-oauth.ts,whoop.ts}`
  - provider-owned package-local tests, with `http.test.ts` only if strictly needed for provider coverage
- `pnpm --config.verify-deps-before-run=false --dir packages/device-syncd typecheck` passes.
- `pnpm --config.verify-deps-before-run=false --dir packages/device-syncd test:coverage` passes.
- Coverage evidence shows the owned provider files at or above the shared thresholds for lines/functions/statements/branches.

## Scope

- In scope:
- `packages/device-syncd/src/providers/{garmin.ts,oura.ts,oura-webhooks.ts,shared-oauth.ts,whoop.ts}`
- `packages/device-syncd/test/{garmin-provider.test.ts,oura-provider.test.ts,oura-webhooks.test.ts,whoop-provider.test.ts,public-ingress.test.ts,shared-oauth.test.ts}`
- `packages/device-syncd/test/http.test.ts` only when it is the smallest honest way to cover provider/public-ingress behavior
- `agent-docs/exec-plans/active/{COORDINATION_LEDGER.md,2026-04-08-device-syncd-provider-coverage.md}`
- Out of scope:
- non-provider runtime files under `packages/device-syncd/src/{http.ts,service.ts,store.ts,public-ingress.ts}`
- root/shared coverage config or other packages
- reverting or rewriting unrelated dirty edits in the package

## Constraints

- Technical constraints:
- deterministic tests only; no new harness stack
- preserve the live shared worktree and adjust around existing in-flight edits
- do not lower coverage thresholds or add curated include lists
- Product/process constraints:
- repo workflow requires the active coordination-ledger row, package-local verification, one final audit subagent pass, and a scoped commit unless blocked by a credibly unrelated failure

## Risks and mitigations

1. Risk:
   Existing dirty edits in `packages/device-syncd/**` overlap the same tests and could be accidentally overwritten.
   Mitigation:
   Read current file state first, patch minimally, and keep ownership limited to provider seams.
2. Risk:
   Provider coverage gaps may require source changes that start altering behavior instead of just exercising branches.
   Mitigation:
   Prefer tests first; only add the smallest behavior-preserving guards where a branch is genuinely unreachable or recursive.
3. Risk:
   Full package coverage can take a while and may fail on unrelated package-local worktree state.
   Mitigation:
   Use package-local commands with `--config.verify-deps-before-run=false`, capture exact failures, and fall back to scoped reasoning only if the separation is defensible.

## Tasks

1. Inspect the owned provider files, current tests, and current package-local coverage state.
2. Add the smallest honest provider/test changes needed to cover remaining branch/function gaps.
3. Run package-local typecheck and coverage, then inspect the owned-file metrics.
4. Run the required `task-finish-review` audit pass and address any findings.
5. Finish with a scoped commit covering only the owned lane paths plus the plan artifact.

## Decisions

- Start from the live in-flight provider edits already present in the worktree rather than trying to recreate the lane from scratch.
- Prefer test-only coverage improvements; source edits are allowed only for behavior-preserving guards that prevent dead recursion or impossible states.

## Verification

- Commands to run:
- `pnpm --config.verify-deps-before-run=false --dir packages/device-syncd typecheck`
- `pnpm --config.verify-deps-before-run=false --dir packages/device-syncd test:coverage`
- Expected outcomes:
- package-local typecheck passes
- coverage output shows the owned provider files above the shared thresholds
Completed: 2026-04-08
