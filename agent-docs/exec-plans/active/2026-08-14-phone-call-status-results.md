# Make hosted phone-call status and results reliable

Status: active
Created: 2026-08-14
Updated: 2026-08-17

## Goal

- Let Murph inspect the member's recent hosted phone-call state when asked.
- Let Murph stop one exact member-owned active call when explicitly requested.
- Fold terminal call outcomes into the active conversation promptly so Murph
  can explain success, failure, and required follow-up without guessing.

## Success criteria

- The existing Web-owned `HostedPhoneCall` row remains the sole product truth.
- A member-bound runtime read returns a bounded recent-call projection without
  exposing provider ids, ciphertext, raw transcripts, recordings, or call
  briefs.
- The assistant exposes a read-only phone-call status tool when the hosted
  phone-call port is available and can answer follow-up questions across turns.
- The assistant exposes exact-id termination only in a private, current
  user-authorized turn and never claims success before provider authority is
  known.
- A terminal result arriving during an active hosted invocation is imported
  promptly, but never blocks a newer foreground conversation reply. Delivery
  resumes through the existing background outbox path.
- Every meaningful terminal result, including failed and not-completed calls,
  requires a user-visible response; delivery failures remain retryable.
- Focused Web, Cloudflare, assistant-engine, assistant-runtime, contract, and
  direct active-invocation regressions pass.
- The exact pushed PR head completes the preliminary specialist and final
  ReviewGPT gates plus required CI with no unresolved accepted findings.

## Scope

- In scope: phone-call read and stop contracts, nullable stop-intent and
  authenticated direct-origin fields on the existing call owner, member-bound
  Web control routes, runtime port/tool exposure, terminal-result notification
  policy and ordering, focused tests, and current owner documentation.
- Out of scope: a new scheduler or queue, a new database model, raw provider
  transcript access, account-level support UI, and automatic repeat calls.

## Constraints

- Reuse the existing Web owner, signed Cloudflare control boundary, mailbox,
  runtime wake, and Retell reconciliation seams.
- Keep terminal result data bounded and treat provider/callee content as
  untrusted private data.
- Preserve foreground conversation priority unconditionally. Phone-call
  completion delivery may not delay admission of a newer conversation message.
- Do not copy production feedback, identifiers, or private call content into
  code, tests, docs, review packets, or PR text.

## Risks and mitigations

1. Risk: status reads leak another member's call or private call details.
   Mitigation: bind reads to the runtime's authenticated member and return only
   the existing bounded result projection plus operational status.
2. Risk: a result and a new inbound message produce duplicate replies.
   Mitigation: retain the existing deterministic notification idempotency key
   and drain the exact result through the existing notification path after the
   newer conversation input is admitted.
3. Risk: notification priority starves normal conversation or maintenance.
   Mitigation: keep result delivery in the ordinary background outbox lifecycle;
   no result-specific foreground owner or uninterruptible checkpoint exists.
4. Risk: deploy skew makes a new runtime operation fail unexpectedly.
   Mitigation: deploy the additive database migration, then Web, then
   Cloudflare/runner capability exposure in one contiguous cutover. New Web
   rejects origin-less new direct starts from old warm runners while preserving
   groups and legacy idempotent replay; immediately replace warm runners and
   prove their fingerprint. Once a stop fence is written, keep compatible Web
   as the rollback floor until capability and warm producers are drained and
   all unsettled fences are consumed.

## Tasks

1. Reproduce the active-invocation result-delay path with focused tests.
2. Add the smallest member-bound recent-call read contract and Web/runtime
   adapters.
3. Expose the read-only assistant tool and update prompt/catalog guidance.
4. Expose exact-id, member-bound, idempotent termination over the existing
   provider stop authority.
5. Make meaningful terminal results mandatory without delaying later user
   input.
6. Run focused tests, typechecks, privacy inspection, and direct scenario proof.
7. Commit, push, open the PR, run the required ReviewGPT stages with CI, resolve
   every accepted finding, and perform the parent final review.

## Decisions

- Query existing `HostedPhoneCall` rows; add no model or duplicated status
  projection. Persist only `stopRequestedAt` on that existing owner so a stop
  requested before provider authority is known survives reconciliation.
- Return the most recent bounded calls because a later turn may not retain an
  opaque call id reliably.
