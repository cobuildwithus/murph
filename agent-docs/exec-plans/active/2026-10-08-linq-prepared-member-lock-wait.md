# Lock the member before the root in prepared direct Linq admission

Status: active
Created: 2026-10-08
Updated: 2026-10-08

## Goal

- An established member's direct Linq message is admitted on the first
  delivery while that member's runtime is mid-callback, instead of returning
  503 and waiting for Linq to redeliver.

## Evidence

- A warm typing alert measured 6.5 s from the provider event. Web took about
  1.0 s from route start to typing. The other 5.5 s was Linq redelivery: the
  first delivery returned 503 `HOSTED_THREAD_ROUTE_PREPARATION_REQUIRED`,
  reason `member`, on both planner attempts.
- Prepared direct admission locked `hosted_member` with `FOR NO KEY UPDATE SKIP
  LOCKED`. Every runtime callback holds that row `FOR UPDATE` for its
  transaction through `requireHostedRuntimeCallbackTx`. During the failed
  delivery, a mailbox-fetch callback held it for about 150 ms and a checkpoint
  callback then held it for about 140 ms. Both attempts skipped the row.
- All 12 Linq webhook 503s in the previous 30 days carry this code. Every one
  with reason telemetry says `member`, including two after PR #3724 removed the
  foreign-key `KEY SHARE` cause.
- `SKIP LOCKED` existed only because this path revalidated its prepared control
  root before the member row (PR #1724). Activation, the unprepared Linq path,
  and device-sync admission all lock the member row first.

## Success criteria

- With a held member writer, route writer, or runtime-callback-style
  `FOR UPDATE`, admission waits, then admits exactly one mailbox item on one
  lock attempt after the holder commits. Those cases fail on the previous lock.
- Foreign-key holders still admit without waiting.

## Scope

- In scope: the lock order inside `lockPreparedHostedLinqDirectMemberTx`, its
  focused tests, and the ARCHITECTURE note.
- Out of scope: runtime callback lock modes, retry budgets, typing-alert
  measurement, and cancelling instant first-turn generation after a planner
  failure.

## Constraints

- No schema, config, state, provider-call, retry, or new helper.
- The order must stay consistent with every owner that waits on both the
  member row and a domain root.

## Risks and mitigations

1. Risk: an owner that holds a domain root and then waits on the member row
   would now deadlock with ingress. Mitigation: audit every domain-root caller
   for a blocking root-then-member order before landing.
2. Risk: a long member-row holder delays the webhook. Mitigation: the unprepared
   path already waits at the same position, and the transaction timeout still
   bounds it.

## Tasks

1. Move the member-row lock ahead of control-root revalidation and drop
   `SKIP LOCKED`.
2. Update the focused unit mocks and the real-PostgreSQL held-lock proof.
3. Audit lock order, verify, review, open the PR, and land it.

## Decisions

- Reorder over a bounded `lock_timeout` wait. An earlier candidate waited up to
  500 ms only when no control root was held. It worked, but it kept two lock
  modes and a timeout decoder. Matching the repository's member-first order
  removes the reason for both.

## Verification

- Linq home-routing PostgreSQL proof with `MURPH_TEST_POSTGRES_CONCURRENCY=1`,
  Linq dispatch and usage-reset unit files, Web typecheck, focused lint,
  `pnpm complexity:diff`, `pnpm docs:drift`.

## Progress

- Linq home-routing PostgreSQL proof: 32 of 32 pass. With the previous lock
  restored, the member-writer, route-writer, and runtime-callback cases fail;
  the foreign-key case passes.
- Linq dispatch and usage-reset suites: 224 pass. Web typecheck, focused lint,
  and `pnpm complexity:diff` (no planner debt change) pass.
