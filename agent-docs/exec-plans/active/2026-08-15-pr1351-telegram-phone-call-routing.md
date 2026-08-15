# Finish Telegram phone-call result routing

Status: active
Created: 2026-08-15
Updated: 2026-08-15

## Goal

Replace PR #1351's failed one-time workflow scaffold with the smallest durable
implementation that lets a canonical private Telegram scheduled occurrence use
the existing phone-call primitive and returns its asynchronous result only on
the member's current authorized Telegram route.

## Proven root cause

- The PR head contains only a trigger file and a self-removing finalizer
  workflow, not product code.
- The finalizer failed before verification because its generated transformation
  wrote the new Prisma migration file before creating the migration directory.
- The frontend-design workflow separately rejected the PR body's missing
  changelog declaration.
- ReviewGPT round 2 proved that mailbox retention was being mistaken for
  provider delivery. A retained or expired wake cannot establish whether the
  Telegram provider accepted the result.

## Success criteria

- Tracked direct Telegram results use the existing `HostedPhoneCall` row as the
  only durable owner of generation-scoped pending, provider-entry, delivered,
  failed, or ambiguous state.
- Completion binds and revalidates only the current Telegram route. Safe
  pre-provider route loss returns to pending; provider ambiguity is terminal
  and never resent.
- Mailbox, outbox, journal, and Workflow state remain transport machinery and
  cannot fabricate delivery or completion through existence or retention.
- Scheduled occurrence keys remain channel-independent and exact replay requires
  stored/requested result-surface equality, including `null`.
- Group calls keep their existing durable thread authority and scheduled email
  and group calls remain unavailable.
- The one-time workflow and trigger are deleted from the PR changeset.
- Focused tests, affected typechecks, exact-head CI, preliminary specialist
  review, and a zero-finding final ReviewGPT round all pass before merge.

## Plan

1. Recover the reviewed transformation and revalidate it against the current PR
   base and current owner contracts.
2. Apply the product implementation and focused proof directly in the PR
   worktree; delete the failed finalizer scaffolding.
3. Run focused verification, inspect the complete diff, commit, push, and update
   the PR intent and changelog contract.
4. Run the preliminary specialist pass and final ReviewGPT gate on the exact
   pushed head; resolve every accepted finding and rerun affected proof.
5. Require green exact-head CI, prove a clean merge against current `main`, mark
   the PR ready, merge it, and retire the task worktree.

## Verification log

- `pnpm install --frozen-lockfile` passed.
- `pnpm --dir apps/web prisma:generate` passed.
- `pnpm --dir apps/web changelog:generate` passed.
- `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage
  apps/web/test/phone-calls-service.test.ts
  apps/web/test/phone-calls-result-notification-store.test.ts
  apps/web/test/hosted-assistant-notification-destination.test.ts
  apps/web/test/hosted-phone-call-private-storage-classification.test.ts
  apps/web/test/changelog-fragments.test.ts apps/web/test/changelog.test.ts`
  passed: 6 files, 126 tests.
- `pnpm --dir packages/hosted-execution test --
  phone-call-result-notification-channel.test.ts` passed: 48 files, 533 tests.
- The assistant package test wrapper expanded the requested file list to the
  full package and one worker exceeded its 4 GB heap. The direct focused lane
  `pnpm exec vitest run --config vitest.config.ts --no-coverage
  test/assistant-phone-call-result-channel.test.ts
  test/assistant-phone-calls.test.ts
  test/assistant-codex-turn-planning.test.ts` passed: 3 files, 124 tests.
- `pnpm --dir packages/hosted-execution typecheck` passed.
- `pnpm --dir packages/assistant-engine typecheck` passed.
- `pnpm --dir apps/web typecheck` passed.
- ReviewGPT round 1 findings were remediated at `7832ae048e91834aa7347267977fa5bab5a7720e`.
- ReviewGPT round 2 returned `RETROSPECTIVE_REQUIRED`; the retrospective and
  durable call-row ownership decision are recorded in PR #1351.
- The call-row delivery state machine, signed runtime outcome callback,
  provider-entry/terminal proof, exact-route-bind recovery, and current-route
  loss behavior passed focused Web, Hosted Execution, Assistant Runtime,
  Assistant Engine, and Cloudflare tests. The full Assistant Runtime suite
  passed 88 files / 2,324 tests; the full Cloudflare Node suite passed 147
  files / 2,540 tests; Web, Hosted Execution, Assistant Runtime, Assistant
  Engine, and Cloudflare typechecks passed.
- Web ESLint passed with only pre-existing warnings. The Assistant Engine
  wrapper again expanded one requested file to the full package and exceeded
  its 4 GB heap; the direct focused file passed 9 tests.
- ReviewGPT rounds 3 and 4 findings were remediated and their affected proof
  passed. Exact-head CI was green at
  `a9d718f05bd39626e810f4787aef964464c919dc`.
- ReviewGPT round 5 found that a provider-terminal outbox intent became
  nonselectable before Web acknowledged its signed terminal callback. The
  remediation retains the provider receipt or terminal failure on the existing
  retryable outbox intent, retries only the idempotent Web callback after a
  restart, and marks the outbox terminal only after acknowledgement. It adds no
  schema, queue, or durable owner.
- `pnpm --filter @murphai/assistant-engine typecheck` and
  `pnpm --filter @murphai/assistant-runtime typecheck` passed after the round 5
  remediation.
- The full Assistant Runtime suite passed 88 files / 2,327 tests with 4 skipped.
  The focused Assistant Engine outbox suite passed 105 tests, including
  restart proof for accepted, definite-failure, and ambiguous Telegram outcomes
  with one provider call. The focused Assistant Runtime callback suite passed
  259 tests.
- The Assistant Engine package umbrella test exhausted a worker near the
  default 4 GB heap and then stalled while terminating that worker. The exact
  session was interrupted after the directly affected 105-test suite passed;
  the repository friction is recorded in Frog.
- Exact-head CI and a zero-finding ReviewGPT round remain pending on the next
  pushed remediation candidate.
