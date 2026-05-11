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
- Active.

Done:
- Read workflow/security/reliability/verification docs.
- Located container-entrypoint and node-runner side-path code.

Now:
- Remove stale parsing/body-limit/node-runner refresh logic and update tests.

Next:
- Run focused Cloudflare checks, required audits, and final commit workflow if safe.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `apps/cloudflare/src/container-entrypoint.ts`
- `apps/cloudflare/src/node-runner.ts`
- `apps/cloudflare/test/node-runner-browser-vault-refresh.test.ts`
- `apps/cloudflare/test/runner-container.test.ts`
- `apps/cloudflare/test/user-runner-alarm.test.ts`
- `pnpm --dir apps/cloudflare test -- ...` or `pnpm test:diff ...`
