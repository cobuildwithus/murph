# Attachment Lifecycle Prompt

## Goal

Make assistant prompts clearly report attachment descriptor, projection, raw evidence, and parser lifecycle state whenever attachment descriptors or evidence exist.

## Scope

- `packages/assistant-engine/src/assistant/automation/prompt-builder.ts`
- `packages/assistant-engine/test/assistant-automation-prompt-builder.test.ts`

## Constraints

- Prompt-facing only; no canonical schema changes.
- Preserve existing raw attachment prompt evidence behavior already present in the dirty working tree.
- Do not expose prompt-facing attachment ids or direct personal identifiers.
- Work on top of overlapping prompt-builder handoff edits without reverting them.

## Verification

- `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts test/assistant-automation-prompt-builder.test.ts test/assistant-automation-support.test.ts` passed.
- `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts test/assistant-input-store.test.ts test/assistant-inbox-attachment-evidence.test.ts test/assistant-attachment-evidence-model.test.ts test/assistant-automation-prompt-builder.test.ts test/assistant-automation-runtime.test.ts test/assistant-automation-support.test.ts test/assistant-cron-runtime.test.ts test/assistant-notification-turn-runtime.test.ts` passed.
- `pnpm typecheck` passed.
- `git diff --check` on touched files passed.
- `pnpm test:diff packages/assistant-engine/src/assistant/automation/prompt-builder.ts packages/assistant-engine/test/assistant-automation-prompt-builder.test.ts packages/assistant-engine/test/assistant-automation-support.test.ts` passed through assistant/CLI/setup lanes, then hit a transient Cloudflare timing assertion; direct `pnpm --dir apps/cloudflare verify` rerun passed.
- Security/privacy review findings were fixed.
- Coverage-write pass added mixed-parser lifecycle coverage.
- Final completion review found no issues.

## State

Complete. Scoped commit blocked by overlapping uncommitted prompt-builder filename/raw-evidence work in the same files.
Status: completed
Updated: 2026-05-04
Completed: 2026-05-04
