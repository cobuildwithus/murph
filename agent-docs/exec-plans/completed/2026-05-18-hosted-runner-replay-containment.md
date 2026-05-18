# Hosted Runner Replay Containment Plan

Status: completed
Created: 2026-05-18
Updated: 2026-05-18
Owner: Codex

## Goal

Prevent hosted runner replay, stale-checkpoint, and terminal provider-limit loops from generating unbounded AI calls or repeated reply attempts, while preserving the current low-latency reply path.

Success means:

- Normal successful replies do not gain a new synchronous web round trip.
- Usage recording remains asynchronous and is not awaited before replying.
- No new Postgres tables, Durable Object tables, or processing ledgers are introduced.
- Consecutive hosted runner execution failures are bounded by the existing configured attempt limit.
- Provider usage-limit and out-of-credits failures stop the current automation pass instead of scheduling another retry.
- Logs explain retry, parking, and terminal stop decisions with metadata only.

## Non-goals

- Do not add a per-provider-call usage preflight in the Cloudflare egress intercept path.
- Do not make exact spend enforcement depend on waiting for usage recording.
- Do not introduce a web-owned processing ledger or broaden LINQ delivery idempotency.
- Do not rewrite the hosted runtime checkpoint protocol.
- Do not teach assistant-runtime billing policy.
- Do not store prompts, transcripts, mailbox contents, vault contents, account identifiers, raw member identifiers, local paths, or raw provider payloads in diagnostics.

## Simplified Architecture

The stress-test result is simpler than the first draft: there are only two behavioral changes and one preserved invariant.

1. Cloudflare runner owns execution coordination.
   It uses existing Durable Object state to count consecutive execution failures, park after `maxEventAttempts`, and stop scheduling passive alarms for the same failed work.

2. Assistant engine owns terminal provider failure semantics.
   It classifies hosted usage-limit and billing exhaustion before broad capacity retry logic, then writes existing terminal suppression evidence so the same input is not immediately replayed.

3. Usage recording stays async.
   Web remains the owner of usage facts and future-work usage gates. Usage records are accounting/audit facts, not inline runner-start authority.

No other boundary changes are needed:

- Assistant-runtime continues to own restore, mailbox import, local assistant work, side effects, and checkpoint timing.
- LINQ idempotency continues to protect physical send replay only.
- Web continues to gate new hosted runner nudges from product and usage facts.
- Cloudflare does not add new usage-allow-decision enforcement for this fix.

## Code Stress Test

The plan was checked against the current code shape:

- `apps/cloudflare/src/hosted-execution-worker-env.ts` parses `HOSTED_EXECUTION_MAX_EVENT_ATTEMPTS` as `maxEventAttempts`, and `apps/cloudflare/README.md` documents the setting as a retry bound.
- Active runner code does not consistently enforce `maxEventAttempts` before scheduling another alarm or runtime wake.
- `apps/cloudflare/src/user-runner/runner-state-store.ts` already stores the necessary coordination fields: `failure_count`, `last_error_code`, `last_error_at`, `backoff_until`, `wake_at`, and active write-fence metadata.
- `apps/cloudflare/src/user-runner.ts` can currently reschedule from demand-read failure, active wake retry, backoff, new runtime start, mailbox backlog, status-read failure, immediate runtime wake, runtime failure, detached local ensure failure, and active-fence recovery paths.
- `clearWriteFenceAfterFailure` and active-fence expiry already increment failure count, but stale active-fence preemption/replacement through `clearWriteFenceIfCurrent` does not.
- A parked runner must not blindly delete the active-fence recovery alarm while a write fence is still active. Durable Objects support one active alarm per object, and that alarm is also the recovery path for active fence expiry. See Cloudflare Durable Objects Alarms API: https://developers.cloudflare.com/durable-objects/api/alarms/
- Runner failure count does not bound assistant-level successful runtime results that return `nextWakeAt`. That is acceptable here: the plan fixes terminal usage-limit misclassification, not every transient capacity retry policy.
- `packages/assistant-engine/src/assistant-codex/failures.ts` maps Codex usage-limit failures to `ASSISTANT_CODEX_USAGE_LIMIT`.
- `packages/assistant-engine/src/assistant/automation/auto-reply-retry.ts` currently classifies broad limit/quota/rate-limit text as provider capacity.
- `packages/assistant-engine/src/assistant/automation/reply.ts` already has terminal suppression evidence wiring through `writeAssistantAutoReplySuppressionEvidence`; the usage-limit path should reuse that instead of adding a new ledger.
- `packages/assistant-engine/src/assistant/service-usage.ts` records usage with `void usageRecorder.recordUsage(...).catch(...)`; this already matches the no-latency requirement.

