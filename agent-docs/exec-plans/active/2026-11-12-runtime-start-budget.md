# Enforce a per-member budget on fresh runtime starts

Status: active
Created: 2026-11-12
Updated: 2026-11-12

## Goal

- Bound the rate at which one member can be given new runtime attempts,
  whatever the cause. Today a restart loop is only detected (the runaway
  alert) and then runs at full speed until a person or the fault stops it.
- This is a rate limit on newly minted attempts. It does not end a loop, cap
  its lifetime, or bound every container boot (standby preparation, deploy
  smoke and shell recovery inside an attempt mint nothing).
- Owner priority: clean, simple, long-term maintainable architecture with
  minimal complexity. One invariant in one place, not one more per-path guard.

## Why now (evidence, opaque ids only)

- 2026-11-12 08:10 to 13:07 UTC, subject `311f13d3`: 2,938 fresh starts in five
  hours (about 600 an hour) for one undeliverable notification. Fixed for that
  exact shape by #4892 (Web stops reporting an imported, waiting default head
  as `default_owned`; failing items slow to 15 minutes). Both halves are live.
- 2026-11-10 14:00 to 18:00 UTC, subject `9609af36`: 448 fresh starts in four
  hours, none in `default` mode. A second, different loop shape that #4892
  does not touch and nothing has diagnosed.
- The scheduler workflow already carries three bespoke no-progress backoffs
  and about 28 patch markers. Each closed one shape. Loops keep arriving in new shapes.
- 2026-11-10 17:41 to 17:45 UTC, subject `d97db275`: 25 fresh starts in five
  minutes with no pass making progress, the same shape as the first in
  miniature.
- Replay of all 13,634 fresh starts in the runtime log (2026-10-29 to
  2026-11-12) through the rule below: no start outside those three loops is
  blocked. The two long loops fall from 3,031 and 564 starts to 190 and 197.

## Design

Every new runtime attempt is minted in exactly one transaction:
`claimHostedRuntime` in `apps/web/src/lib/hosted-execution/runtime-owner.ts`
("Postgres owns admission"). Its only production caller is the owner command
dispatcher. The budget lives there and charges one unit: a newly minted
attempt, including one that later fails before execution.

1. One nullable column on `hosted_runtime_owner`: `start_debt_until`
   (timestamp): the accumulated start debt, a token bucket held in one value
   (GCRA). No counters, no window rows.
2. In the `claimed` branch only, under the owner row lock the transaction
   already holds:

   ```text
   allowance = (burst - 1) * interval
   tat       = max(start_debt_until ?? now, now)
   blocked   when tat > now + allowance, with retryAt = tat - allowance
   admitted  otherwise, writing start_debt_until = tat + interval
   ```

   A blocked claim writes nothing. `now` is the application time the claim
   already samples after the member lock; skew between Web hosts moves the
   allowance by the skew and nothing else.
3. Constants: interval 3 minutes, burst 12. One allowance for every claim.
4. `existing` claims (waking or reconciling a live attempt) are not charged.
   A retired-target recovery mints its successor through a second claim, which
   is charged, so one useful start can cost two units; the replay includes
   those.
5. Release, retirement and target-retired updates leave the column untouched.
   Deletion, consent withdrawal, retirement, upload draining and completion
   never claim, so the budget cannot hold them.
6. Wire contract (`packages/hosted-execution/src/runtime-owner.ts`): add
   `"start_budget"` to the blocked reasons and an optional `retryAt` on the
   response, required and finite when the reason is `start_budget`.
7. Dispatcher (`runtime-owner-control.ts`) forwards `retryAt`. The explicit
   owner column list (`runtimeOwnerColumns`) reads the new column.
8. Worker (`apps/cloudflare/src/runtime-processing.ts`): a `start_budget`
   block returns `retry_later` at the given time with retry reason
   `start_budget_exhausted`; a missing or unreadable time falls back to one
   interval. The reason joins the runaway alert's safe retry reasons.

