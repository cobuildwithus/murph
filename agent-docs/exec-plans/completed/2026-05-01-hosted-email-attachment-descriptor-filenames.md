# hosted-email-attachment-descriptor-filenames

Status: completed
Created: 2026-05-01
Updated: 2026-05-01

## Goal

- Stop storing hosted email attachment filenames in assistant input attachment descriptors unless a prompt or UI surface concretely needs them.

## Success criteria

- Hosted email `attachmentSummaries` still produce assistant input attachment descriptors with count, kind, MIME type, size, and enrichment status.
- Hosted email assistant input descriptors set `fileName: null`, matching the existing minimized descriptor behavior for Linq and Telegram.
- Raw inbox projection/evidence can still retain attachment filenames for parser/search/debugging enrichment.
- Tests prove filenames from hosted email mailbox payloads do not persist into assistant input admission records.

## Scope

- In scope: hosted conversation mailbox import descriptor construction and directly coupled assistant-runtime tests.
- Out of scope: inbox projection/raw evidence schemas, prompt builder descriptor rendering, provider mailbox payload contracts, and UI display.

## Constraints

- Keep mailbox import checkpoint semantics unchanged.
- Preserve attachment IDs, kind, MIME type, size, and enrichment status.
- Do not introduce new persisted state or compatibility shims.
- Preserve unrelated dirty work in hosted web, Cloudflare, Junction, and assistant runtime lanes.

## Tasks

1. Inspect hosted mailbox descriptor construction and existing tests.
2. Change hosted email descriptor filename staging to `null`.
3. Update focused coverage for hosted email descriptor minimization.
4. Run package-focused verification, privacy/security review, coverage review, and final review.
5. Commit only the scoped completed plan, runtime, and test changes because the shared ledger has unrelated active edits.

## Verification

- Commands to run: `pnpm typecheck`; `pnpm test:diff packages/assistant-runtime/src/hosted-runtime/mailbox-conversation-import.ts packages/assistant-runtime/test/hosted-runtime-mailbox-conversation-import.test.ts`; `git diff --check`.
- Passed: `pnpm typecheck`.
- Passed: `pnpm test:diff packages/assistant-runtime/src/hosted-runtime/mailbox-conversation-import.ts packages/assistant-runtime/test/hosted-runtime-mailbox-conversation-import.test.ts`.
- Passed: `git diff --check`.
- Security/privacy review: no findings.
- Coverage-write review: no test edits needed; existing focused test proves descriptor `fileName: null` and absence of the original filename from the persisted assistant input event.
- Final review: no findings.
Completed: 2026-05-01
