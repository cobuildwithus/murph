Goal (incl. success criteria):
- Restore conservative Cloudflare container rollout behavior for normal hosted execution deploys so active runner containers get a grace period instead of being cut over immediately.
- Keep an explicit emergency immediate rollout path for hotfix deploys only.
- Update directly coupled tests/docs and commit the scoped change.

Constraints/Assumptions:
- Do not change Worker version gradual rollout yet; this task is container rollout only.
- Preserve unrelated dirty-tree edits and active hosted observability/research rows.
- Cloudflare docs distinguish Worker version traffic splitting from container instance rollout.

Key decisions:
- Default `cf:deploy` should rely on configured container rollout steps/grace instead of passing `--containers-rollout=immediate`.
- Immediate container rollout should require explicit opt-in.

State:
- Ready for final audit and commit.

Done:
- Confirmed current deploy path forces immediate containers via CLI flag plus config constants.
- Restored configured gradual container rollout defaults to 300 seconds and `10,25,50,100`.
- Changed direct Wrangler deploys so `--containers-rollout=immediate` is added only for explicit hotfix deploys.
- Added workflow/docs/test coverage for the normal gradual path and explicit immediate override.
- Verified focused rollout tests, Cloudflare typecheck, Cloudflare verify, generated config render proof, scoped whitespace checks, and scoped privacy scan.
- Security/privacy and coverage audits completed with no findings or edits.

Now:
- Completed final task-finish audit; scoped commit pending.

Next:
- Commit the completed plan and rollout files with only the matching ledger-row removal staged.

Open questions (UNCONFIRMED if needed):
- Whether to implement Worker version gradual rollout later remains out of scope.

Working set (files/ids/commands):
- `.github/workflows/deploy-cloudflare-hosted.yml`
- `apps/cloudflare/DEPLOY.md`
- `apps/cloudflare/scripts/deploy-automation/wrangler-config.ts`
- `apps/cloudflare/scripts/deploy-worker-version.cli.ts`
- `apps/cloudflare/scripts/deploy-worker-version.shared.ts`
- `apps/cloudflare/wrangler.jsonc`
- `apps/cloudflare/test/container-rollout-config.test.ts`
- `apps/cloudflare/test/deploy-worker-version-cli.test.ts`
- `apps/cloudflare/test/deploy-worker-version.test.ts`
- `apps/cloudflare/test/deploy-automation.test.ts`
Status: completed
Updated: 2026-04-25
Completed: 2026-04-25
