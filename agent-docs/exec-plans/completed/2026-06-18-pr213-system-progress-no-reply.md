# PR 213 no-reply durability fixes

Status: completed
Created: 2026-06-18
Updated: 2026-06-18

## Goal

- Fix PR 213 ReviewGPT follow-up: if Codex sends current-channel system progress
  for context compaction, that progress counts as externally visible output and
  prevents a later `finish_without_reply` from silently suppressing the turn.
- Fix PR 213 ReviewGPT follow-up: if an automation input accepts
  `finish_without_reply`, write terminal suppression evidence for the accepted
  input prefix before acknowledging the tool so later provider failure cannot
  retry already-suppressed hosted input.

## Success criteria

- `context.compaction` progress followed by `finish_without_reply` rejects the
  no-reply tool result and delivers the normal final answer.
- An accepted automation no-reply for input A writes suppression evidence for A
  before a later steered input B can fail the provider turn; B remains retryable.
- Existing model progress/no-reply behavior is unchanged.
- Required assistant-engine focused tests, typecheck, and diff checks pass.
- Required completion audits have no unresolved accepted findings.

## Scope

- In scope:
  - `packages/assistant-engine/src/assistant-codex.ts`
  - `packages/assistant-engine/src/assistant/automation/reply.ts`
  - `packages/assistant-engine/src/assistant/local-service.ts`
  - `packages/assistant-engine/src/assistant/service-contracts.ts`
  - `packages/assistant-engine/test/assistant-automation-runtime.test.ts`
  - `packages/assistant-engine/test/assistant-codex-runtime.test.ts`
- Out of scope:
  - notification no-reply behavior
  - outbox intent schema simplification already handled in earlier PR work
  - broader Codex compaction UX copy changes

## Constraints

- Technical constraints:
  - Keep one visibility primitive for all current-channel progress sends.
  - Source controls labeling only; it must not decide whether a delivered
    progress update is externally visible.
  - Reuse auto-reply terminal suppression evidence for hosted pending-input
    compaction; do not add a second retry state owner.
- Product/process constraints:
  - Prefer deletion/simplification over new state owners.
  - Preserve existing PR 213 no-reply ordering and retry fixes.

## Risks and mitigations

1. Risk: progress delivery failures could incorrectly block no-reply.
   Mitigation: keep existing `trackExternallyVisibleProgressDelivery` behavior,
   which marks output only for `sent` results and releases pending state for
   failed/skipped sends.
2. Risk: a no-reply evidence write could suppress later steered input.
   Mitigation: local-service records accepted input IDs by delivery-context
   ordinal and automation filters evidence to the reported accepted prefix.

## Tasks

1. Inspect current progress delivery and no-reply admission paths.
2. Make system current-channel progress use the same visibility tracking as
   model current-channel progress.
3. Add a focused regression for compaction progress followed by no-reply.
4. Persist automation suppression evidence during no-reply acceptance for the
   accepted input prefix only.
5. Add a focused regression for no-reply A, steered B, provider failure, and
   A-only suppression evidence.
6. Run focused and required verification.
7. Complete required audits, final review, commit, push, and rerun ReviewGPT.

## Decisions

- Use the existing `trackExternallyVisibleProgressDelivery` helper for all
  current-channel progress sources instead of adding source-specific state.
- Keep hosted pending-input compaction dependent on existing terminal evidence;
  connect no-reply acceptance to that evidence rather than teaching the pending
  index to parse transcript markers.

## Verification

- Commands to run:
  - Focused Vitest no-reply/progress regression.
  - Focused Vitest automation no-reply prefix regression.
  - Full touched assistant-engine/runtime Vitest files.
  - `pnpm typecheck`
  - `pnpm test:diff` over touched implementation and test files.
- Expected outcomes:
  - All commands pass.
Completed: 2026-06-18
