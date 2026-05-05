# Hosted Assistant Error Message Logging

## Goal

Persist bounded, redacted assistant provider error message text in hosted runtime logs so production reply failures can be diagnosed from Postgres.

## Scope

- `packages/assistant-runtime/src/hosted-runtime/workspace-assistant-phase.ts`
- `packages/assistant-runtime/test/hosted-runtime-workspace-assistant-phase.test.ts`

## Constraints

- Preserve existing hosted log key/value bounds.
- Redact paths, contacts, and secret-shaped text before persistence.
- Do not expose raw prompts, payloads, auth headers, or identifiers.
- Preserve unrelated dirty work in the checkout.

## Verification

- `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --no-coverage test/hosted-runtime-workspace-assistant-phase.test.ts test/hosted-runtime-workspace-assistant-phase-diagnostics.test.ts` passed.
- `pnpm typecheck` passed.
- `git diff --check -- packages/assistant-runtime/src/hosted-runtime/workspace-assistant-phase.ts packages/assistant-runtime/test/hosted-runtime-workspace-assistant-phase.test.ts packages/assistant-runtime/test/hosted-runtime-workspace-assistant-phase-diagnostics.test.ts agent-docs/exec-plans/active/2026-05-05-hosted-assistant-error-message-logging.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md` passed.
- `pnpm --dir packages/assistant-runtime test -- test/hosted-runtime-workspace-assistant-phase.test.ts test/hosted-runtime-workspace-assistant-phase-diagnostics.test.ts` invoked the broader package test suite and failed on unrelated pre-existing hosted runtime environment/Codex config expectations; the two targeted files passed when run directly through Vitest.
