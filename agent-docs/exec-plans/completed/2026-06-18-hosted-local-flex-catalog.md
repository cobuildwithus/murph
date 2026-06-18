Goal (incl. success criteria):
- Fix hosted-local dev so OpenAI flex service tier requests use the same patched Codex model catalog contract as the hosted runner image.
- Success means local hosted runner startup provides a harness-owned flex-capable Codex catalog, inherited shell/env-file catalog overrides remain untrusted, and focused tests cover the behavior.

Constraints/Assumptions:
- Preserve unrelated dirty work in the checkout.
- Keep the fix local-dev scoped; do not change cron/reminder policy or production runner env trust boundaries.
- Keep model catalog data non-secret and generated from the installed Codex bundled catalog.
- Do not allow member/user runner env to redirect the catalog path.

Key decisions:
- Mirror the production Dockerfile behavior in the hosted-local harness instead of downgrading reminders away from flex.
- Treat the generated local catalog as harness-owned input, re-added after host-only Codex env stripping.

State:
- Implemented and verified. Ready to close with the scoped plan-aware commit.

Done:
- Confirmed the missed reminder failed on `Unsupported service_tier: flex`.
- Confirmed local Codex bundled `gpt-5.5` catalog lacks `flex` unless patched.
- Confirmed production runner image patches the catalog, while hosted-local startup did not provide that image-owned env contract.
- Added hosted-local startup catalog generation from `codex debug models --bundled`, patched only to add the OpenAI `flex` tier for `gpt-5.5`.
- Kept inherited catalog env values untrusted by stripping them before re-adding the harness-owned generated temp path.
- Added tests for env-file-only Wrangler handling, spoofed inherited env stripping, catalog patching, and fail-closed invalid/missing catalog cases.
- Ran focused hosted-local harness tests, scoped `test:diff`, root `pnpm typecheck`, and scoped `git diff --check`.

Now:
- Close active plan and restart local dev on the patched startup path.

Next:
- Restart local dev so the new startup env is used.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `packages/hosted-local-harness/src/dev-hosted-local/stack.ts`
- `packages/hosted-local-harness/src/dev-hosted-local/constants.ts`
- `packages/hosted-local-harness/test/dev-hosted-local/stack.test.ts`
- `packages/hosted-local-harness/test/dev-hosted-local/environment.test.ts`
- `bash scripts/workspace-verify.sh test:diff packages/hosted-local-harness/src/dev-hosted-local/constants.ts packages/hosted-local-harness/src/dev-hosted-local/stack.ts packages/hosted-local-harness/test/dev-hosted-local/stack.test.ts packages/hosted-local-harness/test/dev-hosted-local/environment.test.ts`
- `pnpm typecheck`
Status: completed
Updated: 2026-06-18
Completed: 2026-06-18
