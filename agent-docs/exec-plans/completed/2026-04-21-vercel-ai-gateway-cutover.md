Status: completed
Created: 2026-04-21
Updated: 2026-04-21

## Goal

- Switch the hosted assistant production defaults to Vercel AI Gateway and ensure zero-data-retention env is forwarded through the Cloudflare deploy workflow.

## Success criteria

- The deploy workflow forwards `HOSTED_ASSISTANT_ZERO_DATA_RETENTION` into the Cloudflare deploy environment.
- Focused deploy-automation proof covers the zero-data-retention forwarding path.
- Production GitHub environment points hosted assistant defaults at Vercel AI Gateway.
- The production GitHub secret consumed by `HOSTED_ASSISTANT_API_KEY_ENV` is populated from the root `.env` value the user provided.

## Scope

- `.github/workflows/deploy-cloudflare-hosted.yml`
- `apps/cloudflare/test/deploy-automation.test.ts`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`

## Constraints

- Keep the change narrow to deploy wiring and production GitHub environment updates.
- Preserve unrelated dirty-tree edits already present in `apps/web/**` and `packages/assistant-runtime/**`.
- Do not expose the gateway key value in logs, diffs, comments, or handoff text.
- Reuse the existing hosted assistant env contract; do not broaden provider-alias support unless strictly required.

## Verification

- `pnpm typecheck`
- `pnpm --dir apps/cloudflare test:node -- apps/cloudflare/test/deploy-automation.test.ts`
- `git diff --check`

## Notes

- The root `.env` currently provides the gateway credential under `VERCEL_AI_GATEWAY_KEY`; production still expects the whitelisted secret env name `VERCEL_AI_API_KEY`.
Completed: 2026-04-21