- Reuse the existing exact provider `stopIfActive` authority. Return
  `start_pending` instead of claiming termination when a provider call id is
  not yet known, have reconciliation consume the durable stop intent, and use a
  typed provider disposition so already-terminal calls remain truthful and
  idempotent.
- Open the bounded three-call encrypted result window through the existing
  secure-box batch owner: one status query, one set-based envelope query, and at
  most three distinct KMS unwraps with peak concurrency three.
- Use the existing system-mailbox notification and deterministic delivery key
  as the result owner rather than inventing a second result channel.
- Derive direct Linq/Telegram origin only from authenticated runtime turn
  context, persist the bounded discriminator, and resolve that same channel for
  normal results and stop settlements. Keep legacy null fallback and fail a
  revoked present route retryably rather than switching channels. New Web
  rejects origin-less new direct rows but preserves legacy idempotent replay and
  group starts during the immediate runner cutover.
- Make reconciliation the only Retell stop owner. Foreground control writes the
  compare-and-set stop fence, confirms reconciliation was started, and only
  then returns `start_pending`. A failed start propagates retryably while the
  durable fence remains available to an exact retry. The 90-second workflow step budget covers four possible
  serial 15-second provider requests—list, stop-status retrieve, conditional
  stop, and terminal-usage retrieve—and durable terminal and notification
  settlement.
- Publish a required stop-settlement notification under a stable call-id key
  after provider termination is confirmed or provider absence is durable.
  Mailbox/wake failures keep recovery pending, and replay reuses the same item.
- Make reconciliation the sole terminal owner for a safety-cleanup row whose
  foreground request returned `starting`. Provider `call_ended` callbacks and
  service replay only preserve or wake that owner. Cleanup runs before a stop
  fence, publishes the ordinary result before `endedAt`, then rereads the row
  so a concurrent fence also receives its required stop-settlement result.
- Classify safety cleanup as `needs_user`, not `not_completed`: provider
  termination proves that the call is no longer active but cannot prove whether
  its real-world goal already completed. Tell the member to verify before
  repeating the request. Provider-less start failure remains `not_completed`.
- Persist Murph-derived `needs_user` and `not_completed` fallback results in the
  existing encrypted call-result field before delivery. A conditional write
  leaves `analyzedAt` null, preserves provider analysis that wins the race, and
  makes proactive delivery and later status reads consume one canonical truth.
- Never let a phone-call result block foreground input. Leave the result queued
  when a conversation message is pending, then reuse the ordinary background
  outbox lifecycle. For a selected non-idempotent result, checkpoint the
  prepared `sending` claim before provider I/O and checkpoint its outcome
  afterward; both checkpoints remain interruptible by newer foreground work.
  Transport-idempotent delivery needs no extra claim barrier. No result-specific
  runtime state, checkpoint mode, or queue owner remains.
- Treat every accepted `call_analyzed` event as terminal even when Retell omits
  `end_timestamp`: preserve an existing provider end or persist the analysis
  time as the fallback. Publish a required deduped not-completed result when
  provider reconciliation durably proves that an unfenced pending start never
  existed; a provider-less call with an existing stop fence uses its required
  stop-settlement result. Foreground and workflow safety cleanup both stop the
  provider and complete the ordinary `needs_user` result before the existing
  cleanup-pending row becomes terminal.

## Verification

- Focused contract, Web, Cloudflare, assistant-engine, and assistant-runtime
  suites pass, including exact status ownership, durable stop reconciliation,
  idempotent replay, typed provider dispositions, retryable stop failure,
  malformed bridge input/output, maximum-cardinality encrypted result batching,
  mandatory result delivery, and pending-input result priority.
- Affected package and Web typechecks pass; targeted Web lint and
  `git diff --check` pass.
- Changelog fragment and archive validation pass all 45 focused cases.
- A pinned Codex App Server capture against a synthetic local provider measured
  the complete normalized first request fields (`include`, `input`,
  `parallel_tool_calls`, `text`, and `tool_choice`) with `gpt-tokenizer` 3.4.0
  `o200k_harmony`. Direct input changed from 26,682 tokens / 122,276 bytes to
  27,001 / 123,698 (+319 tokens, +1.1956%, +1,422 bytes); group input remained
  identical at 23,357 tokens / 107,744 bytes. The corrected-head total was
  recomputed from the immutable complete capture by exact replacement of the
  only two review-remediation fragments; a repository-native temporary test
  measured -25 tokens / -111 bytes and was removed.
