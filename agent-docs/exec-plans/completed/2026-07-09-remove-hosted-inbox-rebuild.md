# Remove Hosted Historical Inbox Rebuild

Status: completed
Updated: 2026-07-09

## Goal

Remove the full historical inbox projection rebuild from hosted foreground
startup while preserving current-message attachment and transcript readiness.

## Constraints

- Keep current-message projection ordered before prompt construction.
- Do not add a background scheduler, queue, or new persisted lifecycle state.
- Preserve best-effort projection failure behavior and warm-process readiness.
- Keep text-only projection deferral and Codex App Server lifecycle changes out
  of this PR.
- Stack on the duplicate-rebuild ordering PR so each behavioral change remains
  independently reviewable.

## Implementation

1. Initialize the hosted inbox sidecar without scanning historical captures.
2. Keep the awaited current-message import, attachment evidence, and parser
   work unchanged.
3. Remove the outer foreground historical rebuild fallback.
4. Add focused coverage proving cold foreground admission never requests a
   historical rebuild, including attachment-bearing paths.

## Verification

- Focused attachment, context, conversation, entrypoint, and restore tests:
  283 passed.
- Assistant-runtime coverage: 1,481 passed, 2 skipped; thresholds passed.
- `pnpm typecheck`: passed.
- Parent diff/call-path review: no blocking findings; added a real cold-vault
  PDF projection regression test before completion.
- PR CI and the repository PR ReviewGPT loop remain post-push gates.

## Working Set

- `packages/assistant-runtime/src/hosted-runtime.ts`
- `packages/assistant-runtime/src/hosted-runtime/context.ts`
- `packages/assistant-runtime/src/hosted-runtime/workspace-restore.ts`
- `packages/assistant-runtime/test/hosted-runtime-workspace-entrypoint.test.ts`
- `packages/assistant-runtime/test/hosted-runtime-mailbox-conversation-import.test.ts`
- `packages/assistant-runtime/test/hosted-runtime-workspace-restore-codex-continuity.test.ts`
Completed: 2026-07-09
