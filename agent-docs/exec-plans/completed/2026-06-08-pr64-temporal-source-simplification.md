# PR64 Temporal source simplification

## Goal

Simplify PR64 Temporal direct-mailbox compatibility logic so the workflow only
special-cases old `source:"manual"` system mailbox signals and does not encode
the new gated manual source name.

Success criteria:

- `canDirectProcessFreshMailboxPointer` returns direct eligibility for every
  non-conversation fresh mailbox source except old `manual`.
- The redundant `manual-ai-gated` workflow constant is removed.
- Focused Temporal tests and typecheck pass.

## Constraints

- Preserve the replay patch-marker behavior already added in PR64.
- Keep the change limited to Temporal workflow compatibility logic.
- Do not alter web producer behavior or mailbox append semantics.

## Approach

1. Remove the redundant manual-ai-gated Temporal source constant.
2. Add a short compatibility comment above the old `manual` fallback.
3. Run focused Temporal verification, then commit and push the PR update.

## State

Active.

## Notes

- Web may still emit `manual-ai-gated`; Temporal does not need to know that
  source name because the only compatibility exception is old `manual`.
Status: completed
Updated: 2026-06-08
Completed: 2026-06-08
