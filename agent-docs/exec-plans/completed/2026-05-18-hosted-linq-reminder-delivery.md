# Hosted Linq scheduled reminder delivery failure

Status: completed
Created: 2026-05-18
Updated: 2026-05-19

## Goal

- Diagnose and fix the hosted Linq scheduled-reminder delivery failure where an
  automation run can be recorded as successful before outbound delivery reaches
  a terminal `delivery.sent` state.
- Improve failure diagnostics for Linq outbound HTTP errors without persisting
  or logging raw message bodies, secrets, contact identifiers, or production
  route identifiers.

## Success criteria

- Automation runtime state does not record the reminder job as successfully
  delivered when the generated outbound delivery later fails.
- Linq outbound delivery failures expose safe metadata for debugging HTTP 400
  responses, such as status/code, body shapes, lengths, and JSON key summaries,
  without leaking payload text or contact identifiers.
- Regression coverage proves scheduled reminder delivery failure state and safe
  Linq error diagnostics.
- Required high-risk runtime verification and completion audits pass, or any
  unrelated blocker is named with exact failing command and target.

## Scope

- In scope:
- Hosted/local assistant automation success semantics for prompt-backed
  outbound-channel reminders.
- Linq outbound send wrapper error metadata and redaction behavior.
- Focused tests and docs updates needed to keep runtime/reliability contracts
  truthful.
- Out of scope:
- Live production database or provider mutation.
- Changing the user reminder content, schedule, route binding, or provider
  credentials.
- Broad runner scheduling/checkpoint refactors unrelated to terminal delivery
  accounting.

## Constraints

- Technical constraints:
- Preserve assistant runtime as non-canonical operational state.
- Keep delivery/outbox state idempotent and replay-safe.
- Do not make all HTTP 400 responses retryable by default without evidence that
  the request is replay-safe and provider semantics justify it.
- Product/process constraints:
- Do not write real production route, member, session, turn, participant, or
  outbox ids into repo artifacts.
- Preserve unrelated dirty worktree edits and existing active-plan rows.

## Risks and mitigations

1. Risk: Treating provider-turn completion as delivery completion can hide
   broken reminders.
   Mitigation: Find the exact state transition and move or split success
   accounting so terminal delivery failures are visible.
2. Risk: Better diagnostics could leak message text or contact identifiers.
   Mitigation: Store only bounded, redacted provider-error metadata and test
   redaction.
3. Risk: Hosted deploy skew between web, Cloudflare, and runtime packages.
   Mitigation: Keep changes backward compatible and call out deployment order if
   needed.

## Tasks

1. Trace scheduled automation execution, assistant turn receipts, outbox
   delivery disposition, and Linq channel send behavior.
2. Identify the concrete root cause for success-state mismatch and HTTP 400
   opacity.
3. Implement the smallest durable fix with focused regression tests.
4. Run focused verification, required audit passes, and direct scenario proof
   where feasible.
5. Close the plan through `scripts/finish-task` if a safe scoped commit is
   possible; otherwise close/archive the plan and report blockers.

## Decisions

- 2026-05-18: Opened a plan-bearing lane because the issue touches hosted
  runtime state, outbound provider egress, observability, and reliability
  semantics.
- 2026-05-19: Queue-only hosted reminder delivery is now tracked as pending
  cron delivery, not success. Terminal outbox sent/failed/abandoned states
  reconcile the pending cron state. Linq diagnostics now use redacted path
  templates plus request/response shape, lengths, and key summaries instead of
  raw request or provider response bodies.
- 2026-05-19: Stale Linq direct-thread recovery now keys off structured,
  sanitized Linq error context for 404 send-message failures instead of raw
  provider response text.
- 2026-05-19: Final-audit follow-up added an idempotent repair pass for cron
  jobs whose pending outbox intent is already terminal before due filtering, and
  Linq provider JSON response diagnostics now only expose allowlisted key names
  plus counts for all keys.
- 2026-05-19: Later audit follow-up narrowed stale Linq direct-thread recovery
  to 404 send-message failures classified as `chat_not_found` by an internal
  safe enum, and manual `run now` now repairs terminal pending deliveries before
  claiming a job.
- 2026-05-19: Five-reviewer final audit follow-up removed stable diagnostic
  body hashes, blocked cron enable toggles while a delivery is pending, added
  stale missing-intent repair, routed hosted Linq non-send effects through the
  injected fetch dependency, and stopped stale-thread recovery from hiding
  ambiguous recovery sends.

## Verification

