# Hosted Inbox Sidecar Bootstrap

## Goal

Ensure hosted restored workspaces initialize the inbox runtime sidecar before mailbox import, so restored vault inbox envelopes can be projected without `INBOX_NOT_INITIALIZED`.

## Constraints

- Keep CLI inbox behavior unchanged; no silent auto-init outside hosted runtime.
- Hosted startup should use inbox init with `rebuild: true`.
- Per-message projection should stay idempotent and use `rebuild: false`.
- Best-effort mode must sanitize and log failures while allowing assistant input staging to continue.
- Do not require parser setup or external connector config.
- Preserve unrelated dirty work.

## Plan

1. Add a hosted-specific `ensureHostedInboxSidecarReady` helper in the hosted runtime context layer.
2. Call it after workspace restore in `runHostedWorkspaceRuntimeJobInProcess`.
3. Make hosted conversation mailbox projection use the helper idempotently before local inbox import.
4. Add focused regression tests for startup rebuild and projection best-effort behavior.
5. Run scoped package verification and required reviews.

## Verification

- PASS: `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts test/hosted-runtime-workspace-entrypoint.test.ts test/hosted-runtime-context-coverage.test.ts test/hosted-runtime-linq-document-preservation-e2e.test.ts --no-coverage`
- PASS: `pnpm --dir packages/assistant-runtime typecheck`
- PASS: `pnpm typecheck`
- PASS: `git diff --check`
- PASS: privacy scan of hosted sidecar changed files found only synthetic test member ids.
- BLOCKED/UNRELATED: `pnpm test:diff packages/assistant-runtime/src/hosted-runtime.ts packages/assistant-runtime/src/hosted-runtime/context.ts packages/assistant-runtime/src/hosted-runtime/mailbox-conversation-import.ts packages/assistant-runtime/test/hosted-runtime-context-coverage.test.ts packages/assistant-runtime/test/hosted-runtime-linq-document-preservation-e2e.test.ts packages/assistant-runtime/test/hosted-runtime-workspace-entrypoint.test.ts` reached the assistant-runtime suite and failed in `test/hosted-runtime-mailbox-conversation-import.test.ts` because active unrelated attachment filename edits now emit `fileName` values where existing tests expect `null`.
