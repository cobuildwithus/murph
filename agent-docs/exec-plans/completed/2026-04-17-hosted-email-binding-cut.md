## Goal

Apply the downloaded hosted-email patch intent by replacing Cloudflare REST raw-send usage with the native Worker `send_email` binding while preserving Murph's raw-MIME threading and stable reply-alias model.

## Scope

- `apps/cloudflare/src/hosted-email/**`
- `apps/cloudflare/src/{hosted-env-policy,runner-outbound/results,worker-contracts}.ts`
- `apps/cloudflare/scripts/deploy-automation/**`
- `apps/cloudflare/{README.md,DEPLOY.md,wrangler.jsonc,vitest.node.workspace.ts}`
- focused `apps/cloudflare/test/**`
- `packages/hosted-execution/src/hosted-email.ts`
- focused `packages/hosted-execution/test/**`

## Constraints

- Keep the web control-plane, reply-alias routing, raw `.eml` storage, and execution-outbox architecture unchanged.
- Preserve unrelated in-flight `apps/cloudflare` and assistant/runtime branch work.
- Keep the diff scoped to the downloaded patch's transport/readiness/deploy/test/docs changes.

## Verification

- Repo-required scoped verification for touched owners:
  - `pnpm typecheck`
  - truthful diff-aware or owner-level coverage for `apps/cloudflare` and `packages/hosted-execution`
- Required completion-workflow audit passes for this repo task class before handoff.
Status: completed
Updated: 2026-04-17
Completed: 2026-04-17