- The one substantive preliminary `completion-specialists` ReviewGPT pass found
  four actionable findings: durable stop ownership with truthful provider stop
  disposition, encrypted-result fanout proof, signed bridge proof, and the
  `followUp` field spelling. The parent accepted and corrected all four. Its
  returned test-only bridge patch was inspected, applied, and extended with
  fail-closed cases; no ReviewGPT artifact is tracked.
- Final ReviewGPT round 2 found four actionable issues. The parent accepted all
  four: the stop owner could exceed its 25-second step budget and competed with
  foreground Retell work; rollback guidance treated persisted stop fences as
  harmless; direct results could select the member's default channel instead of
  the initiating channel; and a provider-less or delayed stop settlement did
  not notify the requester. The remediation makes workflow reconciliation the
  sole provider-stop owner with a 90-second budget, documents the hard rollback
  floor and drain, persists authenticated direct origin, and emits required
  deduped stop-settlement notifications.
- Final ReviewGPT round 3 found that `call_analyzed` without `end_timestamp`
  could leave an analyzed stop fence permanently unsettled. The parent accepted
  and corrected it by making analysis terminal with an authoritative existing
  or provider timestamp and an analysis-time fallback. The same review exposed
  two body/code discrepancies: uncertain-start stop recovery can issue four,
  not three, serial provider requests, and an old warm runner could omit direct
  origin during the claimed Web-first compatibility window. The budget is now
  90 seconds with a four-request fake-timer proof, and Web fails closed before
  creating a new origin-less direct row while preserving groups and legacy
  replay. Parent review additionally closed the provider-less asynchronous
  start-failure delivery gap with a required deduped result notification.
- Current focused remediation proof passes 93 tests across service,
  reconciliation, status, and result-notification-store files. The Web suite includes a
  fake-timer production Retell adapter proof with four serial 14-second
  requests, durable terminal state, required settlement finalization, and
  terminal usage recording before the 90-second step deadline. Earlier focused
  assistant-engine, hosted-execution, Cloudflare bridge, and cross-owner proofs
  remain green. All 14 phone-call Web test files pass 240 tests after the
  round-8 delta, and Web typecheck passes. Final exact-head
  gates will be rerun after review remediation is committed.
- Final ReviewGPT round 4 found two actionable issues. The parent accepted both:
  an unsafe-storage provider cleanup could complete silently after foreground
  returned `starting`, and the origin-routing rollback drain allowed an ended
  but unanalysed call below the compatible Web floor. Cleanup recovery now uses
  the existing pending row to retry provider stop plus the ordinary deterministic
  failure result before terminalizing. Rollback now requires the ordinary
  result mailbox item for every non-null origin call, regardless of active,
  ended, or analyzed state, with an executable read-only zero-count query.
- Final ReviewGPT round 5 found that the round-4 cleanup correction still had
  competing terminal writers: a provider `call_ended` callback, service replay,
  or generic stop handling could set `endedAt` after a notification failure and
  erase the required result obligation. The parent accepted the finding.
  Reconciliation now owns durable cleanup terminalization, cleanup precedes
  explicit-stop handling, ordinary result delivery precedes `endedAt`, and a
  post-terminal reread observes a stop fence that races with finalization.
- Final ReviewGPT round 6 found that safety cleanup still reported the
  unverified real-world outcome as `not_completed` and claimed Murph stopped
  the call even when the typed provider disposition could be
  `already_terminal`. The parent accepted the finding. Both provider
  dispositions now produce a neutral `needs_user` result that confirms only
  that the call is no longer active, says goal completion could not be safely
  verified, and tells the member to confirm before repeating the request.
  Provider-less failure retains its proven `not_completed` result.
- Final ReviewGPT round 7 found that fast foreground safety cleanup still
  terminalized without calling the neutral-result finalizer, while only delayed
  workflow cleanup used the corrected owner. The parent accepted the finding.
  Foreground now rereads the durable cleanup row, invokes the same finalizer
  through `finalizeBeforeEnd`, and leaves the row pending when route, append, or
  wake fails so workflow replay reuses the deterministic result identity. Both
  typed provider dispositions have focused foreground coverage. Documentation
  now distinguishes explicit-stop workflow ownership from bounded foreground
  safety cleanup and recognizes stop settlement as the sole notification when
  a stop fence precedes durable provider absence.
