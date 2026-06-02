# Codex SIGKILL Diagnostics

## Goal

Explain the hosted Codex app-server `SIGKILL` failure path with code evidence and add metadata-only diagnostics so future failures identify whether the kill came from abort, timeout, explicit cleanup, or unexpected process exit.

## Constraints

- Do not expose prompts, transcripts, provider payloads, secrets, direct identifiers, local account names, or host paths.
- Keep diagnostics at the provider/runtime failure boundary and pass only redacted/safe summaries into persisted hosted runtime logs.
- Preserve hosted foreground priority; do not add schedulers, retries, or fallback owners.
- Do not touch unrelated active hosted-local E2E or device-sync overlay work.

## Working Set

- `packages/assistant-engine/src/assistant-codex.ts`
- `packages/assistant-engine/src/assistant-codex/failures.ts`
- `packages/assistant-engine/src/assistant/automation/failure-observability.ts`
- `packages/assistant-engine/src/assistant/providers/codex-cli.ts`
- `packages/assistant-engine/test/assistant-codex-runtime.test.ts`
- `packages/assistant-runtime/src/hosted-runtime/events.ts`
- `packages/assistant-runtime/src/hosted-runtime/workspace-assistant-phase.ts`
- focused assistant-engine and assistant-runtime tests around Codex failure diagnostics/runtime-log persistence

## Verification Plan

- Focused assistant-engine tests for SIGKILL diagnostic classification.
- `pnpm test:diff` or package-local assistant-engine coverage if diff-aware coverage is not truthful.
- `pnpm typecheck`, unless blocked by an unrelated pre-existing failure.

## Completion Notes

- Required security/privacy review applies because this touches persisted diagnostics and runtime failure metadata.
- Coverage-write/final review follow the repo completion workflow after implementation.
- Implemented metadata-only Codex app-server exit diagnostics at the child-process boundary and preserved safe summaries through assistant failure context, provider traces, hosted trace redaction, and durable hosted assistant detail logs.
- Verification passed: focused assistant-engine diagnostics tests, focused assistant-runtime hosted log tests, `pnpm typecheck`, and diff-aware verification for the touched assistant-engine/runtime files and reverse dependents.
- Security/privacy review found no concrete leak or authority regression. Coverage-write added direct pending-RPC SIGKILL proof. Simplify removed a redundant provider-diagnostic preservation branch.
Status: completed
Updated: 2026-06-02
Completed: 2026-06-02