## What this does not promise

- The scheduler does not always sleep until `retryAt`: a signal, a retained
  owner deadline, a default-work or device-sync deadline, or retention
  arbitration can reopen admission sooner. Those re-ask Web for a claim and
  are blocked again without minting anything. Claim-call traffic during a
  block is therefore bounded by those deadlines, not by this change.
- During a block every kind of work for that member waits for the next unit:
  a new member message, a due reminder, an Assistant Ask inside its ten-minute
  authority window, routine retention, a crash successor. That only happens to
  a member whose runtime has already taken 12 attempts faster than one per
  three minutes.
- The existing alert counts finished invocations, so a loop of launches that
  fail before finishing may not reach it.

## Deleted or avoided instead of added

- No change to the Temporal workflow, no patch marker, no new workflow state.
- No progress fingerprints, no per-reason backoff tables, no feature flag, no
  foreground exception.
- The scheduler's existing backoffs stay. They decide fairness between kinds
  of work below this ceiling and are not made redundant by it.

## Success criteria

- PostgreSQL tests on the claim: 12 back-to-back claims succeed and the 13th
  is blocked with `retryAt` three minutes out; a blocked claim leaves the
  column unchanged; a claim at `retryAt` succeeds; `existing` claims never
  move the column; a first claim (null column) succeeds; release, retirement
  and target-retired keep the debt; account deletion readiness and retirement
  succeed with the budget exhausted.
- Contract tests: `start_budget` round-trips with `retryAt`; an old reader
  drops the unknown reason as today.
- Worker tests: `start_budget` maps to `retry_later` at the supplied time, and
  to one interval when the time is missing or unreadable.
- The replay above is rerun against the final constants before merge.

## Scope

- In scope: the claim transaction and its migration, the owner wire contract,
  the dispatcher, the Worker mapping, the alert's retry-reason allowlist,
  tests, and `agent-docs/references/hosted-postgres-runtime.md`.
- Out of scope: the Temporal workflow; alert thresholds; why the 2026-11-10
  loop on subject `9609af36` happened (the budget bounds it meanwhile); the
  generic 500 Web's group tool returns when a sending line is in warning.

## Constraints

- The claim is on the reply hot path. The added work is arithmetic on a row
  already locked and one more column in an update the claim already performs.
  No added read.
- Short database-only transaction, bounded work, no external calls inside it.

## Deploy and skew

- Order: Worker that understands the reason, then the additive migration,
  then enforcing Web, then confirm no older Web deployment still serves
  claims. Two PRs.
- Old Worker with new Web sees an unknown blocked reason and retries on its
  three-second default: claim calls, no attempts. The order above avoids it.
- Older Web serving claims during the switch mints without charging; the
  guarantee holds once it has drained.
- Migration: one nullable column, no backfill, no index.
- Rollback: revert Web, which removes the protection; the column stays.

## Plan review (Codex, 2026-11-12)

Accepted:
- Remove the foreground allowance. Thirty units on the shared value would
  have left background work blocked for about an hour afterwards, and gave no
  guarantee the waiting message made progress.
- State the guarantee as a rate limit on minted attempts, not a bound on loop
  lifetime or on every container boot.
- Keep the scheduler's backoffs; do not call them redundant.
- Fix the arithmetic: allowance is `(burst - 1) * interval`.
- Read the column in the explicit SQL projection, forward `retryAt` through
  the dispatcher, validate it, preserve debt across release and retirement,
  and add the retry reason to the alert allowlist.
- The scheduler can re-ask before `retryAt`; say so and limit the claim.
- Make the replay an implementation gate. It moved the burst from 10 to 12:
  at 10, one healthy start would have waited 52 seconds.
- Document the contract in `hosted-postgres-runtime.md`.

Rejected:
- Adding a scheduler-side retry horizon now. Bounded claim-call traffic is not
  part of this change's acceptance, and it would need a workflow patch.
