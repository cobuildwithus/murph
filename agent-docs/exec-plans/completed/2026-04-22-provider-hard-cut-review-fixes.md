# Assistant provider hard-cut review fixes

## Goal

- Land the watched ChatGPT review-fix patch for the assistant-provider hard cut without widening beyond the two concrete bug fixes and their directly coupled tests.

## Success criteria

- Normalized `AssistantProviderConfig` inputs are re-sanitized so stale preset ids cannot bypass canonical target/policy inference.
- Setup assistant flows preserve an explicit `zeroDataRetention: false` so saved gateway ZDR state can be cleared.
- Coverage remains scoped to the touched operator-config and setup-cli source/test slice only.

## Scope

- `packages/operator-config/src/assistant/provider-config.ts`
- `packages/setup-cli/src/setup-assistant.ts`
- `packages/setup-cli/src/setup-assistant-defaults.ts`
- `packages/operator-config/test/assistant-provider-config-normalization.test.ts`
- `packages/setup-cli/test/setup-assistant-zero-data-retention.test.ts`

## Constraints

- Treat the downloaded patch as bounded intent, not authority to refactor adjacent provider/runtime seams.
- Preserve unrelated dirty-tree edits, especially the active `apps/web` and Health Commons rows already in progress.
- Do not widen into the follow-up watch item around Vercel Gateway non-OpenAI model handling.

## Verification

- planned: `pnpm typecheck`
- planned: `bash scripts/workspace-verify.sh test:diff packages/operator-config/src/assistant/provider-config.ts packages/setup-cli/src/setup-assistant.ts packages/setup-cli/src/setup-assistant-defaults.ts packages/operator-config/test/assistant-provider-config-normalization.test.ts packages/setup-cli/test/setup-assistant-zero-data-retention.test.ts`
- planned: `git diff --check`

## Notes

- The watched thread identified two behavior bugs after commit `e416d65e`: normalized config short-circuiting can preserve stale preset semantics, and setup defaults treat explicit `zeroDataRetention: false` as unset.
Status: completed
Updated: 2026-04-22
Completed: 2026-04-22