- Passed:
- `pnpm --filter @murphai/operator-config typecheck`
- `pnpm --filter @murphai/operator-config build`
- `pnpm --filter @murphai/assistant-engine typecheck`
- `pnpm --filter @murphai/murph typecheck`
- `pnpm --filter @murphai/operator-config test -- http-linq-device-runtime.test.ts`
- `pnpm --filter @murphai/assistant-engine test -- assistant-cron-runtime.test.ts`
- `pnpm --filter @murphai/murph test:source -- assistant-channel.test.ts`
- `pnpm typecheck`
- `pnpm test:diff -- packages/operator-config/src/linq-runtime.ts packages/operator-config/src/assistant-cli-contracts.ts packages/assistant-engine/src/assistant/cron/execution.ts packages/assistant-engine/src/assistant/cron/delivery-reconciliation.ts packages/assistant-engine/src/assistant/outbox/dispatch-state.ts packages/assistant-engine/test/assistant-cron-runtime.test.ts packages/operator-config/test/http-linq-device-runtime.test.ts packages/cli/test/assistant-channel.test.ts`
- `pnpm --filter @murphai/assistant-runtime test -- hosted-provider-effects.test.ts`
- `pnpm --filter @murphai/assistant-engine test -- assistant-channels-runtime.test.ts`
- `pnpm --filter @murphai/assistant-engine test -- assistant-cron-runtime.test.ts assistant-channels-runtime.test.ts outbox-dispatch-state.test.ts`
- `pnpm --filter @murphai/assistant-runtime test -- hosted-provider-effects.test.ts`
- `pnpm --filter @murphai/assistant-engine typecheck && pnpm --filter @murphai/operator-config typecheck && pnpm --filter @murphai/assistant-runtime typecheck`
- `pnpm test:diff -- packages/operator-config/src/linq-runtime.ts packages/operator-config/src/assistant-cli-contracts.ts packages/operator-config/test/http-linq-device-runtime.test.ts packages/operator-config/test/http-linq-device-runtime-branches.test.ts packages/assistant-engine/src/assistant/channels/descriptors.ts packages/assistant-engine/src/assistant/cron.ts packages/assistant-engine/src/assistant/cron/canonical-jobs.ts packages/assistant-engine/src/assistant/cron/execution.ts packages/assistant-engine/src/assistant/cron/runtime-state.ts packages/assistant-engine/src/assistant/cron/store.ts packages/assistant-engine/src/assistant/cron/delivery-reconciliation.ts packages/assistant-engine/src/assistant/cron/finalization.ts packages/assistant-engine/src/assistant/notification-turn.ts packages/assistant-engine/src/assistant/outbox/dispatch-state.ts packages/assistant-engine/test/assistant-channels-runtime.test.ts packages/assistant-engine/test/assistant-cron-runtime.test.ts packages/assistant-runtime/src/hosted-provider-effects.ts packages/assistant-runtime/test/hosted-provider-effects.test.ts packages/cli/test/assistant-channel.test.ts`
- `pnpm --filter @murphai/operator-config test -- http-linq-device-runtime.test.ts http-linq-device-runtime-branches.test.ts`
- `pnpm --filter @murphai/murph test`
- `pnpm --filter @murphai/assistant-engine typecheck && pnpm --filter @murphai/operator-config typecheck && pnpm --filter @murphai/assistant-runtime typecheck && pnpm --filter @murphai/murph typecheck`
- `pnpm --filter @murphai/contracts build && pnpm --filter @murphai/operator-config build && pnpm --filter @murphai/murph build`
- `pnpm typecheck`
- `pnpm test:diff -- packages/operator-config/src/linq-runtime.ts packages/operator-config/test/http-linq-device-runtime.test.ts packages/operator-config/test/http-linq-device-runtime-branches.test.ts packages/assistant-engine/src/assistant/channels/descriptors.ts packages/assistant-engine/src/assistant/cron.ts packages/assistant-engine/src/assistant/cron/canonical-jobs.ts packages/assistant-engine/src/assistant/cron/delivery-reconciliation.ts packages/assistant-engine/src/assistant/cron/execution.ts packages/assistant-engine/src/assistant/cron/finalization.ts packages/assistant-engine/src/assistant/cron/runtime-state.ts packages/assistant-engine/src/assistant/cron/store.ts packages/assistant-engine/src/assistant/notification-turn.ts packages/assistant-engine/src/assistant/outbox/dispatch-state.ts packages/assistant-engine/test/assistant-channels-runtime.test.ts packages/assistant-engine/test/assistant-cron-runtime.test.ts packages/assistant-runtime/src/hosted-provider-effects.ts packages/assistant-runtime/test/hosted-provider-effects.test.ts packages/cli/test/assistant-channel.test.ts`
- `git diff --check`
- Diff redaction scans for local paths, production-shaped provider route ids,
  production-shaped automation/outbox/turn ids, and raw auth/token patterns.
Completed: 2026-05-19
