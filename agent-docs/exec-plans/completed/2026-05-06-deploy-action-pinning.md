# Deploy Action Pinning

Status: completed
Updated: 2026-05-06
Completed: 2026-05-06

## Goal

Pin mutable GitHub Action refs in the Cloudflare hosted deploy workflow and reduce production-secret exposure from job scope to the deploy steps that need it.

## Success criteria

- The workflow uses full commit SHAs for all action refs.
- Production secrets are no longer defined at deploy-job scope.
- Existing deploy automation tests cover the action/ref and secret-scope invariants.
- Focused verification passes.

## Scope

- In scope: `.github/workflows/deploy-cloudflare-hosted.yml`, deploy automation workflow tests, deploy artifact validation for post-Blacksmith secret rendering.
- Out of scope: changing deploy semantics, replacing actions, changing Cloudflare/Wrangler deploy scripts.

## Constraints

- Keep the solution simple: no YAML anchors, generated workflow, or new helper framework.
- Preserve unrelated dirty work.
- Do not print or commit secrets, local paths, personal identifiers, or raw credentials.

## Risks and mitigations

1. Risk: Missing one mutable action ref.
   Mitigation: Added a workflow-shape test that requires SHA-pinned action refs.
2. Risk: Removing secrets from a step that validates prepared deploy artifacts.
   Mitigation: Kept worker-secret env on first-party deploy validation/apply steps and rendered worker secrets after third-party Blacksmith actions.

## Tasks

1. Register active work and keep scope narrow. Done.
2. Pin workflow action refs to current full SHAs. Done.
3. Move `secrets.*` values from deploy job env to relevant deploy steps. Done.
4. Render worker secrets after third-party build actions and align artifact validation. Done.
5. Update deploy automation and artifact tests. Done.
6. Run focused verification and close with a scoped commit if safe. Done.

## Decisions

- Pin every action ref in this workflow, not just the deploy job, so the workflow has one simple rule.
- Keep job-level env for non-secret configuration only.
- Split deploy artifact preparation so Worker secrets are rendered only after third-party Blacksmith actions have finished.
- Allow the Worker secrets payload to be newer than the runner bundle; the secrets file is generated after the third-party image steps by design and is still validated against the current environment.

## Verification

- `pnpm --dir apps/cloudflare exec vitest run --config vitest.node.workspace.ts --no-coverage test/deploy-automation.test.ts` passed.
- `pnpm --dir apps/cloudflare exec vitest run --config vitest.node.workspace.ts --no-coverage test/deploy-automation.test.ts test/deploy-artifacts.test.ts` passed.
- `git diff --check -- .github/workflows/deploy-cloudflare-hosted.yml apps/cloudflare/scripts/deploy-artifacts.ts apps/cloudflare/test/deploy-automation.test.ts apps/cloudflare/test/deploy-artifacts.test.ts agent-docs/exec-plans/active/2026-05-06-deploy-action-pinning.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md` passed.
- `pnpm typecheck` passed after unrelated hosted-web work in the dirty checkout was updated.
- `pnpm verify:acceptance` failed in unrelated package coverage targets, including assistant-runtime coverage, after this task's focused checks and typecheck passed.
