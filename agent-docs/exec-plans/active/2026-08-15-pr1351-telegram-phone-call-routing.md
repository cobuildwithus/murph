# Finish Telegram phone-call result routing

Status: active
Created: 2026-08-15
Updated: 2026-08-16

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
- ReviewGPT round 11 at
  `f70a8ff3c8c67fc6dded79f731a50ddb677b6ce0` required a retrospective because
  the round 10 backoff correction threaded dispatch-start time into terminal
  confirmation. A provider or callback deadline could consume the entire delay
  before persistence, making the stored retry immediately due even though the
  timestamp had advanced.
- Retrospective decision: keep `HostedPhoneCall` as the sole durable result
  owner and the existing outbox as the sole confirmation transport owner; keep
  Telegram strictly no-resend after possible provider entry; and assign retry
  time to the existing confirmation-reschedule persistence boundary after the
  callback actually fails. Delete caller-threaded attempt timestamps instead
  of adding a timer, lifecycle state, queue, scheduler, lease, or reconciliation
  owner.
- The remediation removes `attemptedAt` and `confirmationAttemptedAt` from the
  confirmation path. The persistence boundary now captures its own current
  time and derives both `updatedAt` and the bounded future retry from it. Exact
  proof crosses a simulated 30-second Telegram deadline and 45-second callback
  deadline, verifies the stored retry remains later than failure completion,
  restarts through callback-only replay, and observes one Telegram request.
  That proof plus repeated callback failure, stale receipt, stale ambiguity, and
  the direct rescheduler case passes: 3 files, 5 tests. The complete three-file
  outbox slice passes 162 tests and Assistant Engine typecheck passes.
- ReviewGPT round 12 at
  `2b9c9d0f0e56e8fdf9ed66e493f787ab2522700f` found that Web treated every
  route failure from `sending` as terminal ambiguity. A committed provider-entry
  callback can lose its response before Runtime invokes Telegram; if the exact
  route then changes, Runtime's cumulative definitive failure proves that no
  provider request occurred even though Web still records `sending`.
- The remediation deletes the `sending` special case. A definitive exact-route
  failure returns either `queued` or `sending` to `pending` and reuses the
  existing recovery re-arm, while `sending + failed_ambiguous` remains terminal
  and can never resend. The focused Web ownership, re-arm, and notification
  suite passes 32 tests; the paired Runtime boundary proof passes 7 tests and
  proves zero Telegram requests before a lost callback response, one request on
  a valid retry, definitive route failure before fetch, and terminal ambiguity
  for a may-have-succeeded outcome. Web typecheck passes.
- ReviewGPT round 13 at
  `0d2d57f9a73909bafc3580373a9c03beb51647ce` found that the exact Telegram
  result composed its stable outbox intent during the dirty hot pass but then
  waited for the routine 180-second idle checkpoint. Repeated ordinary chat
  work resets that quiet window, so a member continuing the conversation could
  starve the already-ready call result indefinitely.
- The remediation admits only the exact generation-scoped phone-result family
  through the existing foreground delivery preparation after fresh
  conversation input wins. Its current intent crosses the existing canonical
  persistence and `outbox_sending` barrier before Telegram begins; generic
  non-idempotent effects remain excluded. Production-delay proof injects three
  ordinary Telegram messages ahead of the result, observes one provider call
  before any routine idle snapshot, receives terminal confirmation, and starts
  a fresh runtime invocation without resending.
- Exact-head package coverage then exposed one stale unit assertion that still
  expected phone results to remain behind the idle-gated outbox. The coverage
  test now proves the new split directly: phone results prepare and drain behind
  `outbox_sending`, while Telegram referral rewards retain the prior idle-gated
  behavior. The focused two-case unit test passes; production code is unchanged.
- ReviewGPT round 14 at
  `b5eba26de76a1e39adfc41e9afd2acfb0c0ffe28` found that the foreground-send
  exception recognized the broad phone-result mailbox prefix rather than the
  exact generation-scoped delivery identity. That also accelerated
  generationless manual Telegram call results and made the legacy changelog
  promise broader than the scheduled-only behavior.
- The remediation deletes the preparation-level prefix predicate and admits a
  non-idempotent foreground effect only when the existing
  `parseHostedPhoneCallResultDeliveryKey` proves its
  `phone-call-result:<callId>:generation:<positive integer>` identity. The
  unrelated legacy changelog edit is reverted. Production-delay proof now
  pairs the tracked result with a generationless manual Telegram result: the
  tracked result waits behind three fresh inputs, crosses canonical persistence
  and `outbox_sending`, sends once before routine idle, records terminal
  confirmation, and does not resend after restart; the manual result remains
  idle-gated. The 10-case real mailbox/outbox matrix, the paired three-case
  phase unit test, and Assistant Runtime typecheck pass.
- Exact-head app verification then exposed one stale changelog assertion that
  still attributed the reverted legacy entry to PR #1351. The expectation now
  preserves that entry's original PR ownership; the structured scheduled-call
  item remains the sole changelog evidence for this PR.
