# Assistant Cron Presets Integration

## Goal

Apply the assistant cron preset patch on top of the current assistant runtime so built-in templates can be listed, inspected, and installed as ordinary cron jobs without changing persisted scheduler state shape.

## Scope

- `packages/cli/src/assistant/cron/presets.ts`
- `packages/cli/src/assistant/cron.ts`
- `packages/cli/src/assistant-cli-contracts.ts`
- `packages/cli/src/assistant-runtime.ts`
- `packages/cli/src/commands/assistant.ts`
- `packages/cli/src/assistant/service.ts`
- `packages/cli/src/setup-cli.ts`
- `packages/cli/src/setup-wizard.ts`
- `packages/cli/src/incur.generated.ts`
- `packages/cli/test/{assistant-cli,assistant-cron,assistant-service,incur-smoke}.test.ts`
- `docs/contracts/03-command-surface.md`

## Constraints

- Preserve adjacent assistant chat, delivery, and runtime edits already present in the tree.
- Keep cron jobs as the only persisted scheduler primitive; presets remain inert templates until install time.
- Keep setup/onboarding guidance aligned with the new preset surface.
- Finish with the required repo verification commands plus completion-workflow audit passes.

## Plan

1. Apply the provided patch where it still matches and manually merge the one conflicting test hunk.
2. Inspect the updated assistant files for merge drift around the overlapping assistant command/runtime surfaces.
3. Run completion-workflow audit passes, then repo verification, fix any issues, and commit only the touched files.
Status: completed
Updated: 2026-03-24
Completed: 2026-03-24
