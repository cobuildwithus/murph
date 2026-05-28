# Context Compaction Progress Delivery

## Goal

Send one short progress update to the current assistant conversation channel when Codex starts context compaction, without adding model-visible messages, new durable product state, or a separate delivery path.

Success criteria:

- Detect Codex `ContextCompaction` / `contextCompaction` / `context.compaction` item start events through the existing Codex event normalizer.
- Reuse the existing `AssistantTurnProgress` and current-audience delivery seam.
- Keep the notice best-effort, deduped in the turn loop and by the existing progress helper, and unavailable when response delivery is not requested.
- Cover event normalization and provider-turn delivery with focused tests.

## Constraints

- Do not expose raw prompts, transcripts, provider payloads, channel identifiers, local paths, or secrets in logs, tests, docs, or generated artifacts.
- Preserve unrelated dirty work in assistant CLI contract and Junction webhook files.
- Keep the implementation minimal and composable; no new state machine, storage bucket, or UI-only branch.
- The ChatGPT thread stayed on "Finalizing answer"; visible guidance and local code inspection are the source of the implementation shape.

## Plan

1. Add a narrow context-compaction status predicate/copy in `assistant-codex-events`. Done.
2. Send the compaction-start notice through `turnProgress.send(...)` from the Codex event loop. Done.
3. Add tests for the progress/trace event and outbound progress delivery. Done.
4. Run focused assistant-engine tests, typecheck/diff verification, and required audits. In progress.

## Verification

- `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/assistant-codex-runtime.test.ts -t "compacts context"` passed.
- `pnpm typecheck` passed.
- `pnpm --dir packages/assistant-engine test:coverage` passed.
- `bash scripts/workspace-verify.sh test:diff packages/assistant-engine/src/assistant-codex-events.ts packages/assistant-engine/src/assistant-codex.ts packages/assistant-engine/test/assistant-codex-runtime.test.ts` passed on rerun after one transient reverse-dependent CLI timeout.

## Audits

- `security-privacy-review`: no findings. Residual gap: no live hosted chat channel proof; runtime tests cover the delivery boundary.
- `coverage-write`: added current-channel progress delivery assertions; local provider progress/trace intentionally remains unchanged for context compaction.
Status: completed
Updated: 2026-05-28
Completed: 2026-05-28
