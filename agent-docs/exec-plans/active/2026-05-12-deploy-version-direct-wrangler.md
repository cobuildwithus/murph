# Simplify Cloudflare deploy helper to direct Wrangler

Status: active
Created: 2026-05-12
Updated: 2026-05-12

## Goal

- Simplify the Cloudflare hosted execution deploy helper so its public result
  and workflow outputs describe the direct Wrangler deploy path that is actually
  supported.
- Preserve artifact rendering/validation, direct `wrangler deploy`,
  `wrangler deployments status --json`, and deployed smoke version selection.

## Success criteria

- Dead version-upload/rollout fields are removed from the deployment result and
  tests.
- The deploy workflow no longer exports or consumes the one-value deployment
  mode setting.
- Durable deploy docs describe direct Wrangler as the normal path and avoid
  implying a helper-owned version/deployment split.
- Focused Cloudflare deploy-helper tests and typecheck/diff verification pass,
  or any blocker is clearly recorded.

## Scope

- In scope:
  - `apps/cloudflare/scripts/deploy-worker-version.*`
  - focused deploy-helper tests
  - `.github/workflows/deploy-cloudflare-hosted.yml`
  - deploy architecture/docs references that mention the old split
- Out of scope:
  - switching to `wrangler versions upload/deploy`
  - changing deployed smoke semantics
  - changing runner/container lifecycle behavior

## Constraints

- Technical constraints:
  - Keep Durable Object migrations on `wrangler deploy`.
  - Keep the smoke version derived from the post-deploy Wrangler deployment
    status.
  - Keep container rollout handling as Wrangler `--containers-rollout`, not a
    custom Worker version rollout abstraction.
- Product/process constraints:
  - Preserve unrelated dirty hosted-runner work.
  - Use the active-plan finish path before handoff.

## Risks and mitigations

1. Risk: Removing outputs breaks workflow consumers.
   Mitigation: Search for all current output/env consumers and update only the
   repo-owned ones that exist.
2. Risk: Simplification hides container rollout behavior.
   Mitigation: Keep docs and result fields focused on Worker deployment status
   while leaving deployed smoke as the runtime proof.

## Tasks

1. Shrink the deployment result/settings types to direct Wrangler concepts.
2. Update CLI logging, GitHub outputs, tests, and workflow env references.
3. Update durable docs for direct deploy semantics.
4. Run focused verification and required completion audits.
5. Finish the active plan with a scoped commit if the unrelated dirty worktree
   permits it.

## Decisions

- Keep `smokeVersionId` and final deployment traffic because the deployed smoke
  depends on them.
- Remove `DeploymentMode`, `candidateVersionId`, `uploadedVersionId`,
  `rolloutPercentage`, and `currentDeploymentVersions`.

## Verification

- Commands to run:
  - focused deploy-helper Vitest command
  - `bash scripts/workspace-verify.sh test:diff <touched paths>`
  - `pnpm typecheck`
- Expected outcomes:
  - Commands pass, or failures are attributable to unrelated existing work.
