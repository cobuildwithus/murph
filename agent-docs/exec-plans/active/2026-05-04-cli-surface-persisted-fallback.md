# CLI Surface Persisted Fallback

## Goal

Keep an already persisted assistant CLI surface contract available when fresh `vault-cli --llms-full` / `--llms` manifest generation fails transiently.

## Scope

- `packages/assistant-engine/src/assistant/cli-surface-bootstrap.ts`
- `packages/assistant-engine/test/assistant-cli-surface-bootstrap.test.ts`

## Constraints

- Do not broaden provider-turn planning behavior.
- Preserve persisted assistant runtime state as operational state only.
- Do not expose local paths, secrets, vault contents, or identifiers in tests or logs.

## Verification

- `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts test/assistant-cli-surface-bootstrap.test.ts` passed.
- `pnpm --dir packages/assistant-engine typecheck` passed.
- `pnpm test:diff packages/assistant-engine/src/assistant/cli-surface-bootstrap.ts packages/assistant-engine/test/assistant-cli-surface-bootstrap.test.ts` passed.
- `pnpm typecheck` is blocked by unrelated concurrent assistant-engine onboarding/resume edits in `packages/assistant-engine/src/assistant/turn-plan.ts` and `packages/assistant-engine/test/assistant-service-runtime.test.ts`.

## State

- Status: implementation and scoped verification complete; commit pending.
- Next: create scoped commit when safe with overlapping worktree edits.