## Invariant 1: Runner Failure Cap And Parking

Use one row, one alarm, and existing Durable Object state.

Parked is an inferred state, not a new schema field:

- no active write fence,
- no `wake_at`,
- no `backoff_until`,
- `failure_count >= maxEventAttempts`,
- retained `last_error_code` and `last_error_at`.

Required changes:

- Add one small cap helper near runner state handling, such as `isRunnerRetryCapReached(record, maxEventAttempts)`.
- Add one parking mutation, such as `parkAfterRetryCap`, that clears `wake_at` and `backoff_until`, preserves failure metadata, and does not create a new table or schema field.
- Enforce the cap before starting a hosted runtime wake in `ensureRunnerProgress`.
- Enforce the cap before passive progress rechecks schedule another alarm.
- Enforce the cap after runtime wake failures and detached local ensure failures record failure state.
- Count stale active-fence preemption/replacement as a failure; otherwise repeated not-wakeable or unknown active-child replacement can bypass the cap.
- Preserve the active-fence expiry alarm until the write fence is cleared or intentionally preempted.
- Reset failure state on successful runtime completion only.
- Do not reset retry state from lag sweeper nudges, Vercel Workflow nudges, passive backlog rechecks, alarm recovery, or duplicate nudge paths.
- If product later needs automatic unpark on a truly new user event, add an explicit reset contract from web with tests proving duplicate/sweeper nudges cannot use it. Do not infer freshness in Cloudflare without a mechanical signal.
- Use `computeRetryDelayMs` for retry backoff or delete it during implementation. Do not leave dead retry math around.

Count as failures:

- runtime invocation failure,
- detached local ensure failure,
- expired active write fence,
- stale active-fence preemption/replacement.

Do not count as failures:

- accepted active-child wake,
- fresh startup-grace recheck,
- passive mailbox backlog recheck,
- status-read recheck before any runtime failure,
- successful runtime result with a future runtime timer.

Expected behavior:

- Consecutive failed hosted runner execution attempts stop at `HOSTED_EXECUTION_MAX_EVENT_ATTEMPTS`.
- Passive scheduler paths cannot keep replaying the same failed work after the cap.
- Same-workspace replay is contained by the same cap; it does not need a separate ledger or phase.
- Successful progress clears retry state.

## Invariant 2: Terminal Usage-Limit Suppression

Use existing assistant auto-reply terminal suppression evidence. Do not add a new table, attempt counter, or processing ledger.

Required changes:

- Add a narrow helper near `auto-reply-retry.ts`, such as `isAssistantProviderUsageLimitError(error)`.
- Check terminal usage-limit before `isAssistantProviderCapacityError` in `classifyAssistantAutoReplyFailure`.
- Return an existing skipped terminal suppression outcome, with:
  - `advanceCursor: true`,
  - `checkpointRequired: true`,
  - `nextWakeAt: null`,
  - `stopScanning: true`,
  - `terminalSuppression: true`,
  - no chat-error artifact.
- Persist suppression evidence with `writeAssistantAutoReplySuppressionEvidence` for all accepted input IDs and capture IDs. Captureless hosted mailbox inputs must be covered by input ID.
- If suppression evidence cannot be persisted, fail the processing attempt and do not advance the cursor.
- Sanitize the stored reason. Store a normalized terminal reason such as hosted usage limit or provider credits exhausted, not raw provider body text.

Terminal signals:

- `ASSISTANT_CODEX_USAGE_LIMIT`,
- provider failure metadata with `providerUsageLimit === true`,
- clear billing or credit exhaustion text such as `usage limit`, `purchase more credits`, `out of credits`, `credit balance`, or `plan and billing details`.

Non-terminal signals that should stay on existing retry paths:

- generic HTTP 429,
- `rate limit`,
- `too many requests`,
- retry-after metadata,
- `try again at` by itself,
- stalled provider,
- connection-lost provider,
- repairable assistant config errors.

