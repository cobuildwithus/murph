# Goal (incl. success criteria):
- Restore `pnpm cf:deploy:immediate` to the documented 5 minute hosted runner idle TTL by passing `runner_idle_ttl_ms=300000`.
- Add a narrow regression guard proving the root package script does not hardcode the previous 12 hour debug override.

# Constraints/Assumptions:
- Keep the change scoped to the deploy helper script surface and focused tests.
- Preserve unrelated active runner/ledger work in the dirty worktree.
- Do not print secrets or local identifiers.

# Key decisions:
- Treat the 12 hour value as a temporary debug override that should not remain in the checked-in immediate deploy script.

# State:
- Implementation and scoped verification complete; ready to close.

# Done:
- Confirmed the root package script hardcodes `runner_idle_ttl_ms=43200000`.
- Updated `cf:deploy:immediate` to pass `runner_idle_ttl_ms=300000`.
- Added a focused deploy-automation test guarding the root script.
- Fixed final-review finding by parsing `-f` workflow inputs instead of relying on substring matching.
- PASS: `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts --no-coverage apps/cloudflare/test/deploy-automation.test.ts`.
- PASS: `pnpm test:diff package.json apps/cloudflare/test/deploy-automation.test.ts` including `apps/cloudflare verify`.
- PASS: `git diff --check -- package.json apps/cloudflare/test/deploy-automation.test.ts agent-docs/exec-plans/active/2026-05-10-cf-immediate-idle-ttl.md`.
- PASS: direct Node package-script assertion for exact `runner_idle_ttl_ms=300000`.
- FAIL unrelated: `pnpm typecheck` still fails in `packages/cli/test/inbox-cli.test.ts` because an inbox runtime test double is missing `getAttachment`; this task did not touch CLI or inbox runtime types.

# Now:
- Close plan and commit scoped files.

# Next:
- Report commit and verification.

# Open questions (UNCONFIRMED if needed):
- None.

# Working set (files/ids/commands):
- `package.json`
- `apps/cloudflare/test/deploy-automation.test.ts`
- `pnpm test:diff package.json apps/cloudflare/test/deploy-automation.test.ts`
- `pnpm typecheck`
Status: completed
Updated: 2026-05-10
Completed: 2026-05-10
