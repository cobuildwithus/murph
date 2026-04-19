# Restore hosted local e2e lanes in apps/cloudflare

Status: completed
Created: 2026-04-19
Updated: 2026-04-19

## Goal

- Make the hosted local `apps/cloudflare` e2e lanes pass again, including the full-stack local suite and the worker-only duplicate-commit lane.

## Success criteria

- `pnpm --dir apps/cloudflare test:e2e:full-stack:local` passes.
- `pnpm --dir apps/cloudflare test:e2e:duplicate-commit:local` passes.
- Any changed production or test code has focused regression coverage for the failure mode that blocked the e2e lanes.

## Scope

- In scope:
- `apps/cloudflare` e2e scripts, harnesses, test helpers, and directly required runtime code.
- Minimal shared-package fixes only when they are required to restore the hosted local runner bundle for e2e.
- Focused verification for the touched e2e and owner lanes.
- Out of scope:
- Broad cleanup of unrelated typecheck or package-test failures outside the hosted local e2e path.
- Refactors that are not required to restore the failing e2e commands.

## Constraints

- Preserve overlapping work and honor active coordination-ledger rows.
- Keep fixes minimal and local to the e2e failure path.
- Use `gpt-5.4` high-reasoning subagents in parallel for bounded investigation and fix work.

## Risks and mitigations

1. Risk: Full-stack e2e currently fails before test execution because `runner:bundle` rebuilds shared packages.
   Mitigation: Separate bundle-build blockers from true e2e-runtime failures and only widen into shared packages when the bundle path genuinely requires it.
2. Risk: The worker-only duplicate-commit lane may have an independent runtime hang or assertion failure.
   Mitigation: Inspect it separately so its fix scope does not get tangled with the full-stack bundle path.
3. Risk: Multiple active hosted-wake lanes overlap `apps/cloudflare`.
   Mitigation: Keep edits narrow, avoid reverting adjacent behavior, and document any cross-lane dependency before landing.

## Tasks

1. Reproduce the current hosted local e2e failures and capture the first blocking errors.
2. Split failures into bundle-build blockers, worker-only runtime failures, and full-stack harness/runtime failures.
3. Fix the minimal code needed in parallel where write scopes are disjoint.
4. Re-run the affected e2e commands plus required owner verification.
5. Run required completion audits, close the plan, and commit the scoped changes.

## Decisions

- Treat the bundle-build blocker as part of the e2e repair because the published e2e command depends on `runner:bundle`.
- Keep worker delegation scoped by failure cluster so fixes can proceed in parallel without overlapping write sets.

## Verification

- Commands to run:
- `pnpm --dir apps/cloudflare test:e2e:full-stack:local`
- `pnpm --dir apps/cloudflare test:e2e:duplicate-commit:local`
- `pnpm test:diff apps/cloudflare <other touched paths>`
- Any narrower owner command needed for shared package fixes that unblock `runner:bundle`
Completed: 2026-04-19
