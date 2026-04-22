# Repair red main workflow checks and hosted e2e prerequisites

Status: completed
Created: 2026-04-22
Updated: 2026-04-22

## Goal

- Restore green `main` workflow health by fixing the currently red package-shape, package-coverage, and directly coupled hosted local E2E prerequisites without widening into unrelated hosted/runtime work.

## Success criteria

- `pnpm --dir packages/cli verify:package-shape` passes from the current tree.
- `pnpm --dir packages/assistant-engine test:coverage` passes.
- `pnpm --dir packages/contracts test:coverage` passes.
- `pnpm --dir packages/core test:coverage` passes.
- `pnpm --dir packages/query test:coverage` passes.
- The hosted local E2E commands required by `.github/workflows/cloudflare-hosted-e2e.yml` pass after any `assistant-engine` test changes.
- `pnpm release:check` or the truthful equivalent acceptance lane passes locally.
- `gh` shows the relevant workflow/check state on `main` or on the pushed fix commit as green.

## Scope

- In scope:
- Narrow code/test updates in `packages/assistant-engine`, `packages/contracts`, `packages/core`, and `packages/query` needed to satisfy the red release lane.
- Directly coupled tests and generated CLI artifact refreshes if still required by the package-shape gate.
- Hosted local E2E verification required because `packages/assistant-engine/**` changes trigger the Cloudflare hosted E2E workflow.
- Out of scope:
- Unrelated in-flight hosted typing, setup-cli onboarding UX, or Health Commons content lanes already registered in the coordination ledger.
- Broad runtime refactors or behavior changes outside the failing scheduled-log / usage-attribution / constant-alignment surfaces.

## Constraints

- Technical constraints:
- Preserve unrelated dirty-tree edits and overlapping active lanes.
- Prefer the smallest truthful coverage/test additions over production code changes unless a genuine bug is exposed.
- Do not weaken coverage thresholds or workflow enforcement to make CI pass.
- Product/process constraints:
- Follow the standard repo-change completion workflow, including required `coverage-write` and `task-finish-review` audit passes before handoff.
- If repo files change, finish with a scoped commit via `scripts/finish-task`.

## Risks and mitigations

1. Risk: Multi-package coverage work can sprawl into unrelated runtime behavior.
   Mitigation: Keep changes scoped to the exact files flagged by package coverage and the one failing core constant test.
2. Risk: `assistant-engine` edits trigger hosted E2E workflow paths not covered by package coverage alone.
   Mitigation: Run the same local hosted E2E commands used by `.github/workflows/cloudflare-hosted-e2e.yml`.
3. Risk: Existing dirty-tree plan/ledger edits could conflict with commit helpers.
   Mitigation: Keep one exact ledger row for this plan and stage only touched paths at finish time.

## Tasks

1. Reproduce the red `main` workflow failures locally and confirm the exact failing package gates.
2. Inspect the uncovered scheduled-log / usage-attribution / constants surfaces and choose the smallest truthful test updates.
3. Implement the required test or code fixes in the affected packages.
4. Run package-local coverage, hosted local E2E, and the release/acceptance lane until green.
5. Run mandatory completion audits, finish the plan, and verify workflow/check status through `gh`.

## Decisions

- Latest `main` (`15821f82e451f0289a2ffc637e309aa193719ac7`) already fixes the earlier stale CLI package-shape artifact failure; remaining red local gates are assistant-engine coverage, contracts coverage, core coverage plus one core constants test, and query coverage.
- Because the intended fix touches `packages/assistant-engine/**`, the hosted local E2E workflow is treated as required local proof even though the current red `main` push workflow is the release lane.
- The latest failing `main` GitHub run inspected during this repair was `Murph Host Support` run `24771795077`, where `Release checks (ubuntu)` failed first on stale Cloudflare hosted-local harness typing and later exposed stale setup-cli and hosted-web test expectations once the earlier blockers were removed.

## Verification

- Commands to run:
- `pnpm --dir packages/cli verify:package-shape`
- `pnpm --dir packages/assistant-engine test:coverage`
- `pnpm --dir packages/contracts test:coverage`
- `pnpm --dir packages/core test:coverage`
- `pnpm --dir packages/query test:coverage`
- `pnpm --dir apps/cloudflare test:e2e:linq-delivery:local`
- `pnpm --dir apps/cloudflare test:e2e:telegram:local`
- `pnpm --dir apps/cloudflare test:e2e:duplicate-commit:local`
- `pnpm release:check`
- `gh run list --branch main --limit 10 --json databaseId,headSha,status,conclusion,workflowName`
- `gh run view <run-id> --json jobs`
- Expected outcomes:
- All listed commands complete successfully and the relevant GH workflow state is green.

## Outcomes

- Local package coverage is green for `packages/contracts`, `packages/query`, `packages/core`, `packages/assistant-engine`, and `packages/setup-cli`.
- `pnpm --dir apps/cloudflare typecheck` is green.
- Hosted-local direct proof is green for:
- `pnpm --dir apps/cloudflare test:e2e:linq-delivery:local`
- `pnpm --dir apps/cloudflare test:e2e:telegram:local`
- `pnpm --dir apps/cloudflare test:e2e:duplicate-commit:local`
- `pnpm release:check` is green with the standard non-blocking hosted-web lint warnings only.
- Required completion audits completed:
- `coverage-write` on `gpt-5.4-mini`: no additional proof needed, no edits made.
- `task-finish-review`: no findings; residual risk limited to needing one real remote GitHub Actions run to confirm the hosted-local Postgres service on GitHub runners.
Completed: 2026-04-22
