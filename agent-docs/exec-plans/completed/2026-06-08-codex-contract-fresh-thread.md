# Codex Contract Fresh Thread

## Goal

Implement the PR 65 follow-up architecture from `docs/codex-contract-fresh-thread-migration-guide.md`: native Codex resume is allowed only when both the route fingerprint and assistant contract fingerprint match; prompt/tool contract changes start a fresh provider thread inside the same Murph session.

## Scope

- Persist an optional `assistantContractFingerprint` in Codex resume state.
- Compute the fingerprint from the thread-start developer instructions plus the current dynamic tools before deciding resume vs fresh start.
- Keep `thread/resume` clean: no developer instructions or dynamic tools on resume.
- Keep fresh-thread fallback on the already-computed thread-start contract.
- Update focused tests and verification.

## Non-Goals

- Do not reintroduce `refreshThreadInstructions`.
- Do not add summaries, periodic rotation, manual epochs, MCP, Codex patches, or thread item injection.
- Do not change unrelated assistant runtime behavior.

## Verification

- Focused assistant-engine/operator-config tests from the migration guide.
- `pnpm typecheck`.
- `pnpm test:diff` for changed files.
Status: completed
Updated: 2026-06-08
Completed: 2026-06-08
