# Memory Append Safety Plan

## Goal

Make assistant Markdown memory edits safer and easier by adding an append-style tool, reducing accidental overwrite risk, and tightening the model guidance for memory file edits.

## Scope

- Add a bounded assistant memory append tool for long-term and daily Markdown memory files.
- Redact memory metadata paths so model-visible output does not expose machine-local absolute paths.
- Update assistant prompt guidance to prefer append for new memory and warn that full-file writes are dangerous.
- Add or adjust focused tests for append behavior, privacy boundaries, and prompt/tool expectations.

## Constraints

- Keep Markdown-backed memory as the source of truth; do not reintroduce the removed upsert/forget memory API.
- Preserve existing shared/private health-memory access rules and write locking.
- Avoid touching generated incur artifacts unless command topology changes require regeneration.
- Preserve unrelated dirty worktree edits.

## Verification

- `pnpm --dir packages/assistant-core typecheck`
- `pnpm exec vitest run --config packages/cli/vitest.workspace.ts packages/cli/test/assistant-service.test.ts packages/cli/test/assistant-cli.test.ts packages/cli/test/inbox-model-harness.test.ts --coverage.enabled=false --maxWorkers 1`
- Direct scenario proof using the assistant memory tools against `./vault`

## Outcome

- Added `assistant.memory.file.append` for bounded section appends in `MEMORY.md` and daily memory files.
- Kept `assistant.memory.file.write` but marked it as dangerous in both tool descriptions and the assistant system prompt.
- Redacted assistant memory search/get `sourcePath` values down to logical memory paths instead of machine-local absolute paths.
- Preserved shared/private health-memory boundaries while allowing safe non-health long-term appends that keep hidden health bullets intact.
- Verified focused assistant tests, assistant-core typecheck, and a live tool-catalog scenario against `./vault`.
Status: completed
Updated: 2026-04-02
Completed: 2026-04-02
