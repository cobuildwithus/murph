# Remove inbox attachment decode CLI

## Goal

Hard-cut the attachment-level `decode` / `parse` / `reparse` CLI surface so PDFs, CSVs, documents, and other inspectable files are path-first, while audio/video transcription remains owned by the existing parser runtime and hosted/local ingestion paths.

## Constraints

- Preserve the internal `@murphai/parsers` media transcription primitives.
- Keep assistant access simple: attachment prompts should expose usable raw paths and tell Codex it may inspect local files with ordinary tools.
- Do not add a new decode CLI, adapter, or compatibility layer.
- Preserve unrelated dirty work and active ledger rows.
- Do not leak local home paths or direct identifiers in docs, tests, output, or commits.

## Plan

1. Remove `vault-cli inbox attachment decode`, `parse`, and `reparse` from the command graph.
2. Delete matching inbox-service methods when no non-CLI callers remain.
3. Update command-surface docs and assistant prompt guidance to describe path-first attachments and optional local ffmpeg/Whisper use for media when a real transcript is needed.
4. Update tests and generated CLI metadata if command topology changes require it.
5. Run scoped typecheck/test/coverage proof, required reviews, and commit through `scripts/finish-task`.

## Verification

- `pnpm --dir packages/cli exec vitest run test/incur-smoke.test.ts test/cli-expansion-inbox-attachments.test.ts --config vitest.config.ts --no-coverage` passed.
- `pnpm --dir packages/cli exec vitest run test/inbox-incur-smoke.test.ts test/incur-smoke.test.ts test/cli-expansion-inbox-attachments.test.ts --config vitest.config.ts --no-coverage` passed after adding smoke-scenario and parser-queue regressions.
- `pnpm test:scenario-integrity` passed.
- `pnpm --dir packages/cli verify:coverage` passed.
- `pnpm --dir packages/inbox-services test:coverage` passed.
- `pnpm --dir packages/operator-config test:coverage` passed.
- `pnpm --dir packages/assistant-engine test:coverage` passed.
- Focused package typechecks passed for assistant-engine, inbox-services, operator-config, and CLI.
- `pnpm typecheck` is blocked by unrelated dirty `scripts/hosted-local-e2e.test.ts` `env` type errors.
- `git diff --check` passed.

## Notes

- Root verification may already be red from unrelated dirty active work; if so, record the exact blocker and run the narrowest truthful checks for this change.
- Review agents flagged stale generated metadata and smoke scenarios. Resolved by removing the generated `inbox attachment decode|parse|reparse` entries, deleting the matching smoke scenarios, and adding absence checks plus a top-level `inbox parse|requeue` CLI regression.
Status: completed
Updated: 2026-06-02
Completed: 2026-06-02
