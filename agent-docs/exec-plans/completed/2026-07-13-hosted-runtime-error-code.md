Goal (incl. success criteria):
- Ensure hosted assistant warn/error automation detail logs always carry the machine-readable failure code and safe summary already derived by structured logging.
- Success means the production-shaped Linq authority failure log passes the hosted runtime log parser instead of returning HTTP 400.

Constraints/Assumptions:
- Preserve the strict web parser requirement for warn/error failure records.
- Keep diagnostics redacted and do not expose provider payloads, user identifiers, or secrets.
- Do not change retry or reply behavior; this task fixes only the secondary logging failure.
- Preserve unrelated worktree and ledger edits.

Key decisions:
- Fix the conversion from structured runtime records to buffered redacted automation entries rather than weakening validation at the web boundary.
- Reuse the structured logger's existing derived error code and safe error summary.

State:
- In progress.

Done:
- Traced the failure to `emitHostedRuntimeRedactedLog`, which drops the structured record's top-level `errorCode` and `errorMessage` before the buffered entry reaches the runtime log writer.

Now:
- Add a focused production-shaped failing test and preserve those fields in the buffered redacted entry.

Next:
- Run package coverage/typecheck, required audits, and inspect the final diff.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- packages/assistant-runtime/src/hosted-runtime/maintenance.ts
- packages/assistant-runtime/test/hosted-runtime-maintenance.test.ts
- packages/assistant-runtime/test/hosted-runtime-workspace-assistant-phase.test.ts
Status: completed
Updated: 2026-07-13
Completed: 2026-07-13
