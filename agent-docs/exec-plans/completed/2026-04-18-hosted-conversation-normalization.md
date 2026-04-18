## Goal

Refactor `packages/assistant-runtime` so hosted conversation wake ingestion reads as canonical wake normalization plus inbox/parser persistence instead of routing through provider-specific `buildHosted*Capture` re-entry helpers.

## Scope

- `packages/assistant-runtime/src/hosted-runtime/events/{conversation,email,linq,telegram}.ts`
- focused `packages/assistant-runtime/test/**` coverage for hosted conversation wake normalization and provider-specific low-level helpers

## Constraints

- Stay strictly inside `packages/assistant-runtime`.
- Do not touch `apps/web`.
- Preserve hosted Linq attachment download behavior, Telegram attachment download behavior, and hosted raw email fetch/normalize behavior.
- Keep inbox/parser persistence behavior intact.
- Do not revert or overwrite unrelated concurrent changes.

## Verification

- `pnpm --dir packages/assistant-runtime typecheck`
- focused `pnpm --dir packages/assistant-runtime test -- --run <targeted tests>` if truthful for the touched slice
Status: completed
Updated: 2026-04-18
Completed: 2026-04-18
