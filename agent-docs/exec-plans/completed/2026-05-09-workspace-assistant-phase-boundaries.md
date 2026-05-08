# Workspace Assistant Phase Boundaries

## Goal

Split the hosted workspace assistant phase orchestration into named foreground, system-mailbox, provider-cleanup, delivery-effect, and wake-resolution helpers so foreground reply handling cannot accidentally perform background maintenance work.

## Scope

- `packages/assistant-runtime/src/hosted-runtime/workspace-assistant-phase.ts`
- `packages/assistant-runtime/test/hosted-runtime-workspace-assistant-phase.test.ts`

## Constraints

- Preserve foreground checkpoint and delivery safety behavior.
- `runForegroundAssistantReplyPhase` must not call system mailbox preparation, hosted device-sync wake, provider cleanup checkpoint reads, or background outbox retry collection.
- Keep logs redacted and metadata-only.
- Preserve unrelated active worktree and ledger edits.

## Verification

- Focused hosted-runtime workspace assistant phase tests.
- `pnpm typecheck`
- `pnpm test:diff` scoped to the touched files if feasible.

## State

Active.
Status: completed
Updated: 2026-05-09
Completed: 2026-05-09
