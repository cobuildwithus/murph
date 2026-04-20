## Title

Fix three hosted execution correctness bugs from the review: hosted-email access gating, device-sync wake hint loss, and stale non-idempotent outbox resend risk.

## Goal

Land the smallest safe fixes for the reported seams, add regression coverage for each path, and preserve the current hosted run and dirty-tree work already in flight.

## Scope

- `apps/web/app/api/internal/hosted-execution/email/resolve-route/route.ts`
- hosted member access helpers or data reads needed by that route
- focused `apps/web` hosted email route tests
- focused `apps/cloudflare` hosted email ingress tests
- `apps/web/src/lib/hosted-ingress/{queue.ts,store-append.ts}`
- focused `apps/web/test/hosted-ingress-queue.test.ts`
- `packages/assistant-runtime/src/hosted-device-sync-runtime.ts`
- focused `packages/assistant-runtime/test/hosted-device-sync-runtime.test.ts`
- `packages/assistant-engine/src/assistant/outbox/{retry-policy.ts,dispatch-state.ts}`
- `packages/assistant-engine/src/assistant/outbox.ts`
- focused `packages/assistant-engine/test/**` coverage for stale `sending` intents

## Constraints

- Keep the fixes narrow and behavior-preserving outside the reported seams.
- Preserve unrelated dirty-tree edits across `apps/web`, `apps/cloudflare`, `packages/assistant-runtime`, and `packages/assistant-engine`.
- Do not add dependencies.
- Prefer existing hosted-member entitlement helpers over duplicating policy.
- Do not auto-resend stale non-idempotent deliveries unless an existing persisted delivery can safely complete the intent.

## Verification

- planned: `pnpm typecheck`
- planned: `bash scripts/workspace-verify.sh test:diff apps/web/app/api/internal/hosted-execution/email/resolve-route/route.ts apps/web/test/hosted-email-resolve-route.test.ts apps/cloudflare/test/hosted-email-worker-ingress.test.ts apps/web/src/lib/hosted-ingress/queue.ts apps/web/test/hosted-ingress-queue.test.ts packages/assistant-runtime/src/hosted-device-sync-runtime.ts packages/assistant-runtime/test/hosted-device-sync-runtime.test.ts packages/assistant-engine/src/assistant/outbox/retry-policy.ts packages/assistant-engine/src/assistant/outbox.ts packages/assistant-engine/src/assistant/outbox/dispatch-state.ts packages/assistant-engine/test/assistant-outbox.test.ts`
- planned: `git diff --check`

## Notes

- This is a high-risk cross-cutting correctness lane touching auth gating, hosted ingress durability, and non-idempotent delivery retry behavior.
- Completion workflow requires `coverage-write` and `task-finish-review` before handoff for this task class.
- Use focused proof where possible, but expect at least `pnpm typecheck` plus truthful diff-aware coverage unless current dirty-tree state blocks it for unrelated reasons.
Status: completed
Updated: 2026-04-20
Completed: 2026-04-20
