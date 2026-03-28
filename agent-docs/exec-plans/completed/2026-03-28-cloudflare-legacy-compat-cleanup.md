# Cloudflare Legacy Compatibility Cleanup

Status: completed
Created: 2026-03-28
Updated: 2026-03-28

## Goal

Remove hosted-execution and Cloudflare compatibility shims that only exist for pre-SQLite Durable Object state, old transient journal/object layouts, and pre-canonical env/route names, while leaving the first real deploy on a single canonical contract.

## Scope

- `packages/hosted-execution/{src/**,README.md,test/**}`
- `packages/runtime-state/{src/**,test/**}`
- `apps/cloudflare/{src/**,README.md,DEPLOY.md,test/**,scripts/**,wrangler.jsonc}`
- `apps/web/{.env.example,README.md,src/lib/hosted-execution/dispatch.ts,test/hosted-execution-dispatch.test.ts}`
- `.github/workflows/deploy-cloudflare-hosted.yml`
- directly required architecture/runtime docs if contract wording changes

## Constraints

- Do not change Stripe webhook payload compatibility in this pass.
- Preserve the current canonical hosted execution contract:
  - `HOSTED_EXECUTION_DISPATCH_URL`
  - `HOSTED_EXECUTION_SIGNING_SECRET`
  - `HOSTED_EXECUTION_DISPATCH_TIMEOUT_MS`
  - `HOSTED_EXECUTION_CONTAINER_SLEEP_AFTER`
  - `POST /internal/dispatch`
- Keep future deploy-to-deploy compatibility by making the canonical contract explicit before the first real Cloudflare rollout, not by retaining readers for state that has never been deployed.
- Preserve unrelated dirty-tree edits.

## Verification

- Focused package/app tests around hosted execution, Cloudflare, and runtime-state cleanup
- Required repo checks after landing: `pnpm typecheck`, `pnpm test`, `pnpm test:coverage`
- Required completion-workflow audits: `simplify`, `test-coverage-audit`, `task-finish-review`

## Notes

- This pass intentionally removes compatibility readers and aliases that only protect old deploy state or old configuration names.
- If docs still mention deprecated aliases or route names after code cleanup, update them in the same change so the deploy surface stays truthful.
Completed: 2026-03-28
