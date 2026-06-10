Goal (incl. success criteria):
- Classify Codex provider failures from the app-server's structured `codexErrorInfo` (pinned codex 0.135.0 protocol) instead of free-text pattern matching, and surface the typed failure code in persisted `cron.job.completed` runtime-log events.
- Success: usage-limit/connection classification is immune to provider message rewording (proven by tests using non-matching text), text matchers are removed from the RPC turn-failure path (stderr sniffing retained only for process crashes with no RPC error), and a quota-coded cron failure is queryable via `failureContext.errorCode` in `hosted_runtime_log`.

Constraints/Assumptions:
- `ASSISTANT_CODEX_USAGE_LIMIT` / `ASSISTANT_CODEX_CONNECTION_LOST` / `ASSISTANT_CODEX_FAILED` code strings and retryable semantics unchanged (turn_failed stays non-retryable; process-exit connection loss stays retryable).
- No contract changes: `AssistantCronRunRecord` schema untouched; the error code rides the execution result, not the persisted run record.
- Verified against codex tag rust-v0.135.0: `TurnError { message, codexErrorInfo?, additionalDetails? }` in v2 `ErrorNotification`; variants include usageLimitExceeded, httpConnectionFailed{httpStatusCode}, responseStreamConnectionFailed, responseStreamDisconnected, responseTooManyFailedAttempts, serverOverloaded, unauthorized, etc.

Key decisions:
- Structured-first with explicit precedence: when `codexErrorInfo` is present it solely determines classification (a non-connection structured code is not overridden by connection-sounding text); stderr/text sniffing applies only when no structured error ever arrived (true process-crash path).
- `isCodexUsageLimitFailureText` deleted outright (quota failures always arrive via RPC, never stderr-only); `isCodexConnectionLossText` retained for the crash path and display logic.
- Context fields `codexErrorInfoPresent` / `codexErrorInfo` / `codexErrorHttpStatusCode` added to failure errors so prod can confirm structured info coverage before any further matcher deletion.

State:
- Done; ready for PR.

Done:
- Extractor (`extractCodexErrorInfo`) + threading (`lastEventErrorInfo`) + classification rework + cron `runErrorCode` -> `cron.job.completed` failureContext.errorCode.
- Full assistant-engine suite 1214 passed / 3 skipped; both packages typecheck clean.
- coverage-write pass added e2e turn-failure classification via simulated app-server stream, structured-over-text precedence at process exit, extractor edges, abort precedence (157 tests green).
- task-finish-review: safe to land; accepted findings fixed (turn.completed added to extractor gate so the embedded `Turn.error.codexErrorInfo` on failed turns is read; `runErrorCode` added to `AssistantCronRunExecutionResult`; maintenance-level test proves `failureErrorCode` lands in the persisted redacted log, 51/51).
- Advisory accepted as follow-up: `willRetry: true` stream-retry errors update `lastEventErrorInfo` (exact parity with pre-existing text behavior; connection kinds make the stale outcome correct today).

Now:
- Commit + PR.

Next:
- Post-deploy: confirm `failureContext.errorCode` rows appear for provider failures and `codexErrorInfoPresent: true` covers them.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- packages/assistant-engine/src/assistant-codex-events.ts
- packages/assistant-engine/src/assistant-codex/failures.ts
- packages/assistant-engine/src/assistant-codex.ts
- packages/assistant-engine/src/assistant/cron/execution.ts
- packages/assistant-engine/src/assistant/cron.ts
- packages/assistant-engine/test/assistant-codex-failures.test.ts
- packages/assistant-engine/test/assistant-codex-runtime.test.ts
- packages/assistant-engine/test/assistant-cron-runtime.test.ts
Status: completed
Updated: 2026-06-10
Completed: 2026-06-10