Expected behavior:

- Hosted usage-limit and out-of-credits failures stop the current automation pass.
- The same terminal input is skipped on later scanner passes because suppression evidence exists.
- Transient provider capacity behavior remains unchanged.
- No billing policy moves into assistant-runtime.

## Invariant 3: Async Usage And Existing Gates Stay As-Is

Preserve the current fast path.

Required behavior:

- Leave `recordAssistantUsageEvent` fire-and-forget.
- Do not await web usage recording before sending a reply.
- Do not call web for every provider request.
- Keep web as the owner of future hosted runner nudge decisions.
- Keep usage records idempotent accounting/audit facts, not inline execution authority.

Expected behavior:

- Normal reply latency is unchanged.
- Exact spend can still overshoot within a single already-started invocation, because avoiding that would require a per-call gate or awaiting usage.
- The incident class is contained by stopping terminal usage-limit retry loops and bounding runner execution failures.

## Metadata-Only Observability

Add enough diagnostics to prove the fix in production without leaking private data.

Required log events:

- `runner_retry_scheduled`:
  - safe runner fingerprint or existing redacted runner key,
  - failure count,
  - max attempts,
  - retry delay,
  - last error code,
  - scheduler source: alarm, nudge, backlog, runtime failure, status read, or active-fence recovery.
- `runner_parked_retry_cap`:
  - failure count,
  - max attempts,
  - last error code,
  - active write-fence state if already safe,
  - no mailbox text, prompt text, provider body, vault data, account ids, raw member ids, or local paths.
- `assistant_terminal_usage_limit`:
  - provider family,
  - normalized terminal reason code,
  - input/capture count only,
  - no raw provider response body.

Expected behavior:

- The next incident can answer whether the system parked because of runner retry cap, terminal provider usage-limit, or web usage gate denial.
- Logs remain safe under repository privacy rules.

## Tests

Focused tests should prove behavior before broad verification.

Cloudflare runner tests in `apps/cloudflare/test/user-runner-alarm.test.ts`:

- repeated runtime wake failures park with no next alarm after `maxEventAttempts`,
- detached local ensure failure counts toward the cap,
- stale active-fence replacement counts toward the cap,
- passive mailbox backlog rechecks cannot bypass the cap,
- status-read rechecks cannot bypass the cap,
- active-fence expiry alarm is preserved until the fence is cleared,
- successful runtime completion resets failure state,
- lag sweeper and workflow duplicate nudges do not reset failure state,
- same-workspace stale replay is bounded by the same failure cap.

Assistant engine tests in `packages/assistant-engine/test/assistant-automation-runtime.test.ts`:

- `ASSISTANT_CODEX_USAGE_LIMIT` writes terminal suppression evidence, advances cursor, requires checkpoint, stops scanning, and schedules no wake,
- raw billing exhaustion such as out-of-credits or billing-plan text behaves as terminal usage-limit,
- generic 429/rate-limit/retry-after behavior still uses existing capacity retry with `advanceCursor: false`,
- captureless hosted mailbox input writes and reads suppression evidence by input ID,
- grouped inputs write suppression evidence for every accepted input ID,
- suppression evidence write failure prevents cursor advancement,
- stored terminal reason is sanitized and does not include raw provider response text.

Existing usage tests should remain unchanged:

- usage recording stays non-blocking,
- usage recording failure is non-fatal,
- usage IDs remain idempotent accounting keys.

## Verification

Run the smallest commands that cover the changed surfaces, then broaden only if the diff grows.

Planned commands:

```bash
pnpm --dir apps/cloudflare test:node -- user-runner-alarm.test.ts
pnpm --dir apps/cloudflare typecheck
pnpm --dir packages/assistant-engine test -- assistant-automation-runtime.test.ts
pnpm --dir packages/assistant-engine typecheck
git diff --check
```

If implementation touches shared runtime contracts, also run:

```bash
bash scripts/workspace-verify.sh test:diff <changed-files>
```

## Failure-Mode Matrix

