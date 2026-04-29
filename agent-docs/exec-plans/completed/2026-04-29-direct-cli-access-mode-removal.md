# Direct CLI Access Mode Removal

## Goal

Remove the dead assistant command-access mode abstraction now that the assistant runtime is Codex-only and every provider turn has direct `vault-cli` authority.

## Scope

- `packages/assistant-engine/src/assistant/providers/**`
- `packages/assistant-engine/src/assistant/provider-turn/**`
- `packages/assistant-engine/src/assistant/system-prompt.ts`
- Focused assistant-engine tests that assert provider capabilities or prompt text.

## Constraints

- Preserve unrelated dirty-tree edits, including the existing onboarding prompt wording edit in `system-prompt.ts`.
- Do not change Codex execution authority, sandbox, approval policy, or hosted/local runtime routing.
- Keep this as a mechanical cleanup unless tests expose stale behavior.

## Plan

1. Remove the command-access mode types and provider capability field.
2. Collapse planning and prompt branches to direct CLI behavior.
3. Remove tests that asserted the dead capability and update focused prompt/capability expectations.
4. Run focused assistant-engine verification and typecheck.

## Verification

- `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts model-behavior.test.ts provider-registry-helpers.test.ts --update` passed.
- `pnpm --dir packages/assistant-engine test:coverage` passed.
- `pnpm --dir packages/assistant-engine typecheck` failed on unrelated pre-existing active-row work in `src/assistant-codex/app-server-requests.ts:262` (`part` / `partIndex` implicit `any`).
- `pnpm typecheck` failed on the same unrelated assistant-engine typecheck error after earlier workspace phases passed.
- `git diff --check` passed for the scoped touched paths.
- Code residue scan for `assistantCommandAccessMode`, `AssistantMurphCommand*`, `murphCommandSurface`, and `assistantHealthCommonsAccessMode` found no matches under `packages/` or `apps/`.

## Status

Focused verified. No scoped commit: touched files overlap pre-existing dirty work in `system-prompt.ts`, `codex-cli.ts`, and the shared coordination ledger.

Updated: 2026-04-29
Status: completed
Completed: 2026-04-29
