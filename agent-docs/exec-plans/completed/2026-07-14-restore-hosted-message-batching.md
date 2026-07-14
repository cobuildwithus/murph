# Restore Hosted Message Batching

## Goal

Restore the established hosted behavior where rapid adjacent replyable messages from the same conversation and reply context are processed together in one assistant turn.

## Evidence

- Hosted same-wake selection previously admitted bounded same-conversation inputs, while the assistant-engine grouper preserved conversation and reply-anchor boundaries.
- The personality preference remediation changed foreground, background, and refresh selection to one mailbox-backed input per provider turn.
- Current pending-drain follow-ups avoid stranding later inputs, but expose the regression as multiple assistant replies to one rapid user thought.

## Constraints

- Preserve mailbox cursor ordering, pending-index durability, write fences, provider claims, and fresh-input priority over unrelated backlog.
- Never combine different conversations or different reply anchors into one grouped provider turn.
- Preserve Settings/conversation preference ordering with mailbox-owned causal sequences; the model must not supply or replace a sequence.
- Add no new persisted state, queue, scheduler, service, dependency, or compatibility owner.
- Work carefully beside the active mailbox consumed-at lane and avoid its unrelated schema/acknowledgment scope.

## Plan

1. Trace the current selection, grouping, steering, and invocation-local preference-causality boundaries against the pre-regression implementation and audit remediation.
2. Restore bounded foreground and background selection at the smallest existing owner boundary, bind each grouped turn to an owner-certified compound causal frontier, and freeze the batch before provider start.
3. Add focused regressions for same-context batching, boundary preservation, pending behavior, and preference causality.
4. Update the durable hosted-runtime and personality-ordering documentation to describe the restored invariant.
5. Require PR descriptions to disclose non-obvious affected surfaces and require ReviewGPT to flag material behavior outside the stated PR purpose.
6. Run scoped verification, direct scenario proof, required audits, parent final review, and the PR ReviewGPT/CI loop.

## Verification

- `pnpm test:diff packages/assistant-runtime/src/hosted-runtime/turn-input.ts packages/assistant-runtime/test/hosted-runtime-turn-input.test.ts`
- Focused assistant-engine grouping tests when the changed path requires them.
- Direct scenario proof covering rapid same-conversation inputs and a cross-boundary pending input.
- Focused process-guard tests covering the PR description and ReviewGPT prompt requirements.
- `git diff --check` and privacy/readback checks before commit.

## State

Active.
Status: completed
Updated: 2026-07-14
Completed: 2026-07-14
