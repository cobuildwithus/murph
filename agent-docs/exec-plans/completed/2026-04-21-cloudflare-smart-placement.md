Goal (incl. success criteria):
- Enable Cloudflare Smart Placement by default for the hosted Worker config.
- The checked-in Wrangler scaffold and rendered deploy config both include `placement.mode = "smart"`.
- Validation covers config shape and the existing Cloudflare app test/typecheck lane as far as current dirty-tree state allows.

Constraints/Assumptions:
- Preserve unrelated dirty worktree edits.
- Do not change Cloudflare account resources or deploy live infrastructure.
- Use Cloudflare/Wrangler primary docs and local Wrangler schema as the config authority.
- Production deploys use the rendered config, so scaffold-only changes are insufficient.

Key decisions:
- Add a static `placement: { mode: "smart" }` setting rather than adding an environment toggle, because the requested default is universal for this Worker.

State:
- Complete; ready to close and commit.

Done:
- Read repo routing docs and Cloudflare app deploy docs.
- Confirmed Cloudflare docs and Wrangler config schema support `placement.mode = "smart"`.
- Updated the checked-in Wrangler scaffold and generated deploy-config builder.
- Added test assertions for generated config and scaffold/render alignment.
- Verified the rendered deploy config includes Smart Placement.

Now:
- Closing the active plan and committing the scoped change.

Next:
- None.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `apps/cloudflare/wrangler.jsonc`
- `apps/cloudflare/scripts/deploy-automation/wrangler-config.ts`
- `apps/cloudflare/test/deploy-automation.test.ts`
- `agent-docs/exec-plans/active/2026-04-21-cloudflare-smart-placement.md`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `pnpm --dir apps/cloudflare test -- --runInBand test/deploy-automation.test.ts`
- `pnpm --dir apps/cloudflare verify`
- `pnpm typecheck`
- `bash scripts/workspace-verify.sh test:diff apps/cloudflare/wrangler.jsonc apps/cloudflare/scripts/deploy-automation/wrangler-config.ts apps/cloudflare/test/deploy-automation.test.ts`
Status: completed
Updated: 2026-04-21
Completed: 2026-04-21
