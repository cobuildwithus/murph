## Goal

Audit CLI save-command success semantics, fix any write paths whose success output is not a trustworthy saved confirmation, and simplify the assistant prompt so it can trust successful save receipts without reasoning about "canonical writes."

## Scope

- `packages/cli/src/**` and `packages/cli/test/**` where command output contracts or examples need tightening
- `packages/vault-usecases/src/**` and tests where save-result plumbing is weak or ambiguous
- `packages/core/src/**` only if a real receipt/commit bug exists
- `packages/assistant-engine/src/assistant/**` and focused prompt tests for the wording change

## Constraints

- Keep the change narrow and behavior-preserving unless a success contract is actually wrong.
- Do not broaden the prompt rule to non-save commands such as scaffold, preview, or inspection flows.
- Preserve unrelated in-flight assistant-engine work; restrict prompt edits to the minimal wording needed.
- Prefer small proof-bearing tests over speculative abstractions.

## Verification

- `pnpm typecheck`
- Truthful diff-aware or package-local coverage-bearing checks for touched owners
- Focused prompt/CLI tests covering save-receipt behavior and the prompt wording
Status: completed
Updated: 2026-04-19
Completed: 2026-04-19
