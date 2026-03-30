# 2026-03-27 Assistant Canonical Write Guard

## Goal

- Add a runtime enforcement layer for vault-operator assistant turns so direct canonical vault file edits are rolled back unless they came through audited CLI/core mutation paths.

## Scope

- `packages/cli/src/assistant/service.ts`
- `packages/cli/src/assistant/canonical-write-guard.ts`
- targeted `packages/cli/test/{assistant-service,assistant-runtime}.test.ts`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`

## Design

1. Snapshot protected text-based canonical vault files before each provider attempt.
2. Let the provider run normally.
3. Read new committed core write-operation metadata created during the attempt.
4. Reconstruct the expected final protected-file state from those committed operations instead of trusting path mentions alone.
5. Compare the expected protected state with the post-attempt state and roll back any unexpected direct edits.
6. Fail the turn with a clear assistant error when rollback was needed so the invalid direct mutation does not silently persist.

## Constraints

- Preserve legitimate `vault-cli` writes that go through the audited core mutation surface.
- Keep the protection scoped to the active vault, not repo code.
- Avoid broad filesystem policy guesses about hidden Codex path controls.
