Goal (incl. success criteria):
- Improve device-sync job failure diagnostics so local/hosted logs preserve useful validation context without leaking raw provider payloads, secrets, paths, or direct identifiers.
- Success: validation failures include more sanitized issue summaries from common error shapes; sensitive fields are redacted; focused tests pass.

Constraints/Assumptions:
- Preserve existing unrelated work in `apps/web/app/api/device-sync/messaging-return/route.ts` and existing active ledger rows.
- Do not log raw WHOOP/provider payloads, tokens, headers, filesystem paths, emails, phones, or direct identifiers.
- Keep diagnostics bounded and sanitized.

Key decisions:
- Extend existing sanitized summary flow instead of adding raw error-object persistence.
- Treat validation issue paths/messages as metadata only; redact sensitive path segments and scalar values.

State:
- Complete; ready for scoped commit/plan close.

Done:
- Confirmed local DB has an active WHOOP connection and the first sync failed with `SYNC_JOB_FAILED`.
- Confirmed current hosted runtime log only has a short failure summary.
- Patched device-sync failure summarization to collect nested sanitized validation issues and keep longer bounded summaries.
- Added a regression test for nested Zod-like validation metadata and sensitive path/message redaction.
- Verified full workspace typecheck, diff-scoped tests, package typecheck/test, and raw health-log guard.

Now:
- Close plan and create scoped commit if the helper can avoid unrelated dirty work.

Next:
- Handoff with verification summary.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `packages/device-syncd/src/service.ts`
- `packages/device-syncd/src/hosted-runtime.ts`
- `packages/device-syncd/test/service.test.ts`
- `packages/device-syncd/test/hosted-runtime.test.ts`
- `packages/assistant-runtime/src/hosted-runtime/maintenance.ts`
- `packages/assistant-runtime/test/hosted-runtime-maintenance.test.ts`
Status: completed
Updated: 2026-05-04
Completed: 2026-05-04
