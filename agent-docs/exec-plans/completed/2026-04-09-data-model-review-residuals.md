# Data Model Review Residuals

## Goal

Land the residual review patch that moves shared knowledge result contracts into `packages/query`, narrows hosted execution side-effect ownership around assistant delivery, and normalizes hosted webhook side-effect persistence to shared shell fields plus kind-owned JSON detail.

## Scope

- `agent-docs/references/data-model-seams.md`
- `packages/query/**`
- `packages/assistant-engine/**`
- `packages/cli/**`
- `packages/hosted-execution/**`
- `packages/assistant-runtime/**`
- `apps/cloudflare/**`
- `apps/web/prisma/**`
- `apps/web/src/lib/hosted-onboarding/**`
- matching focused tests under the touched owners

## Constraints

- Preserve the unrelated unfinished hosted-legal lane already in the worktree.
- Keep public ownership on package entrypoints only; do not reach across sibling internals.
- Rebase the provided patch onto the current tree rather than forcing stale hunks through.
- Finish with repo verification, a required review pass, and a scoped commit for only this lane.

## Verification

- `pnpm typecheck`
- `pnpm test:packages`
- `pnpm test:smoke`
- `pnpm --dir packages/query test -- --runInBand knowledge-contracts.test.ts`
- `pnpm --dir packages/assistant-engine test -- --runInBand knowledge-contracts.test.ts`
- `pnpm --dir packages/cli test -- --runInBand knowledge-cli-contracts.test.ts`
- `pnpm --dir packages/hosted-execution test -- --runInBand side-effects.test.ts`
- `pnpm --dir packages/assistant-runtime test -- --runInBand hosted-runtime-callbacks.test.ts hosted-runtime-parsers.test.ts hosted-runtime-execution.test.ts hosted-runtime-runner.test.ts hosted-runtime-entry-execution.test.ts`
- `pnpm --dir apps/cloudflare test -- --runInBand execution-journal test/index.test.ts test/user-runner.test.ts test/node-runner.test.ts test/runner-container.test.ts test/crypto.test.ts test/runner-queue-store.test.ts test/storage-path-rotation.test.ts`
- `pnpm --dir apps/web test -- --runInBand hosted-onboarding-webhook-receipt-transitions.test.ts hosted-onboarding/webhook-receipt-privacy.test.ts hosted-onboarding-linq-dispatch.test.ts hosted-onboarding-telegram-dispatch.test.ts hosted-onboarding-webhook-idempotency.test.ts`

## Notes

- Added the missing `@murphai/query` workspace dependency edge to `@murphai/operator-config` and refreshed `pnpm-lock.yaml` so clean workspace builds resolve the new contract owner correctly.
- The final audit pass found one mixed-version resume-compatibility gap; the lane now mirrors both `assistantDeliveryEffects` and legacy `sideEffects` on parsed resume payloads to match the commit path.
Status: completed
Updated: 2026-04-09
Completed: 2026-04-09
