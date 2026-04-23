# Speed up repo acceptance gates

Status: completed
Created: 2026-04-24
Updated: 2026-04-24

## Goal

- Reduce wall-clock time for repo acceptance gates, especially `pnpm typecheck` and `pnpm verify:acceptance`, without removing any checks from the default acceptance surface.

## Success criteria

- `pnpm typecheck` starts the package/app typecheck fanout as soon as the contracts build prerequisite is complete, while independent preflight guards continue in parallel.
- `pnpm verify:acceptance` can overlap the Cloudflare app verify lane with package coverage once prepared runtime artifacts exist, while keeping hosted web verification after package coverage to avoid shared Prisma/build resource conflicts.
- Durable verification docs describe the new scheduling behavior and any env escape hatches.
- Direct shell syntax checks pass, and the highest-signal repo verification commands are run or any unrelated blockers are recorded.

## Scope

- In scope:
- Root verification scheduler changes in `scripts/workspace-verify.sh`.
- Verification docs that describe command behavior.
- Docs index date alignment for touched durable docs.
- Out of scope:
- Removing typecheck, coverage, app verify, smoke, hygiene, or docs-gardening coverage.
- Changing package/app runtime code or test expectations.
- Dependency updates.

## Constraints

- Technical constraints:
- Preserve existing env overrides for concurrency and parallelism.
- Keep hosted web app verification behind package coverage in full acceptance because that lane mutates Prisma/Next build resources.
- Keep the workspace-artifact lock semantics intact for artifact-sensitive top-level commands.
- Product/process constraints:
- Preserve unrelated dirty-tree work and active ledger rows.

## Risks and mitigations

1. Risk: Overlapping an app lane with package coverage could introduce shared artifact contention.
   Mitigation: Start only the Cloudflare lane early; leave hosted web verify in the existing post-package-coverage phase.
2. Risk: Earlier typecheck fanout could hide preflight failures longer.
   Mitigation: Keep all preflight guards mandatory and terminate remaining background work on failure.

## Tasks

1. Patch `scripts/workspace-verify.sh` scheduling.
2. Update verification docs.
3. Run direct script checks and repo verification proof.
4. Review the final diff and close/commit if safe in the dirty tree.

## Decisions

- Keep the acceptance surface unchanged; this is scheduling-only speedup work.

## Verification

- Completed:
- `bash -n scripts/workspace-verify.sh` passed.
- `bash scripts/workspace-verify.sh test:diff scripts/workspace-verify.sh agent-docs/index.md agent-docs/operations/verification-and-runtime.md agent-docs/references/testing-ci-map.md agent-docs/exec-plans/active/2026-04-24-acceptance-gate-speedups.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md` passed on the repo-internal tooling/docs fast path.
- `pnpm typecheck` passed and showed the package/app typecheck fanout starting immediately after the contracts build while remaining independent preflight work continued.
- `pnpm verify:acceptance` reached the coverage phase with typecheck, doc gardening, prepared runtime artifacts, fixture smoke coverage, and early Cloudflare app verification passing, then failed in unrelated `CLI package coverage` because an active research-run plan had no matching coordination-ledger row at that time.
- `pnpm docs:drift` passed.
- After closing this plan, `pnpm verify:acceptance` was re-run. The typecheck phase, doc gardening, prepared runtime artifacts, fixture smoke coverage, and early Cloudflare app verification passed; package coverage then failed in unrelated `Hosted execution owner coverage` because an untracked hosted billing source file did not yet meet coverage thresholds.
Completed: 2026-04-24