- ReviewGPT round 15 at
  `3df29426a83ae49d048d7c3411c0b80f0c8c8f28` found that R9's independent
  stored-result recovery lost the mandatory post-transfer follow-up when a
  transfer result became durable before mailbox append but terminal usage was
  still pending or unavailable. The generic recovery path hard-coded the
  transfer requirement to false, and the deterministic notification could not
  later be repaired.
- The remediation persists one bounded optional
  `transfer_follow_up_required` completion policy inside the existing encrypted
  result. Legacy absence remains ordinary. Notification response policy and
  instructions now derive from the decrypted result in both immediate and
  stored recovery, and the downstream parallel boolean plumbing is deleted.
  Fault-injection proof fails mailbox append after the result compare-and-set,
  then recovers from the stored ciphertext. Default-store proof covers exact
  tracked generation, generationless manual transfer, ordinary legacy absence,
  terminal follow-up instructions, required-send policy, and deterministic
  replay without replacement. Five focused Web files pass 149 tests, the
  Hosted Execution schema proof passes 8 tests, and both affected typechecks
  pass.
- ReviewGPT round 16 at
  `fcb5cd99435c7c3922d8d293d63e56283bc3647d` found that the new strict result
  writer was not backward-readable by the prior strict Web schema. The mismatch
  affected tracked and generationless direct transfers even when
  `result_notification_channel` was null, so the documented tracked-row count
  could not prove a safe rollback.
- The correction was split into consumer-first PR #1923. That release accepts
  the optional bounded completion policy, continues to emit the legacy result
  shape, proves the previous strict-reader fixture rejects policy-bearing data,
  and disables transfer authority for group calls at both normalization
  boundaries. PR #1923 passed ReviewGPT and required CI, merged to `main` at
  `9330b2476d81bff977dacb3c1978fa6a20c82fc7`, and is the required production
  reader prerequisite for this writer.
- Current `main` is merged into this branch at `334ac78860`. The conflict
  resolution preserves generation-scoped tracked delivery, derives mandatory
  transfer follow-up exclusively from the durable result policy, removes a
  redundant recovery test, and documents two independent floors: the first
  reader-plus-writer release after any policy write, plus generation-aware Web
  while non-null result-channel rows exist.
- ReviewGPT `0.5.133` is now the repository version. The frozen install and
  installed CLI version are proved locally; the next sensitive full-snapshot
  round will use that version.
- ReviewGPT round 17 started on the exact merged candidate
  `0d8fefbf0d2852d2a7f69a69e8fb15e926c0ec9c` with `0.5.133`. Exact-head CI
  then exposed two measured Cloudflare runner bundle ratchets, so that round is
  retained as review evidence but cannot be the final candidate gate.
- The Cloudflare runner failure was budget enforcement, not a newly introduced
  boot dependency: Linux CI measured the already-bundled vault CLI graph at
  9,164,533 bytes against 9,152,000, and exact macOS assembly measured the
  existing entrypoint static closure at 8,266,461 bytes against 8,259,368. The
  narrow correction ratchets only those understood totals while retaining the
  existing CLI entry, CLI static-startup, entrypoint entry, total, and fixed
  variance gates. Full production bundle assembly and parity passed; the two
  focused budget suites passed 51 tests; Cloudflare typecheck passed.
- The production reader prerequisite is live. The guarded writer cutover first
  paused exact-path call admission, waited the full configured five-minute call
  lifetime, and proved no provider-bound call awaited analysis and no phone-call
  reconciliation workflow was running or pending. Exact result ingress was then
  paused and independently returned the expected firewall denial. Both scoped
  barriers remain live through the result drain and writer activation.
- ReviewGPT round 17 at
  `0d8fefbf0d2852d2a7f69a69e8fb15e926c0ec9c` found that the R3 Telegram
  route-restoration hook was emitted by every ordinary unchanged direct
  message. Because each emission could start an independent 120-attempt
  reconciliation Workflow, ordinary conversation traffic could amplify one
  pending result into unbounded overlapping recovery work.
- The correction keeps transition authority in the existing member-row-locked
  Telegram routing owner. That upsert now reports whether the effective user
  and thread destination was created, restored, or changed; only that true
  transition enters the existing post-commit re-arm path. It adds no durable
  state, lease, run registry, scheduler, or second reconciliation owner.
- Focused Web proof sends 100 messages on one unchanged route while one recovery
  Workflow is already represented as armed: the harness observes one route
  write and a fixed seven route-read calls per message, with zero new recovery
  starts. One richer route transition emits exactly one re-arm, and a repeat on
  that route emits none. The two affected unit files pass 131 tests.
  Local PostgreSQL contention proof passes all five cases and shows that two
  concurrent direct messages around one restoration serialize so only the
  transaction observing the transition emits the re-arm. Web typecheck passes.
- Round 17's rendered-evidence note is not an implementation finding: this PR
  changes one structured changelog item but no component, screen, or renderer.
  The repository's changelog validation and Frontend Design Proof are green;
  adding a repository screenshot would create audit-only product source.
