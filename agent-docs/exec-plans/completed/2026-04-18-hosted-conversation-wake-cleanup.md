## Goal

Remove the remaining generic webhook-shaped Linq normalization from hosted `conversation.message` runtime ingestion so the hosted runtime consumes a hosted-specific conversation adapter instead of round-tripping through webhook parsing.

## Scope

- `packages/assistant-runtime/src/hosted-runtime/events/**`
- `packages/inboxd/src/connectors/linq/**` only where a hosted-specific shared adapter/helper is the cleanest seam
- focused tests under `packages/assistant-runtime/test/**` and `packages/inboxd/test/**`

## Constraints

- Do not touch `apps/web/**` or `apps/cloudflare/**`.
- Preserve the inbox/parser pipeline as the canonical ingest and persistence path.
- Prefer a minimal semantic-preserving hard cut over broad abstraction work.
- Preserve unrelated in-flight worktree edits.

## Verification

- Focused `assistant-runtime` and `inboxd` tests for hosted conversation/Linq ingestion
- Package typecheck for the touched owner packages
