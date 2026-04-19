## Title

Centralize Cloudflare deploy boolean env parsing so deploy helper stages accept the same values.

## Goal

Make the deploy scripts use one shared boolean env parser with one accepted-value contract, so deploy behavior does not change depending on which stage reads the env.

## Scope

- `apps/cloudflare/scripts/deploy-automation/shared.ts`
- `apps/cloudflare/scripts/deploy-preflight.ts`
- `apps/cloudflare/scripts/deploy-worker-version.shared.ts`
- focused `apps/cloudflare/test/{deploy-preflight,deploy-worker-version}.test.ts`

## Constraints

- Keep the change scoped to deploy-helper parsing only; do not broaden into runtime or Wrangler behavior.
- Use one accepted boolean-value set everywhere these deploy helpers parse string env vars.
- Preserve existing default/fallback behavior where the caller intentionally supplies one.

## Verification

- `pnpm typecheck`
- `bash scripts/workspace-verify.sh test:diff apps/cloudflare/scripts/deploy-automation/shared.ts apps/cloudflare/scripts/deploy-preflight.ts apps/cloudflare/scripts/deploy-worker-version.shared.ts apps/cloudflare/test/deploy-preflight.test.ts apps/cloudflare/test/deploy-worker-version.test.ts`

## Notes

- The current inconsistency is `yes` being truthy in deploy preflight while version deployment only accepts `1/0/true/false`.
- The smallest safe follow-up is a shared parser plus focused regression tests for both call sites.
Status: completed
Updated: 2026-04-19
Completed: 2026-04-19
