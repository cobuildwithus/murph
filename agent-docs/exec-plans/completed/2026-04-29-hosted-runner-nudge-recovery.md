# Hosted Runner Nudge Recovery

## Goal

Fix hosted runner nudge behavior so follow-up Linq messages wake promptly while
Cloudflare stays a thin runner over the local runtime instead of duplicating the
runtime scheduler.

Success criteria:

- Idle nudges still enqueue an immediate runner wake with an alarm fallback.
- Nudges received while the current Durable Object is actively awaiting a
  container invocation mark pending work without scheduling immediate alarm loops.
- Persisted-only in-flight leases can recover after a short orphan grace instead
  of waiting for the full runner timeout.
- Durable Object alarms invoke the local runtime directly instead of rereading
  hosted web runtime status to decide whether workspace work is due.
- Post-run scheduling uses the runtime-returned `nextWakeAt` plus the pending
  rerun flag, not a second hosted web workspace-status reconciliation pass.
- Focused Cloudflare runner tests and typecheck pass.

## Scope

- `apps/cloudflare/src/user-runner.ts`
- `apps/cloudflare/src/user-runner/runner-state-store.ts`
- `apps/cloudflare/src/user-runner/runner-state-schema.ts`
- `apps/cloudflare/src/user-runner/runner-state-helpers.ts`
- `apps/cloudflare/src/user-runner/types.ts`
- `apps/cloudflare/src/runner-container.ts`
- Focused `apps/cloudflare/test/**` coverage for runner nudge/recovery behavior.

## Constraints

- Preserve one active container invocation per hosted user.
- Do not use `waitUntil` as the execution primitive for assistant work.
- Do not add provider-call heartbeat or worker-version lease takeover in this
  change.
- Do not inspect mailbox contents, group messages, or own assistant-turn
  semantics in Cloudflare.
- Preserve unrelated dirty work in the current checkout.

## Verification Plan

- Focused runner tests for active invocation nudges, persisted-only grace, stale
  lease recovery, and direct alarm-to-runtime dispatch.
- Focused runner-container tests for warm-shell cleanup invariants.
- `pnpm --dir apps/cloudflare test ...` or equivalent focused Vitest command.
- `pnpm typecheck`.
- `git diff --check` for touched files.

## Verification Results

- Pass: `pnpm --dir . exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/user-runner-alarm.test.ts apps/cloudflare/test/runner-state-store.bundle-slots.test.ts apps/cloudflare/test/runner-container.test.ts apps/cloudflare/test/index.test.ts`
- Pass: `pnpm --dir . exec vitest run --config apps/cloudflare/vitest.workers.config.ts --no-coverage --passWithNoTests`
- Pass: `pnpm --dir apps/cloudflare typecheck`
- Pass: `git diff --check -- <touched paths>`
- Pass: touched diff scan for local-path and bearer-token leakage patterns.
- Blocked, unrelated: `pnpm --dir apps/cloudflare verify` fails before
  Cloudflare checks in Health Commons content validation because `title` and
  `aliases[0]` exceed 240 characters.
- Partial, blocked unrelated: full Cloudflare Node Vitest is 603/604 passing;
  `apps/cloudflare/test/runner-bundle-workspace-artifacts.test.ts` fails because
  `@murphai/health-commons build` reports a missing source artifact for
  `doi-10.1016/s0031-9406-10-61197-2`.

## Review Results

- Simplify pass: no high/medium findings. It noted possible future helper
  extraction for repeated persisted-invocation recovery and active-lease
  validation.
- Security/privacy pass: initial high finding fixed by limiting 45s orphan-grace
  recovery to persisted-only `inFlight` state; targeted re-review found no
  remaining security/privacy findings.
- Task-finish review: no findings.
Status: completed
Updated: 2026-04-29
Completed: 2026-04-29
