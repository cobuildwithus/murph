# Linq Webhook Read Receipts

## Goal

Restore hosted Linq read acknowledgements on the accepted active-member webhook path.

Success criteria:

- Active-member Linq `message.received` webhook handling sends a best-effort read acknowledgement after durable mailbox append/plan acceptance and before the Cloudflare handoff.
- Read acknowledgement failures do not fail webhook responses or prevent runner handoff.
- Invalid, duplicate, signup-link, non-iMessage first-contact, or failed-persistence paths do not acknowledge reads.
- Focused hosted-onboarding tests cover the restored behavior.

## Constraints

- Do not print or persist raw webhook payloads, provider tokens, phone numbers, or message bodies in logs/tests beyond synthetic fixtures already used by the suite.
- Keep the provider call bounded by the existing short timeout.
- Preserve unrelated dirty files and active ledger rows.
- No new persisted state.

## Implementation Notes

- Reuse the existing `sendHostedLinqReadReceipt` helper and the existing `ingressReadReceiptChatId` planner output.
- Keep the read receipt best-effort and timing-observable through privacy-bounded metadata only.

## Verification

- `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-onboarding-linq-dispatch.test.ts apps/web/test/hosted-onboarding-linq-http.test.ts` passed.
- `pnpm --dir apps/web typecheck` passed.
- `pnpm typecheck` is blocked outside this change by `packages/assistant-runtime/test/package-entrypoints.test.ts` missing package-entrypoint modules.
- `bash scripts/workspace-verify.sh test:diff apps/web/src/lib/hosted-onboarding/webhook-service.ts apps/web/test/hosted-onboarding-linq-dispatch.test.ts apps/web/test/hosted-onboarding-linq-http.test.ts` is blocked outside this change by dirty UI test expectations in hosted onboarding join-invite and start-experiment button tests.
- Required security/privacy, coverage-write, and task-finish reviews completed; no current-diff issues found.
Status: completed
Updated: 2026-04-29
Completed: 2026-04-29
