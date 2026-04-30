# Implement assistant input engine contract

Status: completed
Created: 2026-04-30
Updated: 2026-04-30

## Goal

- Land Batch 1 of the hosted assistant input migration: define the
  assistant-engine-owned source-agnostic input contract and an inbox-backed
  adapter while preserving current capture-backed behavior.

## Success criteria

- `AssistantInputSource`, `AssistantInputCandidate`, source refs, cursors, and
  projection status types exist in assistant-engine without importing
  hosted-runtime wake types.
- Existing inbox-backed turn-input behavior continues to pass.
- A focused test proves the inbox-backed adapter can produce assistant input
  candidates from captures.
- No hosted runtime, scanner, reply, evidence, or journal implementation is
  changed in this batch.

## Scope

- In scope:
  - New assistant-engine input-source contract module.
  - Minimal exports/barrels.
  - Compatibility adapter from current inbox capture listing to input
    candidates.
  - Focused assistant-engine tests.
- Out of scope:
  - Assistant input store implementation.
  - Accepted-input journal/evidence schema changes.
  - Hosted mailbox ingest/cursor changes.
  - Scanner/reply/active-turn migration to the new source.
  - Inbox projection demotion.

## Constraints

- Technical constraints:
  - Assistant-engine must remain source-agnostic and must not import
    hosted-runtime wake types.
  - Do not persist raw prompt bodies or provider payloads.
  - Preserve current `listNewConversationCaptures` API for compatibility.
- Product/process constraints:
  - Follow high-risk repo workflow for code changes.
  - Preserve unrelated dirty-tree work.
  - Keep this batch narrow enough for a clean scoped commit.

## Risks and mitigations

1. Risk: The foundation batch grows into scanner/reply/runtime migration.
   Mitigation: Limit writes to input contract, adapter, exports, and focused
   tests.
2. Risk: The new type shape overfits hosted runtime details.
   Mitigation: Keep source refs generic and adapter-owned; no hosted wake types
   in assistant-engine.

## Tasks

1. Spawn read-only subagents for Batch 2/3/4 design while implementing Batch 1.
2. Add assistant input source contract types.
3. Add inbox-backed input-source adapter.
4. Add focused tests.
5. Run focused verification and required audits.
6. Close plan and commit scoped changes if safe.

## Decisions

- Batch 1 preserves `AssistantTurnInputPort.listNewConversationCaptures` and
  adds the new source-agnostic contract beside it.
- Inbox-backed candidates use `inputId = inbox:<captureId>` and content refs
  remain capture-compatible until the journal batch widens the schema.

## Verification

- Commands to run:
  - `pnpm --dir packages/assistant-engine typecheck`
  - `pnpm --dir packages/assistant-engine test -- assistant-turn-input.test.ts assistant-input-source.test.ts`
  - `git diff --check -- packages/assistant-engine/src/assistant/input-source.ts packages/assistant-engine/src/assistant/turn-input.ts packages/assistant-engine/src/assistant-runtime.ts packages/assistant-engine/src/index.ts packages/assistant-engine/test/assistant-input-source.test.ts packages/assistant-engine/test/assistant-turn-input.test.ts agent-docs/exec-plans/active/2026-04-30-assistant-input-engine-contract.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- Expected outcomes:
  - Focused assistant-engine checks pass or any unrelated blockers are
    documented.
  - Diff has no whitespace errors.
Completed: 2026-04-30
