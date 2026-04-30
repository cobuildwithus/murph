# Junction Deploy Env Wiring

## Goal

Wire the production Junction provider configuration names through the Cloudflare hosted-execution deploy surface so GitHub environment secrets/vars can render into worker config once the Junction provider lands.

## Scope

- Add Junction env names to the shared deploy variable/secret lists.
- Bind those names in `.github/workflows/deploy-cloudflare-hosted.yml`.
- Update the Cloudflare deploy docs and focused deploy-env tests.

## Constraints

- Do not print, fixture, or commit real secret values.
- Keep Vercel development/preview unrelated to this change.
- Keep Junction secrets as provider/operator config, not per-account data.
- Do not add the Junction provider implementation in this slice.

## Verification

- Passed: `pnpm --dir apps/cloudflare exec vitest run --config vitest.node.workspace.ts test/deploy-automation.test.ts test/runner-env.test.ts --no-coverage`.
- Passed: `git diff --check` for touched files.
- Passed: `bash scripts/workspace-verify.sh test:diff` for touched files, including `apps/cloudflare verify`.
- Passed: required security/privacy and task-finish review passes with no findings.

## State

Ready to close. The coordination ledger was already dirty from unrelated active work, so the safe scoped commit should avoid staging unrelated ledger changes.
Status: completed
Updated: 2026-05-01
Completed: 2026-05-01
