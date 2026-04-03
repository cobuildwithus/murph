# Hosted Email Deploy Wiring

## Goal

Close the hosted email deployment automation gap so the Cloudflare deploy helper, generated worker-secrets payload, and GitHub Actions workflow all expose the hosted email env and secret keys already used by the runtime contract and bootstrap tests.

## Scope

- Add the missing hosted email Cloudflare/env keys to the deploy automation optional worker var and secret lists.
- Add the same keys to the manual GitHub Actions deploy workflow environment mapping.
- Update Cloudflare deploy/runtime docs so the documented automation surface matches the actual runtime contract.
- Add or update focused tests that prove the generated config and rendered secrets include the hosted email keys.

## Constraints

- Preserve unrelated dirty worktree edits, especially the existing verification-lane changes already in progress.
- Keep the change narrow to deploy automation/workflow/docs for hosted email; do not redesign the hosted email runtime contract itself.
- Do not print or fixture real secret values; use test placeholders only.

## Verification

- Focused `apps/cloudflare` deploy-automation tests
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`

## Outcome

- Completed. The Cloudflare deploy helper, rendered worker-secrets payload, manual GitHub Actions deploy workflow, and Cloudflare deploy/runtime docs now all surface the hosted-email env and secret keys already consumed by the runtime contract.
Status: completed
Updated: 2026-04-03

## Final Verification

- `pnpm --dir ../.. exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/deploy-automation.test.ts --no-coverage`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- Direct deploy-surface proof: rendered deploy config and worker secrets with placeholder `HOSTED_EMAIL_*` values and confirmed the generated outputs contained the hosted-email vars and secrets
Completed: 2026-04-03
