# Goal (incl. success criteria):
- Restore the production `Deploy Cloudflare Hosted Execution` workflow to green for the requested manual dispatch.
- Success means the worker deploy no longer throws during module evaluation, the touched operator-config checks pass, the fix is pushed, and a rerun of the deploy workflow finishes successfully.

# Constraints/Assumptions:
- Preserve unrelated in-progress worktree edits, especially the existing importer change outside this lane.
- Fix the smallest truthful runtime bug behind the failed deploy instead of reshaping broader deploy helpers.
- Keep verification focused on the touched owner plus the real GitHub deploy workflow rerun.

# Key decisions:
- Treat the failure as a deploy-surface module-load bug in `packages/operator-config/src/device-daemon/paths.ts`, not as a Cloudflare secret or infrastructure issue.
- Add regression coverage for the worker-like module-load case so the resolver no longer assumes `createRequire(import.meta.url)` is always valid at top level.

# State:
- in_progress

# Done:
- Dispatched workflow run `24284362205` for `Deploy Cloudflare Hosted Execution` with `environment=production`, `sync_worker_secrets=true`, and `deploy_worker=true`.
- Confirmed the run failed in `Deploy Worker` with a `createRequire` path error originating from `packages/operator-config/src/device-daemon/paths.ts`.

# Now:
- Patch the device-sync package-entry resolver to avoid deploy-time module-load failure and verify the touched operator-config owner.

# Next:
- Commit and push the fix, rerun the deploy workflow, and poll until it passes.

# Open questions (UNCONFIRMED if needed):
- UNCONFIRMED whether any additional deploy-only assumptions beyond this resolver will surface after the first rerun.

# Working set (files/ids/commands):
- Files: `packages/operator-config/src/device-daemon/paths.ts`, `packages/operator-config/test/device-daemon-runtime.test.ts`, this plan, `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- Commands: `gh run view 24284362205 --log --job 70911177143`, focused `pnpm --dir packages/operator-config ...` verification, `gh workflow run "Deploy Cloudflare Hosted Execution" ...`
Status: completed
Updated: 2026-04-12
Completed: 2026-04-12
