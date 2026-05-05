Goal (incl. success criteria):
- Update the Cloudflare app's Wrangler dependency to the version prompted by the failed hosted deploy.
- Add a GitHub Actions failure step that prints the latest Wrangler log when deploy fails, with basic secret redaction.

Constraints/Assumptions:
- Preserve unrelated dirty work in the current checkout.
- Do not print secret values, raw credentials, or personal local paths.
- Keep the deploy workflow change scoped to failure diagnostics.

Key decisions:
- Use a post-deploy `failure()` step instead of changing deploy behavior.
- Print only the latest Wrangler log tail and redact common token/secret patterns.

State:
- Implementation complete; focused checks passed.
- Full Cloudflare app verify is red from pre-existing dirty runner/provider test failures outside this task.

Done:
- Read required repo workflow, security, reliability, and Wrangler guidance.
- Updated `wrangler` to `^4.87.0`.
- Updated `@cloudflare/workers-types` to `^4.20260430.1` to satisfy Wrangler's peer range without bypassing minimum release age.
- Added a failure-only deploy workflow step that prints the latest Wrangler log tail with command parsing disabled and common secret-pattern redaction.
- Verification run:
  - `pnpm view wrangler version` -> `4.87.0`.
  - `pnpm --dir apps/cloudflare exec wrangler --version` -> `4.87.0`.
  - `ruby -e 'require "yaml"; YAML.load_file(".github/workflows/deploy-cloudflare-hosted.yml")'` passed.
  - `pnpm deps:guard` passed.
  - `pnpm deps:audit` passed.
  - `pnpm deps:ignored-builds` showed ignored `workerd` build script; no allowlist expansion.
  - `pnpm install --frozen-lockfile` passed.
  - `pnpm --dir apps/cloudflare typecheck` passed.
  - `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/wrangler-runner.test.ts` passed.
  - Direct shell simulation of the new print step passed and redacted sample bearer/token/private JWK values.
  - `pnpm logs:guard` passed.
  - `git diff --check -- .github/workflows/deploy-cloudflare-hosted.yml apps/cloudflare/package.json pnpm-lock.yaml agent-docs/exec-plans/active/2026-05-06-wrangler-log-print.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md` passed.

Now:
- Attempt scoped finish/commit or report dirty-worktree blocker.

Next:
- If commit is blocked, leave the changed files ready and report exact blocker.

Open questions (UNCONFIRMED if needed):
- Whether the unrelated Cloudflare runner/provider dirty changes will be landed before retrying `apps/cloudflare verify:parallel` is UNCONFIRMED.

Working set (files/ids/commands):
- `.github/workflows/deploy-cloudflare-hosted.yml`
- `apps/cloudflare/package.json`
- `pnpm-lock.yaml`
- `pnpm view wrangler version`
- `pnpm --dir apps/cloudflare exec wrangler --version`
- `pnpm --dir apps/cloudflare verify:parallel` failed in unrelated dirty Cloudflare tests:
  - `apps/cloudflare/test/node-runner-abort.test.ts`
  - `apps/cloudflare/test/container-entrypoint.test.ts`
  - `apps/cloudflare/test/hosted-local-e2e-support.test.ts`
Status: completed
Updated: 2026-05-06
Completed: 2026-05-06
