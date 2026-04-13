Goal (incl. success criteria):
- Diagnose why hosted execution can issue a duplicate `/commit` for the same event and add minimal sanitized logging so the next incident shows whether assistant-delivery effects differ by content or only ordering.
- Land a narrow production-safe diagnostic patch, verify it truthfully, and push it.

Constraints/Assumptions:
- Keep the change narrow and avoid unrelated assistant-engine work already in flight.
- Do not log raw payloads, messages, tokens, or sensitive user content.
- Existing worktree changes outside this task are preserved.

Key decisions:
- Treat the current incident as not yet root-caused; instrumentation should prove the mismatch shape rather than assume ordering.
- Keep diagnostics on the Cloudflare hosted worker side near the durable mismatch check.

State:
- in_progress

Done:
- Reviewed current incident logs and established that the duplicate `/commit` happened earlier than the exported finalize-retry window.
- Reconfirmed the durable mismatch guard in `execution-journal.ts`.

Now:
- Inspect duplicate-commit and resume paths.
- Run high-reasoning review subagents.
- Add sanitized logging.

Next:
- Verify with scoped commands and required audits.
- Commit and push.

Open questions (UNCONFIRMED if needed):
- UNCONFIRMED: whether the duplicate commit differs only by assistant-delivery ordering or by actual effect set/content.
- UNCONFIRMED: which path launches a fresh non-resume invocation after a durable commit already exists.

Working set (files/ids/commands):
- `apps/cloudflare/src/execution-journal.ts`
- `apps/cloudflare/src/user-runner.ts`
- `apps/cloudflare/src/user-runner/runner-dispatch-processor.ts`
- `packages/assistant-runtime/src/hosted-runtime.ts`
- `packages/assistant-runtime/src/hosted-runtime/callbacks.ts`
- `docs/cloudflare-hosted-idempotency-followup.md`
Status: completed
Updated: 2026-04-13
Completed: 2026-04-13
