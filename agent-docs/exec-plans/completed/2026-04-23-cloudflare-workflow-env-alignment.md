Goal (incl. success criteria):
- Verify the suspected Cloudflare deploy-workflow env omissions against deploy-automation source, wire the real ones through the GitHub workflow, include Garmin and Strava device-sync env support, and land matching docs/tests updates. Success means the workflow forwards the verified vars/secrets, focused verification is green, and the scoped diff is committed.

Constraints/Assumptions:
- Do not read or print secret values; name-only GitHub checks are allowed.
- Keep the change scoped to the Cloudflare deploy workflow, directly coupled tests/docs/env-policy helpers, and coordination artifacts.
- Preserve unrelated working-tree edits.

Key decisions:
- Treat the listed vars/secrets as real omissions only when the deploy-automation source expects them and the workflow does not forward them.
- Wire Garmin and Strava through the same workflow pass because the device-sync runtime contract already includes both providers.
- Fix the deploy doc drift for env classification while touching the same deploy surface.
- Keep the node-runner ambient-env test scrub source-derived from the runner env policy so newly added forwarded keys do not cause future CI-only expectation drift.

State:
- completed

Done:
- Verified the listed `CF_*`, `HOSTED_*`, and device-sync env names are expected by deploy automation but missing from the workflow.
- Confirmed the workflow currently forwards only Oura/Whoop device-sync creds, not Garmin/Strava.
- Reproduced the deployed workflow failure source: `apps/cloudflare/test/node-runner.test.ts` did not scrub `HOSTED_AI_USAGE_REPORTING_SECRET` from ambient env before asserting the fallback env.
- Patched the workflow env pass-through, deploy docs, deploy-automation assertions, and node-runner ambient env isolation.
- Verified with focused node-runner repro using multiple dummy runner env keys set, full `apps/cloudflare verify` using the same dummy key set, and `git diff --check`.
- Required final review audit returned no findings; the follow-up source-derived scrub addressed its residual sync-risk note.

Now:
- Committing the scoped diff.

Next:
- Rerun the manual `cf:deploy` workflow from GitHub once this commit lands.

Open questions (UNCONFIRMED if needed):
- UNCONFIRMED: which of the newly wired GitHub environment vars/secrets already exist by name in the `production` environment.

Working set (files/ids/commands):
- `.github/workflows/deploy-cloudflare-hosted.yml`
- `apps/cloudflare/src/hosted-env-policy.ts`
- `apps/cloudflare/test/deploy-automation.test.ts`
- `apps/cloudflare/test/node-runner.test.ts`
- `apps/cloudflare/DEPLOY.md`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `HOSTED_AI_USAGE_REPORTING_SECRET=ci-dummy-secret HOSTED_AI_USAGE_STRIPE_RESTRICTED_ACCESS_KEY=rk_dummy HOSTED_AI_USAGE_VERCEL_STRIPE_BILLING_ENABLED=true VERCEL_AI_API_KEY=vercel-dummy TELEGRAM_BOT_TOKEN=telegram-dummy MURPH_WEB_SEARCH_PROVIDER=brave pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/node-runner.test.ts -t "falls back to ambient runner env only when the runtime envelope omits forwarded env entirely"` (passed)
- `HOSTED_AI_USAGE_REPORTING_SECRET=ci-dummy-secret HOSTED_AI_USAGE_STRIPE_RESTRICTED_ACCESS_KEY=rk_dummy HOSTED_AI_USAGE_VERCEL_STRIPE_BILLING_ENABLED=true VERCEL_AI_API_KEY=vercel-dummy TELEGRAM_BOT_TOKEN=telegram-dummy MURPH_WEB_SEARCH_PROVIDER=brave pnpm --dir apps/cloudflare verify` (passed)
- `git diff --check -- .github/workflows/deploy-cloudflare-hosted.yml apps/cloudflare/DEPLOY.md apps/cloudflare/test/deploy-automation.test.ts apps/cloudflare/src/hosted-env-policy.ts apps/cloudflare/test/node-runner.test.ts agent-docs/exec-plans/active/COORDINATION_LEDGER.md agent-docs/exec-plans/active/2026-04-23-cloudflare-workflow-env-alignment.md` (passed)
Status: completed
Updated: 2026-04-23
Completed: 2026-04-23
