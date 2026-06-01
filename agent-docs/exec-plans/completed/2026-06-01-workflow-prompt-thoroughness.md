# Workflow Prompt Thoroughness

## Goal

Add a small closing instruction to the completion-workflow prompt templates so audit agents start from the assumption that real issues exist and must be found exhaustively.

## Scope

- `agent-docs/prompts/security-privacy-review.md`
- `agent-docs/prompts/coverage-write.md`
- `agent-docs/prompts/frontend-review.md`
- `agent-docs/prompts/simplify.md`
- `agent-docs/prompts/task-finish-review.md`

## Constraints

- Keep edits wording-only and lightweight.
- Preserve existing review-only/write-capable boundaries.
- Do not touch seam-audit prompts unless the current task explicitly expands.

## Verification

- Read back touched prompt endings.
- Run the docs/process fast-path check required for low-risk repo-internal workflow docs.

## Completion Notes

- Added the same small thoroughness-bias section to the five completion-workflow prompt templates.
- Readback and whitespace checks passed.
- Scoped repo-internal fast-path verification passed with `bash scripts/workspace-verify.sh test:diff ...`.
- Full `pnpm typecheck` was run and failed in unrelated active provider-fetch work: `packages/assistant-runtime/src/hosted-runtime/provider-cleanup.ts` has a `LinqFetch`/Cloudflare `fetch` type mismatch.
Status: completed
Updated: 2026-06-01
Completed: 2026-06-01
