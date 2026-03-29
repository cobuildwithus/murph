# Hosted Run Trace And Log Hardening

Status: completed
Created: 2026-03-30
Updated: 2026-03-30

## Goal

- Harden the hosted run-trace and logging path so structured logs, runner retry state, and adjacent hosted warnings never persist or emit raw secret-bearing exception text while preserving stable operator-facing diagnostics.

## Success criteria

- Hosted structured logs emit sanitized operator messages and safe summarized error payloads instead of raw `error.message`, arbitrary custom `error.name`, or implicit `dispatch.event.userId`.
- Cloudflare runner retry/poison/configuration state persists only sanitized operator-safe summaries.
- Adjacent hosted warning/error call sites in runtime and worker route handling use the shared safe summarizer/logger.
- Focused regression tests cover bearer tokens, emails, and env-var-style secrets in the touched hosted paths.

## Scope

- In scope:
  - `packages/hosted-execution/src/observability.ts`
  - `apps/cloudflare/src/{index.ts,user-runner.ts,user-runner/runner-queue-store.ts,user-runner/runner-commit-recovery.ts}`
  - `packages/assistant-runtime/src/hosted-runtime/{usage.ts,maintenance.ts}`
  - Targeted hosted/cloudflare/runtime tests plus the supplied docs patch
- Out of scope:
  - Broader hosted execution architecture changes beyond logging/sanitization
  - Unrelated dirty worktree lanes already active in CLI/query/assistant packages

## Constraints

- Technical constraints:
  - Preserve current hosted execution behavior and public contracts outside the logging/error-summary surface.
  - Merge against live file state because patch `0003` does not apply cleanly at `packages/hosted-execution/src/observability.ts`.
- Product/process constraints:
  - Keep the lane narrow and non-exclusive; preserve adjacent in-flight edits.
  - Run repo-required audit passes and required verification commands as far as this environment allows.

## Risks and mitigations

1. Risk: The supplied code patch may conflict with newer observability changes and regress current log schema behavior.
   Mitigation: Inspect the live diff at each touched file, merge behavior intentionally, and add/retain focused tests around the sanitized outputs.
2. Risk: Repo-wide verification may still be blocked by unrelated pre-existing worktree or dependency issues.
   Mitigation: Run the required commands anyway, capture exact blockers, and separate scoped evidence from unrelated failures.

## Tasks

1. Register the lane, inspect the supplied patches, and merge them against the current worktree.
2. Apply the docs patch and implement the code-path hardening updates plus regression tests.
3. Run focused and repo-required verification available in this environment.
4. Run mandatory `simplify` and `task-finish-review` audit passes, address any findings, then close/commit the plan.

## Decisions

- Use the supplied docs patch directly if it applies cleanly, but merge the main code patch manually because `git apply --check` fails in `packages/hosted-execution/src/observability.ts`.

## Verification

- Commands to run:
  - `git apply --check` on the supplied patches
  - Focused tests/typecheck for touched hosted/cloudflare/runtime files when dependencies permit
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm test:coverage`
- Expected outcomes:
  - Sanitized log/state behavior covered by focused tests
  - Repo-required checks either pass or fail only for defensibly unrelated pre-existing reasons

## Status

Implemented in this clone. Hosted structured logs now redact operator messages, collapse raw exceptions into stable summaries, drop implicit `userId` attachment, and only expose safe built-in error names. Cloudflare runner retry/configuration/poisoned state now persists sanitized summaries instead of raw error text, malformed pending-dispatch poisoning now writes explicit stable invalid-request state without depending on summary wording, adjacent hosted warning paths use the same safe logger/summarizer, and focused regressions cover bearer-token/email/env-style secret inputs, malformed-dispatch classification, durable-commit summary behavior, and secret-bearing configuration errors.

## Verification Notes

- `git apply --check /Users/willhay/Downloads/0003-hosted-run-trace-log-hardening.patch` failed in `packages/hosted-execution/src/observability.ts`, so the code patch was merged manually against live file state. `0004` applied cleanly at the behavior level and its documentation change was merged.
- Mandatory `simplify` audit pass ran via spawned subagent and produced one actionable finding: malformed pending-dispatch sanitization still depended on summary wording and stale meta writes. That finding was fixed by classifying malformed rows with explicit stable codes and rereading `runner_meta` before returning a no-pending claim result.
- Mandatory `task-finish-review` audit pass ran via spawned subagent and produced one actionable finding: the hosted configuration-message allowlist was too broad and could preserve inline secret text. That finding was fixed by restricting the allowlist to closed-form safe patterns and adding a regression for secret-bearing configuration errors.
- `pnpm --dir packages/hosted-execution typecheck` passed.
- `pnpm --dir packages/assistant-runtime typecheck` passed.
- `pnpm --dir apps/cloudflare typecheck` passed.
- `pnpm exec vitest run packages/hosted-execution/test/hosted-execution.test.ts packages/assistant-runtime/test/hosted-runtime-usage.test.ts packages/assistant-runtime/test/hosted-runtime-maintenance.test.ts --configLoader runner --no-coverage --maxWorkers 1` passed.
- `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts apps/cloudflare/test/runner-queue-store.test.ts apps/cloudflare/test/user-runner.test.ts --no-coverage --maxWorkers 1` passed.
- Direct scenario check via `pnpm exec tsx --eval ...buildHostedExecutionStructuredLogRecord(...)` emitted an authorization-safe structured log record with `message: "Authorization=Bearer [redacted] for [redacted-email]"`, `errorMessage: "Hosted execution authorization failed."`, and `userId: null`.
- `pnpm typecheck` failed for pre-existing `apps/web` typecheck errors outside this lane:
  - `apps/web/src/lib/hosted-execution/hydration.ts:267` TS2532 object possibly undefined
  - `apps/web/src/lib/hosted-execution/usage.ts:81` TS2322 credentialSource typing mismatch
- `pnpm test:coverage` failed for the same pre-existing `apps/web` typecheck errors above.
- `pnpm test` remained blocked outside this lane as well. In reruns after the simplify fixes it surfaced unrelated pre-existing workspace failures and transient wrapper contention:
  - `packages/core/src/ids.ts` missing `@murph/runtime-state` resolution
  - `packages/core/src/operations/canonical-write-lock.ts` missing `@murph/runtime-state` resolution plus pre-existing implicit-`any` / `unknown` typing errors
  - one rerun also hit a transient `packages/web` Next build lock collision while the wrapper retried, which did not involve the hosted-run trace/logging files
Completed: 2026-03-30