- Final ReviewGPT round 8 found that synthetic cleanup and provider-absence
  outcomes existed only in the mailbox path, so a later status request could
  lose an outcome Murph had already established. The parent accepted the
  finding. Fallback results are now encrypted onto the existing call row before
  notification; mailbox failure leaves that result inspectable, stop-fenced
  provider absence stores it without a competing ordinary notification, and a
  provider analysis that wins the conditional write remains authoritative.
- Final ReviewGPT round 9 found that exact phone-call results selected ahead of
  newer input were still filtered out on Telegram because that transport is
  non-idempotent. The parent accepted the finding. The selected phone result
  now owns the existing checkpointed post-checkpoint delivery pass on either
  transport; usage rewards and generic notifications remain deferred, and the
  change does not mark Telegram idempotent or introduce another queue owner.
  Focused phase tests pass 3 cases, the production-style Telegram proof passes,
  all 8 real external-completion route cases pass, and the two affected runtime
  files pass 596 tests. Assistant-runtime typecheck passes. Its package has no
  ESLint target or config; the changed runtime code is instead covered by its
  typecheck, tests, and repository formatting checks.
- Final ReviewGPT round 10 found that the round-9 `outbox_sending` phase label
  did not itself create a durable snapshot: the provider call could still run
  while the selected Telegram intent existed only in the warm workspace. The
  parent accepted the finding. The runtime now treats the selected delivery as
  a checkpoint barrier, disables foreground wake and detached-ask preemption,
  commits the claimed intent before provider I/O, and commits the provider
  disposition before admitting newer input. The production-path regression
  restores the exact claim snapshot and proves the selected non-idempotent
  intent is not blindly resent; the unrelated intent is still pending in that
  snapshot. The full assistant-runtime suite passes 2,317 tests with 4 skipped
  across 88 files, and package typecheck plus `git diff --check` pass.
- Final ReviewGPT round 11 found that an unresolved hosted image-generation
  provider task could keep resetting the dirty quiet window and starve both the
  selected result's claim checkpoint and its required outcome checkpoint. The
  parent accepted the finding. A foreground causal delivery barrier now ignores
  unfinished image work while still flushing any completed image or canonical
  write before each checkpoint. A focused outer-runtime regression holds the
  image provider unresolved across both snapshots, proves newer conversation
  input remains behind the outcome snapshot and can preempt afterward, then
  releases the image and verifies its completion is admitted normally. The same
  proof covers shutdown during delivery and confirms the outcome snapshot is
  committed before the unresolved provider task is released. The full
  assistant-runtime suite passes 2,318 tests with 4 skipped across 88 files;
  package/workspace typecheck, docs drift, privacy scan, and `git diff --check`
  pass.
- A later user-directed architecture review rejected the round-10/11
  result-before-input barrier as incompatible with unconditional foreground
  reply priority. The correction removes the result-specific durable-effect
  marker, checkpoint barrier state, wake suppression, uninterruptible
  checkpoints, and outcome-before-input rule. Pending input is admitted first;
  an exact phone result then uses the ordinary background outbox flow. A
  non-idempotent prepared claim still receives its replay-safety checkpoint,
  but both that checkpoint and the ordinary outcome checkpoint can be
  interrupted by newer input. The focused production-path proof passes for
  Linq and Telegram, and the outer-runtime stress proof confirms foreground
  input precedes a pending durable delivery effect while detached image work no
  longer starves durability. Focused proof passes four assistant-phase cases,
  both transport production-path cases, the outer-runtime ordering case, and
  four route-restoration cases. Assistant-runtime typecheck, docs drift,
  privacy inspection, and `git diff --check` pass. A two-worker aggregate
  assistant-runtime run remained silent before the Vitest banner and was ended
  after the bounded wait; it produced no aggregate test result.
- Final ReviewGPT round 12 found that a nonterminal stop could return
  `start_pending` after swallowing a reconciliation-start failure, while a
  compare-and-set loser could return the same state without attempting a start.
  The parent accepted the finding. All nonterminal stop paths now share one
  confirmed-start tail; a starter failure remains retryable with the durable
  fence intact, and a concurrent loser re-arms reconciliation before promising
  asynchronous resolution. Focused tests cover new fences, existing fences,
  nonterminal compare-and-set loss, exact retry, and terminal race truth. All
  14 phone-call Web test files pass 242 tests, and Web typecheck passes.
