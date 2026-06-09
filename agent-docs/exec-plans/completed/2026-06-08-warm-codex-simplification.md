# Warm Codex Simplification

## Goal

Land the operator-supplied warm Codex simplification patch while preserving the
hosted/local Codex app-server invariants.

Success criteria:

- Codex app-server warm-process reuse is keyed by launch inputs that genuinely
  affect the child process.
- Per-turn hosted/runtime facts are not treated as process identity.
- Tests cover the updated argument and reuse behavior.
- Required security, coverage, final-review, and deep-review completion passes
  are resolved.

## Scope

- `packages/assistant-engine/src/assistant-codex.ts`
- `packages/assistant-engine/test/assistant-codex-runtime.test.ts`
- `packages/cli/test/assistant-codex.test.ts`
- `packages/assistant-engine/README.md` if the durable Codex warmth contract
  needs wording updates.
- `ARCHITECTURE.md` and `agent-docs/index.md` for the durable architecture
  wording/index date update.

## Constraints

- Treat the supplied patch as behavioral intent, not overwrite authority.
- Do not expand hosted execution authority or leak per-turn identifiers through
  Codex process env.
- Keep the architecture simple; remove hosted-special process-launch branches
  only when existing runtime config already owns that projection.

## Verification Plan

- `pnpm typecheck`
- `pnpm --filter @murphai/assistant-engine test -- test/assistant-codex-runtime.test.ts`
- `pnpm --filter @murphai/murph test -- test/assistant-codex.test.ts`
- `pnpm test:diff`

## Completion Audits

- `security-privacy-review`
- `coverage-write`
- `deep-review`
- `task-finish-review`

Subagent tooling hit the account usage limit during the required completion
audit launch. The user explicitly instructed the parent agent to continue, so
the completion audits were performed locally and the limitation is recorded in
handoff notes.
Status: completed
Updated: 2026-06-08
Completed: 2026-06-08
