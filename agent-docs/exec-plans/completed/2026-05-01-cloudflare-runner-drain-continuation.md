# Cloudflare runner delayed continuation cleanup

Status: completed
Created: 2026-05-01
Updated: 2026-05-01

## Goal

- Land the bounded Cloudflare runner cleanup requested for production readiness:
  keep the stale queue-runner surface deleted and make pending-nudge drain
  continuation alarms use a short explicit delay rather than relying on the
  broader retry delay or immediate alarm scheduling.

## Success criteria

- `apps/cloudflare/src/runner-wake-queue.ts` remains deleted/untracked.
- No queue-runner symbols remain under `apps/cloudflare`.
- Pending-nudge continuation scheduling in the current runner implementation uses
  a named 1s delay and focused tests assert that behavior.
- Requested Cloudflare test/build commands pass or any unrelated blockers are
  documented precisely.

## Scope

- In scope:
- `apps/cloudflare/src/user-runner.ts`
- directly coupled `apps/cloudflare/test/user-runner-alarm.test.ts`
- this plan and coordination ledger row
- Out of scope:
- Reintroducing queue bindings or queue handlers.
- Adding `nudge_generation`, container signals, or any new persisted state.
- Changing hosted web control-plane behavior or unrelated Cloudflare crypto work.

## Constraints

- Technical constraints:
- Preserve the current direct detached runner drive as the hot path.
- Keep Durable Object alarms as delayed continuation, watchdog, or recovery
  scheduling only.
- Do not touch unrelated dirty work in this checkout.
- Product/process constraints:
- Follow repo Cloudflare/runtime verification and completion workflow.
- Keep logs and docs free of local personal identifiers or secrets.

## Risks and mitigations

1. Risk: shortening the pending-nudge alarm could fight active invocation
   recovery semantics.
   Mitigation: scope the delay to the post-completion pending-nudge continuation
   path where the current code also starts a direct follow-up drive.
2. Risk: dirty checkout contains unrelated Cloudflare and ledger changes.
   Mitigation: stage and commit only the exact files touched for this task.

## Tasks

1. Confirm stale queue file/symbols are absent in the current checkout.
2. Apply the current-code equivalent delayed continuation constant and test
   expectation update.
3. Run requested searches, Cloudflare tests, and Cloudflare build.
4. Run required completion audits and repair any relevant findings.
5. Finish the plan with a scoped commit if verification permits.

## Decisions

- Current `main` no longer has the exact supplied patch context. The queue file
  is already absent and the drain path now queues a direct follow-up drive after
  the invocation lock releases. Apply the requested 1s delay to that path's
  fallback alarm rather than reintroducing the older loop shape.

## Verification

- Commands to run:
- `rg "runner-wake-queue|RUNNER_WAKE_QUEUE|WorkerQueueMessageBatchLike|runWhenIdleOrBudget" apps/cloudflare`
- `pnpm --filter @murphai/cloudflare test`
- `pnpm --filter @murphai/cloudflare build`
- `pnpm --filter @murphai/cloudflare-runner test`
- `pnpm --filter @murphai/cloudflare-runner build`
- `git diff --check`
- Expected outcomes: no stale queue-symbol matches; Cloudflare tests/build pass.

## Verification status

- Queue-symbol search: no matches.
- Literal `@murphai/cloudflare` filter commands: no matching workspace package in
  this checkout; actual package name is `@murphai/cloudflare-runner`.
- `pnpm --filter @murphai/cloudflare-runner build`: passed.
- `git diff --check` on the task files: passed.
- `pnpm --filter @murphai/cloudflare-runner test`: blocked by unrelated active
  hosted-crypto/email dirty work after app typecheck started. Failing paths
  include hosted email storage key derivation and crypto-context web-callback
  mocks, not the delayed-continuation assertion.
- Later `pnpm --filter @murphai/cloudflare-runner typecheck`: blocked by
  unrelated active `packages/runtime-state/src/hosted-domain-crypto.ts`
  missing-symbol errors.

## Audit status

- `security-privacy-review`: passed with no findings. Residual note: keep the
  final commit scoped so unrelated hosted-crypto hunks in `user-runner.ts` are
  not included.
- `task-finish-review`: passed with no findings. Residual note: clean package
  test/typecheck proof is blocked by unrelated hosted-crypto dirty work.
- `coverage-write`: made no changes. Existing `user-runner-alarm` assertions
  already cover the 1s delayed continuation behavior; focused Vitest for that
  file is blocked by unrelated hosted-crypto test failures.
Completed: 2026-05-01
