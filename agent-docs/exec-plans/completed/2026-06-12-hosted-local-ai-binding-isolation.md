Goal (incl. success criteria):
- Fix PR 139 review findings for hosted-local Workers AI safety and documented Wrangler auth behavior.
- Success means live hosted-local E2E test-routes keep `NODE_ENV=test`, use the test worker entrypoint, omit the live `AI` binding, and the worker env still carries test mode.

Constraints/Assumptions:
- Keep the fix narrow and simple; no new auth mode or opt-in flag.
- Preserve hosted-local production-fidelity behavior for ordinary `pnpm dev`.
- Do not expose secrets, local user identifiers, or home paths in docs, tests, commits, or logs.

Key decisions:
- Preserve `NODE_ENV=test` whenever hosted-local test routes are enabled.
- Document OAuth-only Wrangler child auth when Workers AI is active, because the child intentionally strips `CLOUDFLARE_API_TOKEN`.

State:
- Implementation and required verification complete; ready for scoped commit.

Done:
- Read repo routing, hosted-runtime, security, reliability, and verification docs.
- Located PR 139 branch/worktree: `dev-wrangler-prod-fidelity`.
- Preserved `NODE_ENV=test` for hosted-local test routes before Cloudflare env resolution.
- Aligned Workers AI local-dev docs/comment with OAuth-only Wrangler child auth when binding is active.
- Added stack regression for `e2e:live` test routes without a Codex provider base URL override.
- Focused stack test file passed.
- `pnpm typecheck` passed.
- `bash scripts/workspace-verify.sh test:diff packages/hosted-local-harness/src/dev-hosted-local/stack.ts packages/hosted-local-harness/src/dev-hosted-local/environment.ts packages/hosted-local-harness/README.md packages/hosted-local-harness/test/dev-hosted-local/stack.test.ts` passed.
- Completion audits:
  - `coverage-write`: no findings; no edits.
  - `security-privacy-review`: no medium-or-higher findings.
  - `task-finish-review`: accepted low finding to update this plan with verification/audit status.

Now:
- Close plan with `scripts/finish-task`.

Next:
- Push PR 139 branch.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `packages/hosted-local-harness/src/dev-hosted-local/environment.ts`
- `packages/hosted-local-harness/src/dev-hosted-local/stack.ts`
- `packages/hosted-local-harness/README.md`
- `packages/hosted-local-harness/test/dev-hosted-local/stack.test.ts`
- `pnpm --dir packages/hosted-local-harness exec vitest run --config vitest.config.ts --no-coverage test/dev-hosted-local/stack.test.ts`
- `pnpm typecheck`
- `bash scripts/workspace-verify.sh test:diff packages/hosted-local-harness/src/dev-hosted-local/stack.ts packages/hosted-local-harness/src/dev-hosted-local/environment.ts packages/hosted-local-harness/README.md packages/hosted-local-harness/test/dev-hosted-local/stack.test.ts`
Status: completed
Updated: 2026-06-11
Completed: 2026-06-11
