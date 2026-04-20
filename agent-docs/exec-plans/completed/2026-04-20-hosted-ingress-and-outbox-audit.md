# Hosted ingress and outbox audit for three reported gaps

Status: completed
Created: 2026-04-20
Updated: 2026-04-20

## Goal

- Verify whether three reported gaps are already fixed in the current workspace and land only the still-missing minimal fixes.
- Keep the codebase in a simpler greenfield shape by preferring narrow entitlement checks, ordered ingress semantics, and fail-closed stale-send handling over extra recovery branches.

## Success criteria

- Hosted email route resolution denies suspended or inactive members in both reply-alias and direct-public-sender paths before raw email persistence or wake append.
- Device-sync webhook hints no longer lose distinct `hint.jobs` when close-together wakes arrive for the same connection.
- Stale non-idempotent outbox sends no longer auto-resend after crash ambiguity; persisted delivery records are completed without adapter replay and ambiguous no-delivery cases fail closed.
- Verification proves the landed behavior with focused tests for each touched owner.

## Scope

- `apps/web/app/api/internal/hosted-execution/email/resolve-route/route.ts`
- focused hosted-email route tests under `apps/web/test/**`
- focused Cloudflare hosted-email ingress tests under `apps/cloudflare/test/**`
- `apps/web/src/lib/hosted-ingress/{queue.ts,store-append.ts}`
- focused hosted-ingress/device-sync tests under `apps/web/test/**`
- `packages/assistant-runtime/src/hosted-device-sync-runtime.ts`
- focused `packages/assistant-runtime/test/**`
- `packages/assistant-engine/src/assistant/outbox/{retry-policy.ts,dispatch-state.ts}`
- `packages/assistant-engine/src/assistant/outbox.ts`
- focused `packages/assistant-engine/test/**`

## Constraints

- Preserve overlapping dirty-tree work in hosted email, assistant-runtime, and Cloudflare files.
- Prefer the smallest safe change that aligns with existing entitlement and retry invariants.
- Do not broaden into unrelated hosted wake/run naming or larger outbox redesigns.
- If any finding is already landed in the workspace, leave it untouched and record the evidence.

## Verification

- planned: `pnpm typecheck`
- planned: `bash scripts/workspace-verify.sh test:diff apps/web/app/api/internal/hosted-execution/email/resolve-route/route.ts apps/web/src/lib/hosted-ingress/queue.ts apps/web/src/lib/hosted-ingress/store-append.ts apps/web/test packages/assistant-runtime/src/hosted-device-sync-runtime.ts packages/assistant-runtime/test packages/assistant-engine/src/assistant/outbox/retry-policy.ts packages/assistant-engine/src/assistant/outbox/dispatch-state.ts packages/assistant-engine/src/assistant/outbox.ts packages/assistant-engine/test apps/cloudflare/test`
- planned: direct scenario proof through focused route/device-sync/outbox tests
- planned: `git diff --check`

## Notes

- A parallel security lane is already touching hosted-email logging details; coordinate carefully if member-gating fixes overlap those files.
- The current workspace already has substantial hosted-runtime and Cloudflare changes in flight, so every candidate fix must be validated against the current tree before editing.
Completed: 2026-04-20
