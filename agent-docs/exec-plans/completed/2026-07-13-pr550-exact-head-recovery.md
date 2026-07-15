# PR 550 Exact-Head Recovery

## Goal

Bring PR 550 to a clean latest-main head with green required checks and zero
accepted exact-head ReviewGPT findings while preserving conversation
personalization ownership and current hosted-runtime architecture.

## Accepted Findings And CI Repair

1. Restore exactly one mailbox-backed input and its exact causal sequence per
   hosted provider turn; keep prompt work bounded and drain remaining accepted
   inputs through the existing immediate-wake continuation.
2. Collapse `murph.personalization` to its reachable tone/voice result states.
   Keep model and Sol availability as read-only context, and keep every
   model/reasoning mutation exclusively behind `murph.assistant_configuration`
   exact-target approval.
3. Repair the stale CLI release-audit assertion introduced on `main` so it
   verifies the current prompt-primary routing contract.

## Constraints

- Preserve private-direct-only `murph.assistant_style` behavior and native
  dynamic-tool cold resume.
- Preserve the invocation-scoped hosted CLI bridge authority and existing
  immediate-wake projection; add no queue, persisted state, or lifecycle owner.
- Preserve unrelated work and do not touch or merge other PR lanes.
- The current task forbids subagents. Perform parent-owned security, coverage,
  and final call-path review, then require the published ReviewGPT 0.5.106
  Pro/current exact-head gate concurrently with CI.

## Working Set

- `packages/assistant-runtime/src/hosted-runtime/turn-input.ts`
- `packages/assistant-runtime/test/hosted-runtime-turn-input.test.ts`
- `packages/assistant-engine/src/assistant/automation/grouping.ts`
- focused assistant runtime/engine continuation tests
- `packages/hosted-execution/src/assistant-personalization.ts`
- `packages/hosted-execution/test/assistant-personalization.test.ts`
- `apps/web/src/lib/hosted-execution/assistant-personalization-tool.ts`
- `ARCHITECTURE.md`
- `agent-docs/SECURITY.md`
- `agent-docs/product-specs/murph-tone-and-voice.md`
- `packages/cli/test/release-script-coverage-audit.test.ts`

## Verification

- Focused exact-selection, exact-causal-sequence, bounded continuation, and
  personalization parser/owner tests.
- Affected package typechecks and truthful owner test suites.
- CLI release-audit regression test and final diff/privacy checks.
- Parent security/privacy, coverage, and final call-path review.
- Guarded push, concurrent exact-head CI and ReviewGPT, then resolve every
  accepted finding before marking the PR ready for review.

Status: completed
Updated: 2026-07-13
Completed: 2026-07-13
