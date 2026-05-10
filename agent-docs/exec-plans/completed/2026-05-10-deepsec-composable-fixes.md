# DeepSec Composable Fixes

Status: completed
Created: 2026-05-10
Updated: 2026-05-10

## Goal

Fix the reviewed DeepSec findings for Linq notices, scheduled measurement qualifiers, goal default dates, inbox promotion sentinels, deleted scheduled meals, and recipe edit links with the smallest durable owner-seam changes.

## Success Criteria

- Linq signup/quota notices are claimed before outbound delivery without adding a broad job framework.
- Scheduled-log measurement qualifiers reject ambiguous multi-measurement input.
- Goal default start dates use the vault timezone.
- Inbox promotion sentinels cannot be forged by capture text.
- Re-running a deleted scheduled meal occurrence creates an active next lifecycle revision.
- Recipe edit link flags map to canonical recipe link/relation state.
- Focused regressions cover the changed invariants.
- Required verification and completion audits pass, or unrelated blockers are documented.

## Scope

- In scope:
  - Hosted Linq notice claiming and focused transport/dispatch tests.
  - CLI scheduled-log qualifier parsing and recipe edit link handling.
  - Core goal default date, canonical promotion marker handling, scheduled meal lifecycle, and focused tests.
  - Vault-usecase recipe edit payload handling when needed.
- Out of scope:
  - Broad hosted side-effect/job framework.
  - General Markdown parser replacement.
  - Full meal mutation rewrite beyond explicit deterministic event lifecycle handling.
  - The other reviewed DeepSec findings not listed in this task.

## Constraints

- Keep changes narrow, simple, and composable.
- Prefer existing owner seams and helpers over new abstractions.
- Preserve unrelated dirty worktree edits and active ledger rows.
- Do not expose local usernames, home paths, secrets, raw credentials, provider identifiers, or direct personal identifiers in code, tests, docs, logs, or handoff.

## Tasks

1. Register the plan and inspect the exact owner seams/tests.
2. Implement Linq notice pre-claiming with focused regression coverage.
3. Implement CLI/core fixes and focused regressions.
4. Run scoped verification and required completion audits.
5. Commit through `scripts/finish-task`, or report any scoped-commit blocker.

## Verification

- Focused hosted Linq tests passed:
  `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-onboarding-linq-transport.test.ts apps/web/test/hosted-onboarding-linq-dispatch.test.ts apps/web/test/hosted-onboarding-webhook-idempotency.test.ts`
- Focused CLI tests passed:
  `pnpm exec vitest run --config packages/cli/vitest.workspace.ts --no-coverage packages/cli/test/recipe-save-typed-parity.test.ts packages/cli/test/scheduled-log-save-typed-parity.test.ts`
- Focused core tests passed:
  `pnpm --dir packages/core exec vitest run --config vitest.config.ts --no-coverage test/health-bank.test.ts test/canonical-mutations-boundary.test.ts test/scheduled-logs.test.ts`
- `pnpm typecheck` passed in the coverage-write audit.
- `git diff --check` passed for the touched files.
- Path-scoped `bash scripts/workspace-verify.sh test:diff ...` was blocked by unrelated pre-existing hosted Stripe billing test failures outside this plan.
- Commit was not created because a scoped commit would include unrelated dirty hunks in overlapping files.

Completed: 2026-05-10
