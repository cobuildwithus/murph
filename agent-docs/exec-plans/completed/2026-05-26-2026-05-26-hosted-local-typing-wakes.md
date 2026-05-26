# Hosted-local stray typing wakes

Status: completed
Created: 2026-05-26
Updated: 2026-05-26

## Goal

- Find and fix the cause of hosted-local `pnpm dev` producing visible provider
  typing indicators when no fresh user-authored message should be driving a new
  assistant turn.

## Success criteria

- The root cause is traced to a concrete wake/turn/delivery path.
- Hosted-local typing indicators are only started for an assistant turn that has
  a fresh delivery-worthy conversation input or intentional notification.
- Regression coverage proves stale/no-progress/recovery wakes do not start a
  Linq or Telegram typing indicator by themselves.
- Required scoped verification and completion audits pass, or unrelated
  blockers are recorded precisely.

## Scope

- In scope:
  - Hosted-local wake and assistant-turn handling that can start Linq or
    Telegram typing indicators.
  - The shared assistant channel typing start/stop path if it is the narrowest
    durable guard.
  - Focused tests around the identified stale/no-input wake path.
- Out of scope:
  - Broad hosted Temporal orchestration redesign.
  - Provider API behavior changes outside typing-indicator gating.
  - Device-sync token/runtime work already dirty in the worktree.
  - Existing hosted runner diagnostics/refactor rows unless the root cause
    forces overlap, in which case stop and reassess.

## Constraints

- Technical constraints:
  - Do not create new persisted product state.
  - Preserve idempotent delivery and existing legitimate typing-before-reply
    behavior for real inbound messages and intentional notifications.
  - Keep provider effects metadata-only in logs/tests.
- Product/process constraints:
  - Preserve unrelated dirty worktree edits.
  - Do not expose local identifiers, raw user data, message bodies, secrets,
    provider ids, or local paths in code, docs, logs, fixtures, commits, or
    handoff.

## Risks and mitigations

1. Risk: A guard suppresses typing for legitimate replies.
   Mitigation: Add regression coverage for the no-input path while preserving
   existing positive typing coverage for message-driven turns.
2. Risk: Fixing only the UI symptom leaves a hidden assistant wake running.
   Mitigation: Trace from hosted-local wake source through assistant turn
   admission before editing the provider effect.

## Tasks

1. Inspect hosted-local wake, assistant input, and channel typing paths.
2. Reproduce or model the false typing path with a focused test.
3. Implement the narrowest guard at the turn/admission boundary.
4. Run focused tests, typecheck/diff verification, and privacy diff checks.
5. Run required completion audits.
6. Close the plan and create a scoped commit if safe.

## Decisions

- Treat this as a high-risk runtime/user-state change because provider typing
  indicators are externally visible side effects.
- Idle hosted-local timer wakes were not the source of provider typing: recent
  no-input wakes had zero assistant candidates and no delivery effects.
- Device-sync wakes were ruled out for the sampled visible bursts: the relevant
  device-sync/system imports had zero assistant input, zero conversation imports,
  zero processed sync work, and no delivery effects. The visible reply/typing
  bursts instead aligned with Linq conversation imports and reply starts.
- The delivery path began with Linq `message.received` imports. Linq payloads
  with no message parts are not delivery-worthy conversation input, so ignore
  them before member lookup, mailbox append, Temporal handoff, read receipt, or
  assistant wake.

## Verification

- Passed: `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-onboarding-linq-dispatch.test.ts`
  - 44 tests passed.
- Passed: `pnpm typecheck`
- Passed: `pnpm test:diff apps/web/src/lib/hosted-onboarding/webhook-provider-linq.ts apps/web/test/hosted-onboarding-linq-dispatch.test.ts`
  - App verification completed, including tests, lint, dev smoke, and Next
    build. The Next build emitted an existing Turbopack NFT warning but exited
    0.
- Passed: `git diff --check -- apps/web/src/lib/hosted-onboarding/webhook-provider-linq.ts apps/web/test/hosted-onboarding-linq-dispatch.test.ts agent-docs/exec-plans/active/2026-05-26-2026-05-26-hosted-local-typing-wakes.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`

## Audits

- `security-privacy-review`: no findings. Residual risk is limited to live
  signed hosted-local smoke for an empty Linq event and the intentionally narrow
  scope of guarding literal empty `message.parts` arrays.
- `coverage-write`: added an assertion that empty Linq messages stop before
  `hostedMember.findUnique` member lookup; focused Vitest, `pnpm test:diff`,
  and `git diff --check` passed afterward.
- `task-finish-review`: no findings. Residual risk is manual live signed Linq
  empty-event replay, non-empty semantic no-op messages outside this narrow
  guard, and pre-existing mailbox items already imported before the fix.
Completed: 2026-05-26
