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
- The full Assistant Runtime suite passed 88 files / 2,328 tests with 4 skipped.
  The focused Assistant Engine outbox suite passed 107 tests, including
  restart proof for accepted, definite-failure, and ambiguous Telegram outcomes
  with one provider call. The focused Assistant Runtime callback suite passed
  260 tests.
- The Assistant Engine package umbrella test exhausted a worker near the
  default 4 GB heap and then stalled while terminating that worker. The exact
  session was interrupted after the directly affected 105-test suite passed;
  the repository friction is recorded in Frog.
- A zero-finding ReviewGPT round remains pending on the next pushed remediation
  candidate.
- Exact-head CI passed at
  `fcedbadcd3ca440f64eb620c350443e45bb39271`. ReviewGPT round 6 found that a
  process loss while the tracked non-idempotent Telegram intent was still
  durably `sending` reached stale recovery before the terminal-confirmation
  policy and could terminalize the outbox without acknowledging Web. The
  remediation keeps the no-resend decision but persists either the exact
  receipt or an ambiguous failure on the existing callback-replayable intent,
  invokes the same signed callback, and terminalizes the outbox only after Web
  acknowledgement. While exercising the production non-idempotent
  classification, the hosted scheduler was also shown to exclude a concrete
  callback-pending receipt from both its next wake and retry candidates. The
  narrow scheduler correction recognizes only that persisted phone-call result
  receipt as a callback retry path; ordinary non-idempotent ambiguity remains
  parked. The hosted test proves both wake and candidate selection.
- Exact-head CI passed at
  `41f5c43953a9ebe03467aecd7d7ca863752396e2`. ReviewGPT round 7 found that the
  Web-owned generation could still prove pre-provider `queued` while the
  generic runtime outbox was stale `sending`; treating the latter as terminal
  ambiguity abandoned a result that Web proved had never entered Telegram. Web
  now derives the disposition from its stronger generation state: queued
  ambiguity returns to `pending` and re-arms recovery idempotently, while
  `sending` ambiguity remains terminal. Provider success from queued remains
  invalid.
- `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage
  apps/web/test/phone-calls-result-delivery.test.ts
  apps/web/test/phone-calls-result-notification-store.test.ts
  apps/web/test/phone-calls-reconciliation-workflows.test.ts` passed: 3 files,
  29 tests. `pnpm --dir apps/web typecheck` passed.
- ReviewGPT round 8 at
  `6471b2fc534acacadae12dd6ff7778be55068e5f` found that a definitive generic
  runtime failure can still precede the provider-entry callback: retry
  exhaustion, unavailable provider fetch support, or missing Telegram
  credentials emits the exact generation-scoped terminal callback while Web
  still owns `queued`. Rejecting that callback left both durable owners stuck.
  The remediation explicitly accepts generic `queued` to terminal `failed` and
  re-arms the next obligation while preserving queued ambiguity and route loss
  as recoverable and queued success as invalid. Callback-response loss and the
  provider-entry compare-and-set race are idempotent.
- Current focused proof passes 32 Web transition/reconciliation tests, 263
  Assistant Runtime callback tests, and all three affected package typechecks.
  The focused Engine outbox/checkpoint slice passed 160 of 161 tests under the
  ordinary cap; its only failure was an unrelated upstream private-continuity
  test timing out at 60 seconds. That exact test passed in 58.6 seconds when
  rerun alone with a local 120-second harness bound, and the merged receipt
  replay plus retry-exhaustion regressions pass directly.
- ReviewGPT round 9 at
  `40ad8a0cf00a4ac2b7bdc196491bdfeafa18f8e4` found that recovery returned early
  when terminal Retell usage lookup or persistence remained pending, delaying
  an already stored call result behind an unrelated obligation. The existing
  reconciliation pass now attempts stored-result or terminal-transfer
  finalization independently of usage accounting and completes only after all
  applicable sibling obligations settle. It adds no state, queue, workflow, or
  owner.
- The round 9 remediation passes 97 focused Web phone-call service, delivery,
  notification-store, and reconciliation tests. Web typecheck also passes.
- The substantive round 10 audit runs with registry-latest ReviewGPT `0.5.132`;
  its registry integrity, frozen install, and installed CLI version were proved.
  While that audit ran, `main` independently landed the same package upgrade in
  #1900, so this candidate drops its duplicate dependency and audit-test edits
  and inherits `0.5.132` from the merge base instead of retaining a conflict.
- Intermediate exact-head CI exposed stale release-audit assertions for the
  prior ReviewGPT version and its fixed five-minute implementation shape. That
  candidate proved the `0.5.132` configurable threshold and extracted
  fail-closed helper directly; current `main` now owns the stronger equivalent
  audit through #1900.
- ReviewGPT round 10 at
  `388db5f9c744bddbbc068ccb0e26d707f6367047` found a provider-success recovery
  gap: the delivered in-memory owner did not retain the Telegram receipt, so a
  failed first checkpoint could persist a callback-pending intent without the
  evidence needed to replay the signed Web confirmation. It also found that a
  repeated callback failure kept the prior due timestamp and could spin.
- The remediation carries the exact provider receipt into the delivered owner,
  preserves it and the terminal-confirmation obligation through checkpoint
  fallback, and advances the existing bounded retry timestamp after every
  failed callback. Focused fault-injection proof fails the first post-send
  atomic rename and the first callback, restarts the dispatcher, confirms Web,
  and observes exactly one Telegram provider call. A second regression proves
  that repeated callback failures each back off before succeeding without a
  provider resend. The two new regressions plus the existing stale receipt and
  ambiguity recovery cases pass together, the complete three-file outbox slice
  passes 162 tests, and Assistant Engine typecheck passes.
