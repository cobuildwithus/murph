# Remove post-delivery maintenance from the reply path

Status: completed
Created: 2026-07-15
Updated: 2026-07-15

## Goal

- Release the hosted runner as soon as the current reply's required delivery
  outcome is durable, so later conversation input is never serialized behind
  reminder projection, pending-index repair, inventory scans, provider cleanup,
  or diagnostic work.
- Make exact reminder projection fast and run it only when schedule state or a
  consumed reminder wake requires reconciliation, not after ordinary replies.

## Success criteria

- A normal successful hosted reply performs only current-delivery terminalization
  and terminal-failure staging before releasing foreground ownership.
- Reminder create, edit, pause, resume, delete, and recurring-wake consumption
  explicitly request an interruptible maintenance reconciliation; ordinary
  replies preserve the existing wake without requesting one.
- Both foreground pending-input probes inspect existing index state only.
  Missing or incomplete indexes arm maintenance and never crawl/backfill inline.
- Cron projection jumps between matching fields/dates, parses each expression
  once, validates each timezone once, and preserves DST, leap-year, strict-next,
  and cron day-of-month/day-of-week behavior without persisted cache state.
- Automation documents are loaded with bounded concurrency.
- Secret-safe timings identify each post-delivery step, and artifact-read
  telemetry identifies read purpose without recording vault paths or contents.
- A production-shaped hosted E2E proves that a second inbound arriving just
  after the first reply is delivered starts typing within the foreground budget
  while deliberately slow reminder/index maintenance remains pending.
- Focused owner verification, deterministic cron performance proof, full required
  repo verification, required completion audits, green PR CI, and ReviewGPT pass.

## Scope

- In scope: assistant cron scheduling/projection, automation document reads,
  hosted foreground/post-delivery wake selection, pending-input index inspection
  versus repair, latency/artifact telemetry, focused tests, hosted-local E2E, and
  current runtime/testing documentation.
- Out of scope: snapshot format or storage architecture changes, persisted cron
  caches, new queues/schedulers, parallel conversation turns, and unrelated
  hosted runtime cleanup.

## Constraints

- Keep current-delivery outcome recording and terminal-failure staging on the
  foreground boundary.
- Preserve reminder and sibling-input liveness through explicit conservative
  maintenance wakes; preemption defers work and never drops it.
- Do not add duplicated schedule truth. Canonical automation documents remain
  the source of truth.
- Keep telemetry content-free, secret-safe, and nonblocking.
- Work only in `/private/tmp/murph-post-delivery-latency` on
  `codex/post-delivery-latency`; preserve all unrelated active lanes.

## Risks and mitigations

1. Risk: removing the unconditional post-delivery cron read can strand newly
   created or changed reminders.
   Mitigation: propagate an explicit schedule-mutation/reconciliation signal and
   cover every mutation plus recurring-wake rollover with focused tests.
2. Risk: a faster cron search can subtly change DST or DOM/DOW semantics.
   Mitigation: retain the canonical matcher as the semantic oracle in exhaustive
   differential tests across timezones, DST transitions, leap years, sparse
   schedules, and day-field combinations.
3. Risk: moving pending-index repair can acknowledge imported work before the
   rollout index is proven complete.
   Mitigation: keep consume acknowledgement gated on maintenance completeness;
   foreground only detects trustworthy existing state or arms repair.
4. Risk: a mocked unit test can prove send ordering while missing exclusive
   runner serialization.
   Mitigation: add a full hosted-local two-inbound scenario with real runner,
   mailbox, provider stub, typing observation, slow-maintenance injection, and
   an explicit runner-release/typing deadline.

## Tasks

1. Map the foreground, wake, cron-mutation, index-repair, and artifact-read
   ownership paths and capture a failing regression for the observed stall.
2. Split current-delivery correctness from deferred cleanup/reconciliation and
   make reminder reconciliation mutation/consumption-driven.
3. Split pending-index inspection from repair at both foreground probes.
4. replace minute-by-minute cron projection and serial automation reads with
   bounded, stateless algorithms.
5. Add nonblocking step timings and secret-safe artifact-purpose correlation.
6. Add focused semantic/performance tests and the production-shaped hosted E2E.
7. Run required verification and audits, close the plan with a scoped commit,
   push/open the PR, and complete CI plus the exact-head ReviewGPT loop.

## Decisions

- Ordinary foreground replies do not request reminder reconciliation.
- Reconciliation is requested by schedule mutation, consumed reminder wake, or
  missing/incomplete wake evidence found during maintenance.
- Existing persisted wake state is preserved across ordinary foreground replies;
  maintenance remains the only owner of exact canonical rescan/backfill work.
- Cron speed comes from computation and bounded I/O, not persisted cache state.

## Verification

- Commands to run: focused assistant-engine/query/runtime-state/assistant-runtime
  tests and typechecks; deterministic cron differential/performance tests;
  focused hosted-local E2E; truthful owner coverage or `pnpm test:diff`; final
  repo-required verification; `git diff --check`; required `coverage-write`;
  parent final review; PR CI and exact-head ReviewGPT.
- Expected outcome: a second current inbound is admitted and begins typing within
  the foreground budget even while reminder/index maintenance is blocked, with
  no reminder, sibling input, delivery outcome, or terminal failure lost.

## Completion evidence

- `pnpm test:diff` passed the affected typechecks, package tests, package-boundary
  check, Cloudflare verification, hosted-web verification, and production builds.
- The focused hosted-local two-inbound scenario replied in 1.648 seconds while
  the prior provider-cleanup request was delayed by 20 seconds.
- The runner bundle assembled below all three ratcheted byte budgets.
- Focused cron, query, pending-index, assistant-phase, runner, artifact telemetry,
  and platform suites passed; the owner package typechecks passed.
- The required `coverage-write` audit passed after adding an independent bounded
  minute-scan cron oracle and stateful bootstrap-clear/schedule-mutation proof.
- Parent review, `git diff --check`, the no-skip check for the focused E2E, and
  the privacy scan passed.
Completed: 2026-07-15
