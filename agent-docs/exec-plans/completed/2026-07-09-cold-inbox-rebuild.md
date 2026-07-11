# Cold Inbox Sidecar Rebuild Deduplication

Status: completed
Updated: 2026-07-09

## Goal

Remove the redundant full inbox-sidecar rebuild from a successful cold hosted
conversation without changing attachment readiness, assistant admission, or
best-effort fallback behavior.

## Constraints

- Keep attachment-bearing conversation projection ordered before prompt
  preparation.
- Preserve a best-effort rebuild when no conversation projection ran or when
  projection bootstrap failed.
- Do not add queues, persisted state, or a new sidecar lifecycle owner.
- Keep plain-text projection deferral and Codex App Server prewarming out of
  this PR.

## Implementation

1. Invalidate process-local sidecar readiness immediately after a restore that
   replaced the workspace, before initial mailbox import.
2. Let successful conversation projection establish readiness once.
3. Retain the post-import ensure only as a fallback when readiness is still
   absent.
4. Add focused ordering/count coverage for successful projection, no
   conversation work, and projection-bootstrap failure.

## Verification

- Focused assistant-runtime entrypoint and conversation-import tests.
- `pnpm typecheck`.
- Truthful assistant-runtime coverage lane.
- Parent diff/call-path review, PR CI, and the repository PR ReviewGPT loop.

## Working Set

- `packages/assistant-runtime/src/hosted-runtime.ts`
- `packages/assistant-runtime/test/hosted-runtime-workspace-entrypoint.test.ts`

Completed: 2026-07-09
