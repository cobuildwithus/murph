# PR 213 ReviewGPT Round 2 Fixes

Status: completed
Created: 2026-06-18
Updated: 2026-06-18

## Goal

- Resolve accepted ReviewGPT round-2 correctness findings for PR 213 with small boundary fixes.

## Success Criteria

- Explicit `finish_without_reply` decisions do not retry as auto-reply delivery failures.
- Outbox target repair preserves the original message/media payload under an existing dedupe identity.
- Focused tests, scoped verification, commit/push, and the next ReviewGPT round complete.

## Scope

- In scope: assistant ask result disposition, auto-reply no-reply classification, outbox pre-dispatch target repair, and focused regression tests.
- Out of scope: broad deletion of reaction plumbing without a replacement channel adapter decision.

## Constraints

- Keep the fix at existing service/outbox boundaries.
- Avoid new retry state or migration machinery.
- Keep ReviewGPT artifacts under `audit-packages/` uncommitted.

## Risks And Mitigations

1. Risk: no-reply and delivery failure both use `delivery: null`.
   Mitigation: add an explicit response disposition and map no-reply to existing terminal skip evidence.
2. Risk: target repair can rewrite durable content under a stable dedupe token.
   Mitigation: repair route fields while preserving the existing message/media payload.

## Tasks

1. Patch no-reply send-result/auto-reply classification.
2. Patch target repair payload preservation.
3. Add focused regression tests.
4. Run verification, commit, push, and start ReviewGPT round 3.

## Decisions

- Accepted ReviewGPT round-2 findings for no-reply retry and target-repair payload mutation.
- Deferred the complexity-collapse suggestion to delete all reaction plumbing because this PR is explicitly about reaction side effects and current fixes already keep reactions unadvertised until a provider supports them.

## Verification

- `pnpm --dir packages/operator-config typecheck`
- `pnpm --dir packages/operator-config test -- assistant-cli-contracts.test.ts`
- `pnpm --dir packages/assistant-engine typecheck`
- `pnpm --dir packages/assistant-engine test -- assistant-local-service-runtime.test.ts assistant-automation-runtime.test.ts assistant-outbox-runtime.test.ts`
- `git diff --check`
- `bash scripts/workspace-verify.sh test:diff`

## Audit Notes

- ReviewGPT round 2 accepted findings fixed: explicit no-reply results are terminal skips, and pre-dispatch outbox target repair preserves queued payload content under stable dedupe identity.
- Local coverage, security/privacy, and deep-review passes were run against the round-2 fixes. Follow-up stale findings were rejected after confirming current code preserves existing payload content and checks no-reply-without-delivery-work before the delivery-failure branch.
Completed: 2026-06-18
