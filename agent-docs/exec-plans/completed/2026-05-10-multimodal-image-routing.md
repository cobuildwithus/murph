# Multimodal Image Routing

## Goal

Debug and fix the assistant path that should pass user-attached images into the model as multimodal input, so image-bearing messages are not reduced to attachment metadata only.

## Scope

- Trace hosted/local conversation message attachment intake through assistant input staging, prompt construction, and provider request shaping.
- Add focused regression coverage for image-bearing user messages reaching the model input path.
- Keep sensitive media and prompt payloads out of logs and fixtures.

## Constraints

- Preserve existing active worktree edits and active coordination rows.
- Do not change unrelated Cloudflare runner or CLI health command work unless the traced image path requires it.
- Treat user media, provider metadata, and assistant runtime state as high-sensitivity.

## Verification Plan

- Use focused package tests for the touched assistant owner package(s).
- Run `pnpm typecheck` unless blocked by unrelated pre-existing worktree state.
- Run the repo-required security/privacy, coverage, and final-review passes before handoff when production code changes land.

## State

- Status: ready for handoff
- Started: 2026-05-10
- Root cause: mailbox post-checkpoint projection/enrichment had moved out of the foreground assistant path, so attachment metadata could be rendered while raw image evidence, audio transcript evidence, and PDF raw evidence were not prepared before prompt/model input construction.
- Implemented:
  - Run hosted mailbox post-checkpoint effects before the assistant phase when a foreground reply is being prepared.
  - Run active-turn mailbox projection before admitting/refetching live input.
  - Keep PDF off the native provider file path while restoring bounded raw evidence context.
  - Harden parser and Codex app-server descendant cleanup exposed by foreground media work.
- Verification:
  - `git diff --check`
  - `pnpm --dir packages/assistant-engine typecheck`
  - `pnpm --dir packages/parsers typecheck`
  - `pnpm --dir packages/hosted-execution typecheck`
  - `pnpm --dir packages/assistant-runtime typecheck`
  - `pnpm --dir apps/cloudflare typecheck`
  - `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/assistant-codex-runtime.test.ts test/assistant-codex-images.test.ts`
  - `pnpm --dir packages/parsers exec vitest run --config vitest.config.ts --no-coverage test/parsers-coverage.test.ts`
  - `pnpm --dir packages/hosted-execution exec vitest run --config vitest.config.ts --no-coverage test/hosted-runtime-control.test.ts`
  - `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --no-coverage test/hosted-runtime-workspace-runner.test.ts`
  - `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --no-coverage test/hosted-runtime-mailbox-conversation-import.test.ts test/hosted-runtime-linq-audio-e2e.test.ts`
  - `pnpm --dir . hosted-local e2e linq-webhook`
Status: completed
Updated: 2026-05-11
Completed: 2026-05-11
