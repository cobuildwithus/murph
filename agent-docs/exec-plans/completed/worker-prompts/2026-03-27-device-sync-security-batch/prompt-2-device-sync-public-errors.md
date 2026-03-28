Murph security lane: remove provider-response body leakage from device-sync public errors, hosted JSON errors, and CLI startup logging.

Ownership:
- Own `packages/device-syncd/src/{providers/shared-oauth.ts,http.ts}`.
- Own `packages/cli/src/bin.ts`.
- Own hosted JSON error shaping in `apps/web/src/lib/{http.ts,device-sync/http.ts}` only as needed for this boundary fix.
- Own direct coverage in `packages/device-syncd/test/http.test.ts` and `apps/web/test/device-sync-http.test.ts`.
- You may touch provider call sites such as `packages/device-syncd/src/providers/{oura.ts,whoop.ts}` only if a direct compile/type adjustment is required.
- This lane sits next to active device-sync control-plane and hosted control-plane work. Read the live file state first, preserve unrelated edits, and do not revert anything you did not author.
- Do not edit outside that scope unless a direct, minimal dependency is unavoidable. If scope changes, update your ledger row first.
- Work in the shared current worktree.
- Do not create commits.

Required repo workflow for this lane:
- Read `AGENTS.md`, `agent-docs/operations/completion-workflow.md`, and `agent-docs/exec-plans/active/COORDINATION_LEDGER.md` before editing.
- Implement the fix, add or adjust direct coverage, run the narrowest truthful verification for your owned surface, and report any remaining gaps.
- The parent lane will run the final repo-level audit passes and commit after collecting worker results.

Issue:
- `packages/device-syncd/src/providers/shared-oauth.ts` currently builds provider API errors with:
  - `details.status`
  - `details.bodySnippet = body.slice(0, 500)`
- Those details can then cross HTTP boundaries unchanged through:
  - local daemon HTTP in `packages/device-syncd/src/http.ts` `sendError()`
  - hosted web JSON routes in `apps/web/src/lib/http.ts` and `apps/web/src/lib/device-sync/http.ts`
- There is also a logging spill path: `packages/cli/src/bin.ts` does `console.error(error)` on startup failure, which can dump the full error object.
- Provider error bodies can contain sensitive provider account ids, token fragments, scopes, or echoed request/provider details. That data should not reach daemon JSON, hosted JSON, or stderr logs.

Best concrete fix:
- Split internal diagnostics from public/client-facing error payloads.
- Do not put raw provider response text in `DeviceSyncError.details` when the error may cross an HTTP boundary.
- Prefer public/client-facing errors shaped roughly as:
  - `{ code, message, retryable, maybe status }`
- If you keep structured details, keep them aggressively sanitized and status-only.
- Replace `console.error(error)` in `packages/cli/src/bin.ts` with a sanitized summary path that does not dump raw nested objects.
- Preserve existing status codes/messages/retryable semantics unless the fix requires a narrow change.

Tests to anchor:
- `packages/device-syncd/test/http.test.ts`
- `apps/web/test/device-sync-http.test.ts`

Specific regression proof requested:
- update existing HTTP/web tests so provider-response snippets are not returned
- add a regression test where a fake provider returns a response body containing a fake token/account id and assert that none of it appears in:
  - local daemon JSON
  - hosted JSON
  - stderr logging from the CLI startup path if you can cover it cleanly in the harness

Report back with:
- files changed
- behavior-level summary
- exact verification commands and results
- any direct scenario proof or remaining gap