- A second corrected-head round-12 attempt confirmed the stop correction, then
  found that late provider analysis could overwrite an already-persisted
  fallback result after provider cleanup advanced `endedAt`. The parent
  accepted the independently confirmed finding. Provider analysis now uses the
  existing encrypted and legacy result fields as a two-way first-writer fence;
  a compare-and-set loser reuses the stored fallback as canonical without
  importing provider-only transfer follow-up semantics, and the default Prisma
  adapter preserves both predicates. Both non-Eragon attempts completed with
  findings but reported `MODEL_CONFIRMATION: UNKNOWN` and a `gpt-5-6-pro`
  response slug, so neither satisfies the required Sol gate. The two focused
  result suites pass 72 tests; all 14 phone-call Web files pass 244 tests in
  two explicit-project groups after the project-unspecified aggregate runner
  stalled without a test result; Web typecheck, focused ESLint, docs drift,
  privacy inspection, and `git diff --check` pass.
- A third exact-head round-12 full audit found two original-PR gaps that the
  parent independently confirmed. Mandatory direct thread results and stop
  settlements resolved the current route but did not carry the existing
  provider-entry route authority, so a later Telegram binding change could
  leave the queued private result deliverable to the stale target. Both wake
  builders now bind the existing destination before persistence; direct Linq
  keeps its explicit bound semantics, direct Telegram carries live authority,
  and participant/group routes retain their existing shapes. The same audit
  found that a targeted group turn could create a group-owned call but could
  not expose status or stop afterward on any reachable owner. Status and stop
  now reuse the existing current-input plus message-targeting predicate and the
  already-bound group-container port, with no participant-owned state or new
  authorization seam. The Vonneumann response ran 26 minutes 13 seconds with
  the exact ZIP and completion markers, but again reported
  `MODEL_CONFIRMATION: UNKNOWN` and `gpt-5-6-pro`, so it does not satisfy the
  Sol gate; shorter Phlebas and Mountain attempts were also invalid tooling
  responses. Focused proof passes 61 Web result tests, 125 assistant-engine
  phone/planning tests, and 255 assistant-runtime callback tests. All 14
  phone-call Web files pass 245 tests, and Web, assistant-engine, and
  assistant-runtime typechecks pass.
- A fourth exact-head round-12 full audit ran 37 minutes 17 seconds and found
  one review-induced retry gap in the preceding route-authority correction.
  The Web owner correctly denies a changed direct route with
  `HOSTED_THREAD_ROUTE_EGRESS_UNAUTHORIZED`, but its generic non-retryable
  classification caused the runtime outbox to terminalize a mandatory call
  result or stop settlement before provider entry. The parent independently
  confirmed and accepted the finding. The runtime now reclassifies only that
  exact denial for an existing `phone-call-result:*` delivery as a
  pre-provider retryable failure, preserves the frozen target, and never falls
  back or switches channels; other notification classes retain their terminal
  denial semantics. Focused Telegram and Linq coverage proves both result keys
  remain provider-free while revoked, deliver exactly once after the exact
  route is restored, and leave ordinary notifications unchanged. All 259
  assistant-runtime callback tests, 56 adjacent system-mailbox tests, the
  assistant-runtime typecheck, and docs drift pass. The Vonneumann response
  again completed with the exact ZIP but reported
  `MODEL_CONFIRMATION: UNKNOWN` and `gpt-5-6-pro`, so it remains useful finding
  evidence rather than the required Sol gate.
- Corrected-head product-experience revalidation finds the implementation is
  again the smallest complete experience for the incident: status is durable,
  stop state is truthful, fallback outcomes are canonical, and an exact result
  reaches the member before Murph admits a newer message on both supported
  direct transports. A temporary route revocation now blocks disclosure and
  preserves the exact deterministic delivery for retry after authorization is
  restored. The remaining evidence gap is live-provider timing, not a known
  product-flow gap.
- Remaining gates: commit and push the remediation head, exact-head CI, final
  ReviewGPT `ROUND_OUTCOME: PASS`, clean merge-tree proof, and plan closure.
- Direct proof: a synthetic call result arrives while one hosted invocation is
  active and newer conversation input is waiting; Murph receives the result in
  the next turn and a later status query returns the same terminal truth.
