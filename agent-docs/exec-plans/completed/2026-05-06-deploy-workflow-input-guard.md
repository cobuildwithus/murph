# Deploy Workflow Input Guard

## Goal

Remove unsafe manual-input interpolation from the Cloudflare hosted deploy workflow and keep the invariant mechanically covered.

## Success criteria

- Deployment summary treats manual workflow inputs as data, not shell syntax.
- Existing Cloudflare deploy automation tests cover the guard.
- Focused verification passes for the workflow/test change.

## Scope

- In scope: `.github/workflows/deploy-cloudflare-hosted.yml`, deploy automation workflow tests.
- Out of scope: broad deploy workflow refactors, action pinning, job-level secret minimization.

## Constraints

- Keep the fix small and easy to maintain.
- Preserve unrelated dirty work in Cloudflare and assistant/runtime files.
- Do not print or commit secrets, local paths, personal identifiers, or raw credentials.

## Risks and mitigations

1. Risk: Overfitting the guard to one input or one line.
   Mitigation: Assert no `inputs.` GitHub expression appears inside privileged deploy `run:` bodies.

## Tasks

1. Register active work and keep the working set narrow. Done.
2. Patch deploy summary to use env-fed shell variables. Done.
3. Extend deploy automation test coverage for the workflow invariant. Done.
4. Run focused verification. Done.
5. Close the plan with a scoped commit if unrelated dirty work allows it. Now.

## Decisions

- Use the existing deploy automation test instead of a new script so workflow-shape assertions stay in one place.

## Verification

- Commands to run:
  - `pnpm --dir apps/cloudflare exec vitest run --config vitest.node.workspace.ts --no-coverage test/deploy-automation.test.ts`
  - `pnpm typecheck`
- Results:
  - `pnpm --dir apps/cloudflare exec vitest run --config vitest.node.workspace.ts --no-coverage test/deploy-automation.test.ts` passed.
  - `pnpm typecheck` passed.
  - `git diff --check -- .github/workflows/deploy-cloudflare-hosted.yml apps/cloudflare/test/deploy-automation.test.ts agent-docs/exec-plans/active/2026-05-06-deploy-workflow-input-guard.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md` passed.
Status: completed
Updated: 2026-05-06
Completed: 2026-05-06
