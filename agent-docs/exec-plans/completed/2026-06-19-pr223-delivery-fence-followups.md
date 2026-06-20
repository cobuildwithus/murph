# PR 223 Delivery Fence Follow-ups

## Goal

Resolve the accepted ReviewGPT findings for PR 223 without adding speculative state or broad deployment machinery:

1. Auto-reply dispatch must observe hosted system-lane channel-disable work that was already pending before the invocation.
2. Full `member.channels.updated` snapshots must apply in mailbox queue order.
3. A blocked pre-dispatch channel barrier must restore prepared outbox claims when no provider call was attempted.

## Constraints

- Keep `automation-state.json` authoritative for processed channel state.
- Prefer one explicit pre-dispatch system-lane ordering invariant over conversation/system fallback branches.
- Do not add new persisted state unless a failing test proves it is necessary.
- Preserve retryability for transient system-mailbox failures while failing closed before provider dispatch.

## Working Set

- `packages/assistant-runtime/src/hosted-runtime.ts`
- `packages/assistant-runtime/src/hosted-runtime/workspace-runner.ts`
- `packages/assistant-runtime/src/hosted-runtime/workspace-assistant-phase.ts`
- `packages/assistant-runtime/src/hosted-runtime/system-mailbox.ts`
- `packages/assistant-runtime/src/hosted-runtime/callbacks.ts`
- `packages/assistant-runtime/test/*hosted-runtime*`

## Verification Plan

- Focused hosted-runtime tests for system-lane pre-dispatch catch-up, member-channel ordering, and prepared-claim restoration.
- Scoped typecheck for `packages/assistant-runtime`.
- Completion audits required for hosted runtime ordering, external delivery, persisted state, and retry behavior.
- Push PR head and rerun ReviewGPT with the PR review preset/loop.
Status: completed
Updated: 2026-06-19
Completed: 2026-06-19
