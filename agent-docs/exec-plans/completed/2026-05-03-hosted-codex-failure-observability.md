# Hosted Codex Failure Observability

## Goal

Persist redacted Codex provider failure diagnostics into hosted runtime logs so local/prod debugging can distinguish usage-limit, turn-failed, process-exit, retryable, and stderr-present cases without inspecting ephemeral container files.

## Constraints

- Do not persist raw prompts, transcripts, provider stderr bodies, request bodies, credentials, or full filesystem paths.
- Keep the change on the existing assistant failure-observability path.
- Preserve existing hosted runtime log shape and add only safe scalar metadata.

## Plan

1. Trace where assistant auto-reply failure context is dropped before hosted runtime log persistence.
2. Add safe failure context fields to `input.reply-failed` automation events.
3. Ensure hosted runtime log flattening persists those fields under safe failure diagnostic keys.
4. Add focused tests for Codex failure context propagation.
5. Run focused verification and review the diff for privacy leakage.

## Verification

- `pnpm --dir packages/assistant-runtime test -- hosted-runtime-workspace-assistant-phase.test.ts` passed.
- `pnpm typecheck` passed.
- `pnpm test:diff packages/assistant-runtime/src/hosted-runtime/workspace-assistant-phase.ts packages/assistant-runtime/test/hosted-runtime-workspace-assistant-phase.test.ts` passed.
- `git diff --check` passed.
Status: completed
Updated: 2026-05-03
Completed: 2026-05-03
