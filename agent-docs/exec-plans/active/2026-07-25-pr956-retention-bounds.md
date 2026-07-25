# PR 956 retention and signal-bound corrections

Status: active
Created: 2026-07-25
Updated: 2026-07-25

## Goal

- Make the retention PR deploy-safe and truthfully bounded: concurrent index
  construction, bounded deletes, one abortable five-item signal wave, and
  consistent verbose-log buffering.

## Success criteria

- Every new live-table index uses the repository's concurrent production
  convention.
- Mailbox expiry/age and stale web-session deletion use bounded batches with
  supporting timestamp-leading indexes.
- One hourly run claims at most five workspaces, starts at most five signal
  operations, aborts each at its deadline, and never advances after timeout.
- Runtime logging buffers debug and info while warn/error remain direct.
- The merged normalize-whole-batch then one-`createMany` property remains intact.
- Focused, full acceptance, specialist ReviewGPT, final parent review, final
  ReviewGPT, and CI are green on the pushed head.

## Scope

- In scope: this PR's migration, retention job/statements, signal API typing and
  caller, runtime log queue level boundary, focused tests and current docs.
- Out of scope: a generic retention framework, a new queue, draining more than
  five workspaces per hourly invocation, or refactoring unrelated diagnostics.

## Constraints

- Technical constraints: migrations follow production role/transaction
  conventions; deletion loops have item/time bounds and progress exits; abort
  propagates into the existing signal API.
- Product/process constraints: maintenance must not block writes or accumulate
  hidden timed-out work; recovery ownership remains off diagnostic logs.

## Risks and mitigations

1. Risk: concurrent index SQL is incompatible with a transaction-wrapped
   migration path.
   Mitigation: follow an existing production concurrent-index migration exactly
   and run migration guards.
2. Risk: timeout races still leave live Temporal/database work.
   Mitigation: expose and pass `AbortSignal`, claim one wave only, and prove peak
   active operations never exceeds five.

## Tasks

1. Reconcile the branch against current main and the merged bulk-log change.
2. Correct migration indexes and every unbounded retention statement.
3. Replace worker advancement with one abortable five-item signal wave.
4. Align debug/info queueing and add deterministic proof.
5. Run migration, Temporal, app, acceptance, and review gates.

## Decisions

- Prefer fewer claimed items per hour to an unbounded timed-out tail; the next
  hourly run is the durable continuation.

## Verification

- Commands to run: focused retention/runtime-log/Temporal tests, migration
  guards, `pnpm test:diff` for touched web and Temporal paths,
  `pnpm verify:acceptance`, and the repository ReviewGPT/CI gates.
- Expected outcomes: all pass; deterministic timeout tests show no more than
  five started or unresolved signal operations.
