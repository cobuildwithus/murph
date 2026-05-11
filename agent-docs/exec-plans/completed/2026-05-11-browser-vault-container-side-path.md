Goal (incl. success criteria):
- Remove the stale hosted container `/internal/browser-vault-refresh` execution path and the exported `refreshHostedBrowserVaultReplica` node-runner side path.
- Old container side-path callers must not execute browser-vault replica writes; if they hit the container endpoint, they receive an explicit removed response.

Constraints/Assumptions:
- Browser-vault refresh is normal runtime work and replica writes require the current runtime write fence.
- Preserve unrelated active hosted runner work and do not resolve broad browser-vault scheduling policy outside this task.
- Keep deploy-skew-only runner-container behavior unchanged unless direct call sites require narrower cleanup.

Key decisions:
- Container entrypoint keeps authentication before route removal handling so unauthorized requests do not learn route details.
- Removed side path returns a clear non-2xx JSON response instead of invoking node-runner refresh logic.

State:
- Implemented; final verification in progress.

Done:
- Read workflow/security/reliability/verification docs.
- Located container-entrypoint and node-runner side-path code.
- Removed container execution/parsing for `/internal/browser-vault-refresh`; authenticated callers now get `410`.
- Removed `refreshHostedBrowserVaultReplica` from `apps/cloudflare/src/node-runner.ts`.
- Deleted stale node-runner browser-vault refresh tests and replaced stale runner-container refresh lifecycle tests with deploy-skew throw coverage.
- Updated durable docs to describe browser-vault refresh as normal runtime work under the active write fence.
- Security/privacy review found no scoped issues.
- Coverage pass added unauthorized removed-route coverage.
- Focused checks passed: Cloudflare typecheck, container-entrypoint test, browser-vault runner-platform tests, runner-container deploy-skew throw test, and `git diff --check`.
- Full `pnpm verify:acceptance` remains blocked by unrelated assistant-runtime liveness test type errors in current branch state.

Now:
- Close plan/ledger and create the scoped commit if safe.

Next:
- Handoff with verification notes and unrelated acceptance failure details.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `apps/cloudflare/src/container-entrypoint.ts`
- `apps/cloudflare/src/node-runner.ts`
- `apps/cloudflare/test/node-runner-browser-vault-refresh.test.ts`
- `apps/cloudflare/test/runner-container.test.ts`
- `apps/cloudflare/test/user-runner-alarm.test.ts`
- `pnpm --dir apps/cloudflare test -- ...` or `pnpm test:diff ...`
Status: completed
Updated: 2026-05-11
Completed: 2026-05-11
