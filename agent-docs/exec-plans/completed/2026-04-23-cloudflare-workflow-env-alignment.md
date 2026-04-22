Goal (incl. success criteria):
- Verify the Cloudflare hosted deploy workflow against the deploy-automation optional env source lists, wire the missing vars/secrets through GitHub Actions, and keep the matching docs/tests aligned. Success means the workflow forwards the optional env surface declared by deploy automation, focused verification is green, and the scoped diff is committed.

Constraints/Assumptions:
- Do not read or print secret values; GitHub name-only checks are allowed.
- Keep the change scoped to the Cloudflare deploy workflow, directly coupled tests/docs, and coordination artifacts.
- Preserve unrelated working-tree edits.

Key decisions:
- Use the deploy-automation optional var/secret lists as the source of truth instead of hand-picking env names.
- Include device-sync provider overrides plus Garmin/Strava creds in the same workflow pass because they are part of the runtime contract.
- Keep the audit name-only for GitHub environment vars/secrets and do not hydrate secret values into shell env or logs.

State:
- in_progress

Done:
- Verified the GitHub workflow was missing optional env names that deploy automation already supports.
- Confirmed the missing surface includes runner/callback/encryption knobs, device-sync provider env, delegated billing env, TEE rotation env, and extra provider API-key secrets.

Now:
- Run focused verification and a name-only GitHub environment audit for the newly wired names.

Next:
- Complete the required audit passes and commit the scoped diff.

Open questions (UNCONFIRMED if needed):
- UNCONFIRMED: which of the newly wired GitHub environment vars/secrets already exist by name in the `production` environment.

Working set (files/ids/commands):
- `.github/workflows/deploy-cloudflare-hosted.yml`
- `apps/cloudflare/test/deploy-automation.test.ts`
- `apps/cloudflare/DEPLOY.md`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `pnpm test:diff .github/workflows/deploy-cloudflare-hosted.yml apps/cloudflare/test/deploy-automation.test.ts`
- `pnpm typecheck`
Status: completed
Updated: 2026-04-23
Completed: 2026-04-23
