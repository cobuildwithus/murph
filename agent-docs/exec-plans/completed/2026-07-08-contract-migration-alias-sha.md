# Hosted Web Contract Migration Alias SHA Fix

## Goal

Fix the post-deploy contract migration workflow so it verifies the current Vercel production alias by resolving the alias deployment and reading the deployment Git SHA from the deployment API.

## Constraints

- Do not print or commit secrets or local `.env` contents.
- Keep the workflow fail-closed when it cannot prove the production alias commit.
- Do not add another migration; the existing no-op smoke migration should remain the pending proof.
- Preserve the drain wait and final alias check before SQL.

## Plan

1. Patch the workflow to extract the alias deployment id/url.
2. Fetch the resolved deployment with `withGitRepoInfo=true`.
3. Compare only `gitSource.sha` to the deployment-status SHA.
4. Move the Vercel response parsing into a tested workflow helper.
5. Keep the direct database secret out of the alias-proof step; expose it only to the gated migration step.
6. Run focused and scoped verification, commit, open PR, merge, then monitor production deploy plus contract migration workflow.

## Verification

- `pnpm --dir apps/web test:prepared production-migration-guard.test.ts`
- `bash scripts/workspace-verify.sh test:diff .github/workflows/hosted-web-contract-migrations.yml apps/web/scripts/resolve-vercel-production-alias-sha.ts apps/web/test/production-migration-guard.test.ts agent-docs/exec-plans/completed/2026-07-08-contract-migration-alias-sha.md`
- `git diff --check`

## State

ReviewGPT round 1 accepted a spoofable-metadata finding. ReviewGPT round 2 accepted that provider response parsing needed executable coverage, not just workflow string checks. ReviewGPT round 3 accepted that the proof helper must not run with the direct DB secret in scope before the alias gate. ReviewGPT round 4 accepted that helper internals should not be exported only for tests. ReviewGPT round 5 accepted that the migration step must not trust a stale proof-step output before SQL. Prior workflow runs failed after the drain wait because the alias response did not include `deployment.meta.githubCommitSha`. The workflow now resolves the alias deployment through a tested helper, requires `gitSource.sha` from the deployment API, runs contract migrations from a separate gated step that receives the direct DB secret only after the alias proof output is true, re-runs the alias proof with DB env stripped immediately before SQL, and keeps helper parser/URL-builder functions private. Focused guard, apps/web typecheck, scoped `test:diff`, and `git diff --check` passed after the fallback removal and helper coverage.
Status: completed
Updated: 2026-07-08
Completed: 2026-07-08