| Failure mode | Old risk | Planned behavior |
| --- | --- | --- |
| Runtime fails after provider call but before checkpoint | Same work can replay and call provider again | Failure count increments; cap parks runner; no passive alarm after cap |
| Stale active child is repeatedly replaced | Replacement can set another wake without counting failure | Replacement counts failure and parks at cap |
| Mailbox backlog remains on stale workspace | Passive rechecks can keep nudging unresolved work | Passive rechecks respect cap and never reset failure state |
| Codex usage-limit or out-of-credits | Classified as capacity and retried | Classified as terminal suppression; no retry wake |
| Generic 429 or temporary provider overload | Existing retry behavior required | Existing assistant retry behavior remains unchanged |
| Normal successful reply | Should stay fast | No new web round trip; async usage recording remains |
| Usage spend crosses allowance during already-started work | Exact inline cap would require latency or per-call gate | Current invocation may overshoot, but terminal loops stop and future nudges remain web-gated |
| Duplicate LINQ delivery | Duplicate send risk | Existing deterministic delivery idempotency remains; not used as processing authority |

## Open Decisions

Recommended defaults:

- Retry reset policy: reset only on successful runtime completion and explicit manual/admin repair. Do not reset from ordinary nudges unless a future explicit reset contract is added.
- Public status: avoid adding a new public parked status unless product/UI needs it. Prefer inferred parked state plus structured logs for this fix.
- Retry delay: either use existing `computeRetryDelayMs` or delete it in the same implementation.

## Acceptance Criteria

- No new tables or durable ledgers.
- No awaited usage recording.
- No per-provider-call usage gate.
- No automatic failure-count reset from lag sweeper, workflow, passive backlog, or duplicate nudge paths.
- `HOSTED_EXECUTION_MAX_EVENT_ATTEMPTS` is enforced in active runner scheduling paths.
- Stale active-fence replacement cannot bypass the cap.
- Terminal usage-limit and out-of-credits failures cannot enter the capacity retry loop.
- Terminal usage-limit handling uses existing suppression evidence and does not advance the cursor if evidence cannot be persisted.
- Focused tests cover runner cap, parking, terminal usage-limit handling, transient retry preservation, and async usage preservation.
- Production logs can explain a parked runner or terminal usage-limit stop using metadata only.

## Implementation Summary

- Cloudflare runner retry containment now uses existing runner meta state to infer parked state at the configured attempt cap.
- Runtime wake failures, detached local ensure failures, expired active fences, and stale active-fence replacement count toward the same cap.
- Passive backlog/status rechecks and duplicate nudges no longer schedule another alarm after the cap, while active write-fence recovery alarms remain protected.
- Assistant auto-reply now classifies Codex/provider usage-limit and billing-exhaustion failures before broad capacity retry handling.
- Terminal usage-limit failures write existing suppression evidence with a fixed sanitized reason, advance/checkpoint the cursor only after evidence persists, stop scanning, and schedule no wake.
- Generic rate-limit/capacity behavior and fire-and-forget usage recording remain unchanged.

## Verification Results

Passed:

```bash
pnpm exec vitest run apps/cloudflare/test/user-runner-alarm.test.ts --config apps/cloudflare/vitest.node.workspace.ts --no-coverage
pnpm --dir apps/cloudflare verify
pnpm --dir apps/cloudflare typecheck
pnpm --dir packages/assistant-engine test -- assistant-automation-runtime.test.ts
pnpm --dir packages/assistant-engine test:coverage
pnpm --dir packages/assistant-engine typecheck
pnpm typecheck
git diff --check
```

Completion/security review subagents reported no findings after implementation.

Known unrelated verifier blocker:

```bash
bash scripts/workspace-verify.sh test:diff <changed-files>
```

The diff-aware verifier stopped on an unrelated dirty workflow guard in `.github/workflows/cloudflare-hosted-e2e.yml`, where an existing CLI workflow test expected a different count of Postgres service images. The workflow file is outside this task scope.

## Deployment Notes

Deploy assistant-engine/runtime bundle and Cloudflare runner cap changes together when the terminal usage-limit behavior is packaged into the hosted runner bundle. Cloudflare-only parking would still bound execution failures, but it would park after wasted attempts instead of stopping cleanly inside assistant automation.

After deploy, check for:

- `runner_parked_retry_cap` metadata events,
- no repeated passive wakes for the same last error beyond the configured cap,
- terminal usage-limit failures producing suppression evidence and no scheduled retry wake,
- lag sweeper and workflow nudges not resetting parked retry state,
- future nudge denials still coming from the web usage gate.
Completed: 2026-05-18
