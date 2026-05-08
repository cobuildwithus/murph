Goal (incl. success criteria):
- Harden hosted-local E2E setup so test-mode runs cannot accidentally share the interactive `pnpm dev` web/worker ports, Next dev artifacts, Wrangler state, or generated hosted-local crypto authority state.
- Success: focused tests prove E2E profile/env setup rejects or avoids interactive defaults, interactive crypto state is persisted outside `apps/cloudflare/.dev.vars`, and targeted verification passes.

Constraints/Assumptions:
- Preserve unrelated dirty worktree edits and active ledger rows.
- Do not expose local identifiers or secrets in docs, code, test output, or commits.
- Keep changes scoped to hosted-local harness/test setup unless implementation evidence requires otherwise.

Key decisions:
- Mark `pnpm hosted-local e2e` suite env with `MURPH_HOSTED_LOCAL_E2E_ISOLATION_REQUIRED=1`.
- When that marker or an E2E profile reaches `startHostedLocalDevStack`, fail before startup if web/worker ports, Wrangler persist dir, Next dist mode/suffix, Stripe listener, or Linq tunnel/register settings would overlap interactive dev.
- Resolve Health Commons dev-cache invalidation from the active Next dist mode/suffix instead of hard-coding `.next-dev`.
- Outside CI, ignore shell `DATABASE_URL` in full-stack E2E scenario setup unless `MURPH_HOSTED_LOCAL_E2E_REUSE_DATABASE_URL=1` is explicitly set, so local E2E creates an ephemeral DB by default.
- Persist interactive hosted-local generated crypto state in ignored `.tmp/hosted-local-dev-crypto-state.dev.vars`; E2E profiles/markers do not read or write that file.
- Do not symlink or restore `apps/cloudflare/.dev.vars` for hosted-local E2E stacks; interactive dev still uses a temporary symlink while running, then restores any pre-existing file on shutdown.

State:
- Implementation updated for dedicated interactive crypto state; targeted verification complete, full workspace typecheck blocked by unrelated Cloudflare log guard failure.

Done:
- Initial diagnosis found `web exited with code 130` and cleanup cascade.
- Added fail-closed E2E isolation guard and focused stack tests.
- Added E2E suite isolation env marker.
- Added focused profile-default test for disabled live tunnels/listeners.
- Hardened full-stack E2E database selection against accidental local dev DB reuse.
- Ran `pnpm typecheck` successfully.
- Added dedicated interactive hosted-local crypto-state path and tests.
- Stopped hosted-local E2E stacks from touching global `apps/cloudflare/.dev.vars`.
- Ran focused hosted-local environment/stack tests successfully.

Now:
- Decide commit/closeout path in the presence of unrelated dirty ledger and active work.

Next:
- Re-run full `pnpm typecheck` after the unrelated Cloudflare raw-payload log guard failure is cleared.
- If committing later, use scoped commit tooling or clear/archive this plan once unrelated ledger overlap is safe.

Open questions (UNCONFIRMED if needed):
- Whether to add a lightweight unit test around E2E database reuse policy without invoking Postgres. UNCONFIRMED.

Working set (files/ids/commands):
- `packages/hosted-local-harness/src/e2e.ts`
- `scripts/dev-hosted-local/**`
- `apps/cloudflare/test/helpers/hosted-local-full-stack-scenario.ts`
- `scripts/hosted-local.test.ts`
- `apps/cloudflare/test/run-hosted-local-e2e.test.ts`
- `pnpm exec vitest run --config scripts/vitest.config.ts scripts/dev-hosted-local/stack.test.ts --no-coverage` passed.
- `pnpm exec vitest run --config scripts/vitest.config.ts scripts/dev-hosted-local/environment.test.ts scripts/dev-hosted-local/stack.test.ts --no-coverage` passed.
- `pnpm exec vitest run --config scripts/vitest.config.ts scripts/hosted-local.test.ts --no-coverage -t "keeps E2E profile defaults"` passed.
- `bash scripts/workspace-verify.sh test:diff ...` failed in unrelated existing repo-tools tests: Cloudflare runner-control-token local script allowlist and runtime-state assistant-usage source-resolution alias.
- `pnpm typecheck` passed.
- `pnpm exec tsc -p tsconfig.tools.json --pretty false` passed after crypto-state isolation update.
- `git diff --check -- scripts/dev-hosted-local/constants.ts scripts/dev-hosted-local/environment.ts scripts/dev-hosted-local/stack.ts scripts/dev-hosted-local/environment.test.ts scripts/dev-hosted-local/stack.test.ts agent-docs/exec-plans/active/2026-05-06-hosted-local-e2e-isolation.md` passed.
- `pnpm typecheck` failed after crypto-state isolation update on unrelated `apps/cloudflare/src/runtime-bridge-workspace.ts` raw-payload logging guard.
Status: completed
Updated: 2026-05-08
Completed: 2026-05-08
